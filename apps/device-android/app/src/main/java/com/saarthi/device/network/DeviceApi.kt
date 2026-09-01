package com.saarthi.device.network

import com.saarthi.device.data.DeviceIdentityStore
import com.saarthi.device.util.DebugLog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.serializer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * The Saarthi device gateway client.
 *
 * One class, because there is only one server and the whole surface is a dozen
 * endpoints. A generated client would add a build step and a layer of
 * indirection to save less code than it costs.
 *
 * ## Credentials
 *
 * Requests carry a short-lived bearer token. The long-lived secret is used for
 * exactly one thing — minting that token — so it is on the wire twice a shift
 * rather than sixty times a minute. When a request comes back 401 the client
 * re-mints once and retries, and a second failure is surfaced: an endless
 * refresh loop against a revoked device would flatten a battery in an afternoon.
 *
 * ## Failure
 *
 * `ApiException` carries the HTTP status and Saarthi's own error code, because
 * the app genuinely needs to tell them apart. A 422 on `/location` means the
 * device was unpaired and should stop trying; a network timeout means it should
 * buffer and retry. Treating both as "failed" would either lose data or spin
 * forever.
 */
class ApiException(
    val status: Int,
    val code: String,
    override val message: String,
) : Exception(message) {

    /** The device is no longer allowed to report, and retrying will not help. */
    val isTerminal: Boolean
        get() = status == 401 || status == 403 || status == 422

    /** Saarthi already holds this, which is a success wearing a failure's clothes. */
    val isAlreadyKnown: Boolean
        get() = status == 409
}

class DeviceApi(private val identity: DeviceIdentityStore) {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    private val client = OkHttpClient.Builder()
        // Generous but finite. A truck on a weak 4G signal legitimately takes
        // several seconds to complete a round trip; a request with no ceiling
        // holds a wake lock until the radio gives up on its own.
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    /** Serialises token refreshes, so ten parallel 401s mint one token. */
    private val refreshLock = Mutex()

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    private fun url(path: String): String = "${identity.apiBaseUrl}$API_PREFIX$path"

    // -----------------------------------------------------------------------
    // Enrolment and credentials
    // -----------------------------------------------------------------------

    suspend fun enrol(request: EnrolRequest): EnrolResponse =
        post("/enroll", request, authenticated = false)

    /**
     * Exchange the stored secret for an access token.
     *
     * Sends the credentials in the body rather than in headers because that is
     * the form the backend documents for clients that cannot rely on custom
     * headers surviving a proxy — and it is one fewer thing to get wrong.
     */
    suspend fun refreshToken(): DeviceToken {
        val identifier = identity.deviceIdentifier
            ?: throw ApiException(401, "NO_IDENTITY", "This device has not enrolled yet.")
        val secret = identity.secret
            ?: throw ApiException(401, "NO_SECRET", "This device has no stored credentials.")

        val token: DeviceToken = post(
            "/token",
            TokenRequest(deviceIdentifier = identifier, secret = secret),
            authenticated = false,
        )
        identity.storeToken(token.accessToken, token.expiresIn)
        DebugLog.add("TOKEN REFRESHED")
        return token
    }

    // -----------------------------------------------------------------------
    // Identity, pairing and configuration
    // -----------------------------------------------------------------------

    suspend fun me(): DeviceIdentityDto = get("/me")

    suspend fun config(): DeviceConfigDto = get("/config")

    suspend fun pair(request: PairRequest): PairResponse = post("/pair", request)

    suspend fun unpair(reason: String?): DeviceIdentityDto =
        post("/unpair", UnpairRequest(reason))

    // -----------------------------------------------------------------------
    // Ingestion
    // -----------------------------------------------------------------------

    suspend fun sendLocations(batch: LocationBatch): IngestResult = post("/location", batch)

    suspend fun sendFrames(batch: TelemetryBatch): IngestResult = post("/telemetry", batch)

    suspend fun heartbeat(request: HeartbeatRequest): HeartbeatResponse =
        post("/heartbeat", request)

    // -----------------------------------------------------------------------
    // SOS, commands and video
    // -----------------------------------------------------------------------

    suspend fun raiseSos(request: SosRequest): SosResponse = post("/sos", request)

    suspend fun collectCommands(): List<DeviceCommandDto> =
        getList("/commands", DeviceCommandDto.serializer())

    suspend fun acknowledgeCommand(commandId: String, ack: CommandAck): DeviceCommandDto =
        post("/commands/$commandId/ack", ack)

    suspend fun publishTicket(channel: Int): PublishTicket =
        post("/camera/publish-ticket", PublishTicketRequest(channel))

    suspend fun endPublishing(sessionId: String) {
        postRaw("/camera/sessions/$sessionId/end", "{}")
    }

