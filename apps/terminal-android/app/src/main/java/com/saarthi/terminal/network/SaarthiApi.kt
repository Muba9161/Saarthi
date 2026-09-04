package com.saarthi.terminal.network

import com.saarthi.terminal.data.TerminalIdentityStore
import com.saarthi.terminal.util.DebugLog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * The Saarthi client.
 *
 * One class, because a terminal talks to exactly one server and the interesting
 * behaviour is all in how it handles that server being unreachable — which it
 * frequently is, in a yard, under a bridge, or in a basement loading dock.
 *
 * Three things it does that a naive client would not:
 *
 *  1. **It refreshes its own token once, under a lock.** A terminal makes
 *     several concurrent requests on wake-up; without the lock they would all
 *     see the 401 and all spend the secret, and the server would see six token
 *     requests from one tablet in one second.
 *
 *  2. **It distinguishes "no network" from "refused".** They need different
 *     actions from the person in the cab — wait, versus call the office — and
 *     collapsing them into one message is how somebody rings support about a
 *     tunnel.
 *
 *  3. **It never logs a credential.** The secret and the token are the two
 *     things that must not end up in a support bundle.
 *
 * Serializers are passed explicitly rather than reified. An inline reified
 * helper cannot touch this class's private members, and making the JSON
 * configuration and the transport public to satisfy the compiler would be
 * exposing the parts most worth keeping shut.
 */