    /**
     * Tell Saarthi the camera is still streaming.
     *
     * Without this the server closes the session once nothing has claimed it
     * recently, and the camera's access log records every stream as one ticket
     * long however long the camera was actually on. For a lens pointed at a
     * driver that is the number that matters most, so it has to be true.
     */
    suspend fun keepPublishingAlive(sessionId: String) {
        postRaw("/camera/sessions/$sessionId/keepalive", "{}")
    }

    // -----------------------------------------------------------------------
    // Transport
    // -----------------------------------------------------------------------

    private suspend inline fun <reified T> get(path: String): T =
        decode(execute(buildRequest(path, null, authenticated = true)), serializer())

    private suspend fun <T> getList(path: String, element: KSerializer<T>): List<T> =
        decode(execute(buildRequest(path, null, authenticated = true)), ListSerializer(element))

    private suspend inline fun <reified B, reified T> post(
        path: String,
        body: B,
        authenticated: Boolean = true,
    ): T = decode(
        execute(buildRequest(path, json.encodeToString(serializer<B>(), body), authenticated)),
        serializer(),
    )

    private suspend fun postRaw(path: String, body: String) {
        execute(buildRequest(path, body, authenticated = true))
    }

    private fun buildRequest(path: String, body: String?, authenticated: Boolean): Request.Builder {
        val target = url(path)
        val builder = Request.Builder().url(target)
        if (body != null) builder.post(body.toRequestBody(jsonMedia)) else builder.get()
        if (authenticated) {
            identity.accessToken?.let { builder.header("Authorization", "Bearer $it") }
        }

        /*
         * Development tunnels.
         *
         * An anonymous VS Code dev tunnel answers the first request from a new
         * client with an anti-phishing interstitial — an HTML page warning that
         * the site is a tunnel. A browser shows it and the person clicks
         * through; this app would parse it as its API response and fail with a
         * serialisation error naming nothing useful.
         *
         * The header is the documented way to opt out, and it is sent only to
         * hosts that could serve one. Anywhere else it is a header nobody reads,
         * so there is no reason to make the caller think about it.
         */
        if (target.contains(".devtunnels.ms")) {
            builder.header("X-Tunnel-Skip-AntiPhishing-Page", "true")
        }

        return builder
    }

    /**
     * Send a request, refreshing the token once on a 401.
     *
     * Once, not repeatedly. A device whose credentials have been revoked —
     * unpaired, suspended, secret rotated — answers 401 to the refresh as well,
     * and a client that kept trying would hold the radio awake until the battery
     * gave out. One retry covers the only case that is actually recoverable: a
     * token that expired between being checked and being used.
     */
    private suspend fun execute(builder: Request.Builder): String = withContext(Dispatchers.IO) {
        if (builder.build().header("Authorization") != null && !identity.hasUsableToken()) {
            refreshLock.withLock {
                if (!identity.hasUsableToken()) refreshToken()
            }
            identity.accessToken?.let { builder.header("Authorization", "Bearer $it") }
        }

        val first = send(builder.build())
        if (first.status != 401) return@withContext first.unwrap()

        refreshLock.withLock {
            identity.clearToken()
            refreshToken()
        }
        identity.accessToken?.let { builder.header("Authorization", "Bearer $it") }
        send(builder.build()).unwrap()
    }

    private data class RawResponse(val status: Int, val body: String)

    private fun send(request: Request): RawResponse = try {
        client.newCall(request).execute().use { response ->
            RawResponse(response.code, response.body?.string().orEmpty())
        }
    } catch (error: IOException) {
        // A network failure is not an API failure. Reported as 0 so the caller
        // can tell "could not reach Saarthi" — buffer and retry — from "Saarthi
        // refused this" — stop and say why.
        throw ApiException(0, "NETWORK", error.message ?: "Could not reach Saarthi.")
    }

    /**
     * Turn a response into a body, or into an exception carrying Saarthi's own
     * error code.
     *
     * The message is passed through unchanged. The API writes its errors for a
     * person to read — "This pairing code has expired. Generate a new one." —
     * and rewording them here would lose that.
     */
    private fun RawResponse.unwrap(): String {
        if (status in 200..299) return body

        val parsed = runCatching {
            json.decodeFromString(ApiEnvelope.serializer(kotlinx.serialization.json.JsonElement.serializer()), body)
        }.getOrNull()

        throw ApiException(
            status = status,
            code = parsed?.error?.code ?: "HTTP_$status",
            message = parsed?.error?.message ?: "Saarthi returned an unexpected response.",
        )
    }

    private fun <T> decode(body: String, deserializer: KSerializer<T>): T {
        val envelope = json.decodeFromString(ApiEnvelope.serializer(deserializer), body)
        return envelope.data
            ?: throw ApiException(0, "EMPTY", "Saarthi returned an empty response.")
    }

    companion object {
        const val API_PREFIX = "/api/v1/device-gateway"
    }
}