class SaarthiApi(
    baseUrl: String,
    private val identity: TerminalIdentityStore,
    private val appVersion: String,
) {

    /** Normalised once: a trailing slash here becomes a double slash everywhere. */
    @Volatile
    var baseUrl: String = baseUrl.trimEnd('/')
        private set

    private val json = Json {
        // A tablet bolted into a truck may not be updated for a year, so a
        // server that adds a field must not break it.
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
        coerceInputValues = true
    }

    private val client = OkHttpClient.Builder()
        // Short connect, generous read. A tablet on a marginal cell either
        // connects or it does not; once it has, a slow answer is worth waiting
        // for rather than retrying and doubling the load on a bad link.
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val tokenLock = Mutex()

    fun updateBaseUrl(url: String) {
        baseUrl = url.trimEnd('/')
    }

    /** What went wrong, in terms a screen in a cab can act on. */
    sealed class Failure : Exception() {
        /** The request never reached a server. Wait, or move the vehicle. */
        class Offline(val ioCause: IOException) : Failure() {
            override val message: String
                get() = "Saarthi could not be reached."
        }

        /** The server answered, and said no. */
        class Refused(
            val status: Int,
            val code: String,
            override val message: String,
        ) : Failure()

        /** Credentials are gone — revoked, rotated, or the terminal unpaired. */
        data object Unauthenticated : Failure() {
            private fun readResolve(): Any = Unauthenticated
            override val message: String
                get() = "This terminal's credentials are no longer valid."
        }
    }

    // -----------------------------------------------------------------------
    // Credentials
    // -----------------------------------------------------------------------

    /**
     * Claim an identity.
     *
     * Idempotent on the installation id: a terminal that has been reinstalled,
     * or that lost its token but kept its installation id, gets the same Saarthi
     * identity back rather than accumulating a new pending enrolment on every
     * launch.
     */
    suspend fun enrol(deviceModel: String?, osVersion: String?): EnrolResponse {
        val response = post(
            path = "/api/v1/device-gateway/enroll",
            body = EnrolRequest(
                installationId = identity.installationId,
                deviceModel = deviceModel,
                osVersion = osVersion,
                appVersion = appVersion,
            ),
            requestSerializer = EnrolRequest.serializer(),
            responseSerializer = EnrolResponse.serializer(),
            authenticated = false,
        )
        identity.deviceIdentifier = response.deviceIdentifier
        identity.deviceSecret = response.secret
        identity.storeToken(response.token.accessToken, response.token.expiresIn)
        return response
    }

    /**
     * Exchange the secret for a short-lived token.
     *
     * Serialised. Several coroutines waking together must not each spend the
     * secret; the second one through the lock finds a valid token and returns it.
     */
    suspend fun refreshToken(): String = tokenLock.withLock {
        identity.validAccessToken()?.let { return@withLock it }

        val deviceIdentifier = identity.deviceIdentifier
        val secret = identity.deviceSecret
        if (deviceIdentifier.isNullOrBlank() || secret.isNullOrBlank()) {
            throw Failure.Unauthenticated
        }

        val issued = post(
            path = "/api/v1/device-gateway/token",
            body = TokenRequest(deviceIdentifier, secret),
            requestSerializer = TokenRequest.serializer(),
            responseSerializer = IssuedToken.serializer(),
            authenticated = false,
        )
        identity.storeToken(issued.accessToken, issued.expiresIn)
        issued.accessToken
    }

    private suspend fun bearer(): String = identity.validAccessToken() ?: refreshToken()

    // -----------------------------------------------------------------------
    // Terminal surface
    // -----------------------------------------------------------------------

    /**
     * The arrival photo of the driver signed on to this terminal.
     *
     * Bytes rather than a URL handed to an image loader. The endpoint
     * authenticates a *device*, so anything fetching it has to carry this
     * class's token — and threading that into a separate image pipeline would
     * mean a second place where the terminal's credential lives.
     *
     * Null when there is no photo, which is an ordinary answer: a driver may be
     * signed on from a session that predates the camera, and the cockpit falls
     * back to their name.
     */
    suspend fun selfieBytes(): ByteArray? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseUrl/api/v1/device-gateway/terminal/selfie")
            .get()
            .header("Authorization", "Bearer ${bearer()}")
            .header("X-Saarthi-Client", "terminal/$appVersion")
            .build()

        val response = try {
            client.newCall(request).execute()
        } catch (error: IOException) {
            throw Failure.Offline(error)
        }

        response.use { raw ->
            when {
                raw.isSuccessful -> raw.body?.bytes()
                raw.code == 401 -> throw Failure.Unauthenticated
                // 403 and 404 are both "there is no photo to show you" from the
                // cockpit's point of view, and neither is worth a banner.
                else -> null
            }
        }
    }

    suspend fun pair(request: PairRequest): PairResponse = post(
        "/api/v1/device-gateway/terminal/pair",
        request,
        PairRequest.serializer(),
        PairResponse.serializer(),
    )

    suspend fun state(): TerminalStateDto =
        get("/api/v1/device-gateway/terminal/state", TerminalStateDto.serializer())

    suspend fun vehicleQr(): TerminalVehicleQrDto =
        get("/api/v1/device-gateway/terminal/vehicle-qr", TerminalVehicleQrDto.serializer())

    suspend fun checklist(): ChecklistPreparationDto =
        get("/api/v1/device-gateway/terminal/checklist", ChecklistPreparationDto.serializer())

    suspend fun submitChecklist(request: SubmitChecklistRequest): ChecklistResultDto = post(
        "/api/v1/device-gateway/terminal/checklist",
        request,
        SubmitChecklistRequest.serializer(),
        ChecklistResultDto.serializer(),
    )

    suspend fun startTrip(request: TripEventRequest): TerminalSessionDto = post(
        "/api/v1/device-gateway/terminal/trip/start",
        request,
        TripEventRequest.serializer(),
        TerminalSessionDto.serializer(),
    )

    suspend fun completeTrip(request: TripEventRequest): TerminalSessionDto = post(
        "/api/v1/device-gateway/terminal/trip/complete",
        request,
        TripEventRequest.serializer(),
        TerminalSessionDto.serializer(),
    )

    suspend fun endSession(request: EndSessionRequest): TerminalSessionDto = post(
        "/api/v1/device-gateway/terminal/session/end",
        request,
        EndSessionRequest.serializer(),
        TerminalSessionDto.serializer(),
    )

    suspend fun driver(): TerminalDriverDto =
        get("/api/v1/device-gateway/terminal/driver", TerminalDriverDto.serializer())

    /** Null when the vehicle has never reported. Not an error — a fact. */
    suspend fun latestReading(): LatestReadingDto? =
        getNullable("/api/v1/device-gateway/terminal/telemetry/latest", LatestReadingDto.serializer())

    suspend fun nearby(
        service: String?,
        latitude: Double,
        longitude: Double,
        radiusKm: Int = 15,
        limit: Int = 20,
    ): NearbyResponse {
        val query = buildString {
            append("?latitude=").append(latitude)
            append("&longitude=").append(longitude)
            append("&radiusKm=").append(radiusKm)
            append("&limit=").append(limit)
            if (service != null) append("&service=").append(service)
        }
        return get("/api/v1/device-gateway/terminal/nearby$query", NearbyResponse.serializer())
    }

    /**
     * The route to one place.
     *
     * Asked for only once the driver has chosen somewhere. One routing call per
     * decision, not one per row in a list they scrolled past — routing is the
     * one part of the map stack that costs a fleet money.
     */
    suspend fun searchPlaces(request: PlaceSearchRequest): List<PlaceMatchDto> = post(
        "/api/v1/device-gateway/terminal/search",
        request,
        PlaceSearchRequest.serializer(),
        ListSerializer(PlaceMatchDto.serializer()),
    )

    suspend fun route(request: RouteRequest): RouteDto = post(
        "/api/v1/device-gateway/terminal/route",
        request,
        RouteRequest.serializer(),
        RouteDto.serializer(),
    )

    /**
     * Open a trip for a run to a nearby service.
     *
     * Returns null when Saarthi decided there was nothing to open — the vehicle
     * is already on a dispatched trip, so the journey is already being recorded.
     * That is an outcome, not a failure, and it must not stop the driver
     * navigating.
     */
    suspend fun startServiceRun(request: StartServiceRunRequest): ServiceRunDto? =
        postNullable(
            "/api/v1/device-gateway/terminal/trip/service-run",
            request,
            StartServiceRunRequest.serializer(),
            ServiceRunDto.serializer(),
        )

    suspend fun finishServiceRun(request: FinishServiceRunRequest): ServiceRunDto? =
        postNullable(
            "/api/v1/device-gateway/terminal/trip/service-run/finish",
            request,
            FinishServiceRunRequest.serializer(),
            ServiceRunDto.serializer(),
        )

    /**
     * The service run already open on this vehicle, if any.
     *
     * A terminal that restarted mid-run — a flat battery on a forecourt, the app
     * killed for memory — comes back with no idea it had a trip open. Without
     * this it would open a second one for the same journey and split the
     * distance between them.
     */
    suspend fun openServiceRun(): ServiceRunDto? =
        getNullable(
            "/api/v1/device-gateway/terminal/trip/service-run",
            ServiceRunDto.serializer(),
        )

    suspend fun reportOdometer(request: ReportOdometerRequest): OdometerDto = post(
        "/api/v1/device-gateway/terminal/odometer",
        request,
        ReportOdometerRequest.serializer(),
        OdometerDto.serializer(),
    )

    suspend fun reportIssue(request: ReportIssueRequest): IssueDto = post(
        "/api/v1/device-gateway/terminal/issues",
        request,
        ReportIssueRequest.serializer(),
        IssueDto.serializer(),
    )

    suspend fun issues(): List<IssueDto> =
        get("/api/v1/device-gateway/terminal/issues", ListSerializer(IssueDto.serializer()))

    suspend fun ask(request: AskRequest): AskResponse = post(
        "/api/v1/device-gateway/terminal/ai/ask",
        request,
        AskRequest.serializer(),
        AskResponse.serializer(),
    )

    /**
     * The raw JSON body of a terminal GET.
     *
     * Used by the passport and maintenance screens, which render a large,
     * loosely-shaped payload the server assembles from six existing services.
     * Mirroring all of that as Kotlin data classes would be several hundred
     * lines that break every time an unrelated analytics field is added, for a
     * screen that displays it as labelled rows.
     */
    suspend fun rawJson(path: String): String = requestRaw("GET", path, null)

    // -----------------------------------------------------------------------
    // The existing device gateway — reused, not re-declared
    // -----------------------------------------------------------------------

    suspend fun sendTelemetry(batch: TelemetryBatch): IngestAck = post(
        "/api/v1/device-gateway/telemetry",
        batch,
        TelemetryBatch.serializer(),
        IngestAck.serializer(),
    )

    suspend fun heartbeat(request: HeartbeatRequest) {
        requestRaw(
            method = "POST",
            path = "/api/v1/device-gateway/heartbeat",
            body = json.encodeToString(HeartbeatRequest.serializer(), request),
        )
    }

    suspend fun raiseSos(request: SosRequest): SosResponse = post(
        "/api/v1/device-gateway/sos",
        request,
        SosRequest.serializer(),
        SosResponse.serializer(),
    )

    // -----------------------------------------------------------------------
    // Transport
    // -----------------------------------------------------------------------

    private suspend fun <R> get(path: String, responseSerializer: KSerializer<R>): R =
        decode(requestRaw("GET", path, null), responseSerializer)

    private suspend fun <R> getNullable(path: String, responseSerializer: KSerializer<R>): R? {
        val body = requestRaw("GET", path, null)
        return json.decodeFromString(ApiEnvelope.serializer(responseSerializer), body).data
    }

    private suspend fun <B, R> post(
        path: String,
        body: B,
        requestSerializer: KSerializer<B>,
        responseSerializer: KSerializer<R>,
        authenticated: Boolean = true,
    ): R = decode(
        requestRaw(
            method = "POST",
            path = path,
            body = json.encodeToString(requestSerializer, body),
            authenticated = authenticated,
        ),
        responseSerializer,
    )

    /**
     * A POST whose success case may legitimately carry no record.
     *
     * Distinct from [post], which treats an empty envelope as a fault. Saarthi
     * answers "there was nothing to open" with a null body on the service-run
     * endpoints — a vehicle already on a dispatched trip is already being
     * recorded — and turning that into an exception would surface a red banner
     * in the cab for a decision that was entirely correct.
     */
    private suspend fun <B, R> postNullable(
        path: String,
        body: B,
        requestSerializer: KSerializer<B>,
        responseSerializer: KSerializer<R>,
    ): R? {
        val raw = requestRaw(
            method = "POST",
            path = path,
            body = json.encodeToString(requestSerializer, body),
        )
        return json.decodeFromString(ApiEnvelope.serializer(responseSerializer), raw).data
    }

    private fun <R> decode(raw: String, responseSerializer: KSerializer<R>): R =
        json.decodeFromString(ApiEnvelope.serializer(responseSerializer), raw).data
            ?: throw Failure.Refused(
                200,
                "EMPTY_RESPONSE",
                "Saarthi answered but sent nothing back.",
            )

    /**
     * One request, with exactly one retry after a token refresh.
     *
     * Exactly one, deliberately. A loop that keeps refreshing on 401 turns a
     * revoked terminal into a tablet hammering the token endpoint for as long as
     * it has power, and the fleet finds out from the data bill.
     */
    suspend fun requestRaw(
        method: String,
        path: String,
        body: String?,
        authenticated: Boolean = true,
        retryAfterRefresh: Boolean = true,
    ): String = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url("$baseUrl$path")

        when (method) {
            "GET" -> builder.get()
            "POST" -> builder.post((body ?: "{}").toRequestBody(JSON_MEDIA))
            else -> throw IllegalArgumentException("Unsupported method $method")
        }

        if (authenticated) builder.header("Authorization", "Bearer ${bearer()}")
        builder.header("Accept", "application/json")
        builder.header("X-Saarthi-Client", "terminal/$appVersion")

        val response = try {
            client.newCall(builder.build()).execute()
        } catch (error: IOException) {
            // Never reported as a refusal. Blaming the fleet's configuration for
            // a tunnel sends somebody to check a setting that was always right.
            throw Failure.Offline(error)
        }

        response.use { raw ->
            val payload = raw.body?.string().orEmpty()
            if (raw.isSuccessful) return@withContext payload

            if (raw.code == 401 && authenticated && retryAfterRefresh) {
                identity.clearToken()
                refreshToken()
                return@withContext requestRaw(
                    method,
                    path,
                    body,
                    authenticated,
                    retryAfterRefresh = false,
                )
            }

            if (raw.code == 401) {
                // Logged before it is thrown. Every other refusal leaves a line
                // in the log and this one did not, so a terminal whose token had
                // gone stale failed every request in complete silence — the
                // button was pressed, nothing happened, and the log showed only
                // the unrelated traffic around it.
                DebugLog.warn("api", "401 $method $path — credentials rejected")
                throw Failure.Unauthenticated
            }

            val error = runCatching {
                json.decodeFromString(
                    ApiEnvelope.serializer(String.serializer()),
                    payload,
                ).error
            }.getOrNull()

            // The path and the status. Never the body, which on some endpoints
            // carries the very credential this method just used.
            DebugLog.warn("api", "${raw.code} $method $path — ${error?.code ?: "no code"}")

            throw Failure.Refused(
                status = raw.code,
                code = error?.code ?: "HTTP_${raw.code}",
                message = error?.message ?: "Saarthi refused that request.",
            )
        }
    }

    private companion object {
        val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}
