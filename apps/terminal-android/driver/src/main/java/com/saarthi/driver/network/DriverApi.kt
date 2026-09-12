package com.saarthi.driver.network

import com.saarthi.core.CoreConfig
import com.saarthi.core.util.DebugLog
import com.saarthi.driver.data.DriverAccountStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * The half of Saarthi a driver talks to as a person.
 *
 * Separate from `SaarthiApi` in `:core`, and the separation is the point. That
 * client authenticates as a *device* and speaks to the device gateway; this one
 * authenticates as a *person* and speaks to the ordinary API. The two
 * credential populations are kept apart everywhere else in Saarthi — a device
 * token cannot approve anything, a user token cannot ingest telemetry — and
 * folding them into one client here would be the first place that stopped being
 * true.
 *
 * The driver app holds both at once: this one to sign in, scan a vehicle and be
 * approved onto it, and the device one afterwards to run the cockpit. Which is
 * exactly how the real thing works — the fleet approves a person, and the phone
 * then becomes the truck's terminal.
 */
class DriverApi(
    baseUrl: String,
    private val account: DriverAccountStore,
) {

    @Volatile
    var baseUrl: String = baseUrl.trimEnd('/')
        private set

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
        coerceInputValues = true
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    /** One refresh at a time, however many requests noticed the expiry. */
    private val refreshLock = Mutex()

    /** What went wrong, in the shape a screen can act on. */
    sealed class Failure(override val message: String) : Exception(message) {
        /** No usable connection. Wait, do not re-enter a password. */
        class Offline(cause: Throwable) : Failure("No connection to Saarthi.") {
            init {
                initCause(cause)
            }
        }

        /** Signed out, or never signed in. The app returns to sign-in. */
        data object SignedOut : Failure("Please sign in again.") {
            private fun readResolve(): Any = SignedOut
        }

        /** The server refused, and said why in words worth showing. */
        class Refused(val status: Int, message: String) : Failure(message)
    }

    // -----------------------------------------------------------------------
    // Being a person
    // -----------------------------------------------------------------------

    @Serializable
    data class SignInRequest(val email: String, val password: String)

    @Serializable
    data class RegisterRequest(
        val email: String,
        val password: String,
        val firstName: String,
        val lastName: String,
        /**
         * Required, not optional.
         *
         * `registerSchema` takes a bare `phoneSchema` for every account type,
         * so a driver who left it blank was rejected by the server after
         * filling the whole form in. It is also the number a fleet rings when a
         * vehicle stops reporting, which is reason enough on its own.
         */
        val phone: String,
        /**
         * The commercial driving licence number.
         *
         * `registerSchema.superRefine` requires it specifically for DRIVER, and
         * asking for it here is honest about what the account is for.
         */
        val licenseNumber: String,
        /*
         * Both of these are fixed, and both are required by the server.
         *
         * This app registers drivers and nothing else, so the role is not a
         * question to put to somebody who has just installed it. Terms are
         * accepted by the sentence above the button on the sign-in screen —
         * `z.literal(true)` means the server will not take anything else, and
         * `encodeDefaults = true` above is what puts them both on the wire.
         */
        val role: String = "DRIVER",
        val acceptedTerms: Boolean = true,
    )

    @Serializable
    data class SessionUser(
        val id: String,
        val firstName: String = "",
        val lastName: String = "",
        val email: String = "",
    )

    @Serializable
    data class SessionDto(val user: SessionUser? = null)

    @Serializable
    data class AuthDto(
        val accessToken: String,
        val expiresIn: Long = 900,
        /**
         * Present only for native clients.
         *
         * A browser gets this as an httpOnly cookie it cannot read. The app
         * sends `X-Saarthi-Client` on every request, which is what makes the
         * server hand it over — and it is the whole reason a driver signs in
         * once rather than every shift.
         */
        val refreshToken: String? = null,
        val session: SessionDto? = null,
    )

    suspend fun signIn(email: String, password: String): DriverAccountStore.Account =
        authenticate(
            "/api/v1/auth/login",
            json.encodeToString(SignInRequest.serializer(), SignInRequest(email, password)),
        )

    suspend fun register(request: RegisterRequest): DriverAccountStore.Account =
        authenticate(
            "/api/v1/auth/register",
            json.encodeToString(RegisterRequest.serializer(), request),
        )

    /**
     * Get back in without asking the driver anything.
     *
     * Called on launch. A failure here is not an error to show — it means the
     * thirty days elapsed, or the fleet revoked the session, and the honest
     * response is the sign-in screen rather than a message about tokens.
     */
    suspend fun restore(): DriverAccountStore.Account? {
        val refresh = account.refreshToken ?: return null
        return try {
            refreshLock.withLock {
                authenticate("/api/v1/auth/refresh", buildRefreshBody(refresh))
            }
        } catch (error: Failure) {
            DebugLog.debug(TAG, "Could not restore the session: ${error.message}")
            if (error is Failure.Refused || error is Failure.SignedOut) account.clear()
            null
        }
    }

    /**
     * Restore a session from a credential Quick Login just unsealed.
     *
     * The same exchange `restore` performs, with the token supplied rather than
     * read from the account store — because when Quick Login is on, the store
     * does not have it. The server is still the authority: an unlocked PIN says
     * who is holding the phone, and only this call can say the session lives.
     */
    suspend fun restoreWith(refreshToken: String): DriverAccountStore.Account? = try {
        refreshLock.withLock {
            authenticate("/api/v1/auth/refresh", buildRefreshBody(refreshToken))
        }
    } catch (error: Failure) {
        DebugLog.debug(TAG, "Unsealed credential was refused: ${error.message}")
        null
    }

    private suspend fun authenticate(path: String, body: String): DriverAccountStore.Account {
        val raw = send("POST", path, body, authenticated = false)
        val auth = json.decodeFromString(Envelope.serializer(AuthDto.serializer()), raw).data
            ?: throw Failure.Refused(200, "Saarthi answered but sent nothing back.")

        val user = auth.session?.user
            ?: throw Failure.Refused(200, "Saarthi did not say who signed in.")

        val stored = DriverAccountStore.Account(
            userId = user.id,
            name = listOf(user.firstName, user.lastName).filter { it.isNotBlank() }
                .joinToString(" ")
                .ifBlank { user.email },
            email = user.email,
        )
        account.store(stored, auth.accessToken, auth.expiresIn, auth.refreshToken)
        return stored
    }

    /**
     * The refresh body, built through the serialiser rather than by hand.
     *
     * A token interpolated into a JSON string literal is a token that breaks
     * the payload the moment it contains a quote or a backslash. Base64url
     * tokens do not today, which is exactly why the hand-rolled version worked
     * and would have failed silently the day the format changed.
     */
    private fun buildRefreshBody(refreshToken: String): String =
        json.encodeToString(RefreshRequest.serializer(), RefreshRequest(refreshToken))

    @Serializable
    private data class RefreshRequest(val refreshToken: String)

    /** Give up the session on this phone, and tell the server to forget it. */
    suspend fun signOut() {
        runCatching { send("POST", "/api/v1/auth/logout", "{}", authenticated = true) }
        account.clear()
    }

    // -----------------------------------------------------------------------
    // Arriving at a vehicle
    // -----------------------------------------------------------------------

    /**
     * Which vehicle, and how the driver named it.
     *
     * Exactly one of the two, which the server also enforces. Sending both
     * would be an app that cannot decide, and silently preferring one would
     * make the other's failures impossible to explain.
     */
    @Serializable
    data class RequestAssignment(
        val qrToken: String? = null,
        val registrationNumber: String? = null,
        val latitude: Double? = null,
        val longitude: Double? = null,
    )

    @Serializable
    data class AssignmentDto(
        val id: String,
        val status: String,
        val vehicleId: String? = null,
        val registrationNumber: String? = null,
        val selfieCapturedAt: String? = null,
        val submittedAt: String? = null,
        val decidedAt: String? = null,
        val rejectionReason: String? = null,
    )

    /**
     * Scan a vehicle's QR and ask to drive it.
     *
     * Scanning is not authorisation. This opens a request and nothing more —
     * the fleet still decides, exactly as it does when a tablet is fitted.
     */
    suspend fun requestAssignmentByQr(
        qrToken: String,
        latitude: Double?,
        longitude: Double?,
    ): AssignmentDto = requestAssignment(
        RequestAssignment(qrToken = qrToken, latitude = latitude, longitude = longitude),
    )

    /**
     * Ask to drive the vehicle whose number the driver typed.
     *
     * For a sticker that is peeling, filthy, or on a trailer parked nose-in
     * against a wall. Normalisation happens on the server with the same
     * function that normalised the number on its way into the database, so the
     * app deliberately sends what the driver typed rather than guessing at a
     * second format.
     */
    suspend fun requestAssignmentByNumber(
        registrationNumber: String,
        latitude: Double?,
        longitude: Double?,
    ): AssignmentDto = requestAssignment(
        RequestAssignment(
            registrationNumber = registrationNumber,
            latitude = latitude,
            longitude = longitude,
        ),
    )

    private suspend fun requestAssignment(body: RequestAssignment): AssignmentDto = post(
        "/api/v1/terminal/assignments/request",
        json.encodeToString(RequestAssignment.serializer(), body),
        AssignmentDto.serializer(),
    )

    /** The request this driver already has open, if any. Survives a reinstall. */
    suspend fun myAssignment(): AssignmentDto? {
        val raw = send("GET", "/api/v1/terminal/assignments/mine", null)
        return json.decodeFromString(Envelope.serializer(AssignmentDto.serializer()), raw).data
    }

    /** Attach the arrival photograph. Retaking before submission replaces it. */
    suspend fun uploadSelfie(assignmentId: String, jpeg: ByteArray): AssignmentDto =
        withContext(Dispatchers.IO) {
            val body = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart(
                    "file",
                    "selfie.jpg",
                    jpeg.toRequestBody("image/jpeg".toMediaType()),
                )
                .build()

            val request = Request.Builder()
                .url("$baseUrl/api/v1/terminal/assignments/$assignmentId/selfie")
                .post(body)
                .header("Authorization", "Bearer ${bearer()}")
                .header("X-Saarthi-Client", "driver/${CoreConfig.versionName}")
                .build()

            val raw = execute(request)
            json.decodeFromString(Envelope.serializer(AssignmentDto.serializer()), raw).data
                ?: throw Failure.Refused(200, "Saarthi did not confirm the photo.")
        }

    /** Send the request to the fleet. */
    suspend fun submit(assignmentId: String): AssignmentDto = post(
        "/api/v1/terminal/assignments/$assignmentId/submit",
        "{}",
        AssignmentDto.serializer(),
    )

    /** Withdraw it — the driver walked away, or scanned the wrong truck. */
    suspend fun cancel(assignmentId: String): AssignmentDto = post(
        "/api/v1/terminal/assignments/$assignmentId/cancel",
        "{}",
        AssignmentDto.serializer(),
    )

    @Serializable
    data class VehiclePairingDto(
        val pairingCode: String? = null,
        val registrationNumber: String? = null,
    )

    /**
     * Claim the vehicle, now that the fleet has approved this driver onto it.
     *
     * Returns an ordinary pairing code, which the app immediately redeems
     * through the device gateway. From that moment the phone is the vehicle's
     * terminal and the shared cockpit works exactly as it does on a tablet.
     */
    suspend fun vehiclePairing(assignmentId: String): VehiclePairingDto = post(
        "/api/v1/terminal/assignments/$assignmentId/vehicle-pairing",
        "{}",
        VehiclePairingDto.serializer(),
    )

    // -----------------------------------------------------------------------
    // Transport
    // -----------------------------------------------------------------------

    @Serializable
    private data class Envelope<T>(val success: Boolean = true, val data: T? = null, val error: ApiError? = null)

    @Serializable
    private data class ApiError(val code: String? = null, val message: String? = null)

    private suspend fun <T> post(path: String, body: String, serializer: KSerializer<T>): T {
        val raw = send("POST", path, body)
        return json.decodeFromString(Envelope.serializer(serializer), raw).data
            ?: throw Failure.Refused(200, "Saarthi answered but sent nothing back.")
    }

    /** A valid access token, refreshing once if the held one is stale. */
    private suspend fun bearer(): String {
        if (account.hasUsableAccessToken()) return account.accessToken!!
        refreshLock.withLock {
            if (account.hasUsableAccessToken()) return account.accessToken!!
            restore() ?: throw Failure.SignedOut
        }
        return account.accessToken ?: throw Failure.SignedOut
    }

    private suspend fun send(
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
        // The header that makes the server return a refresh token in the body.
        // Without it a driver signs in every time they open the app.
        builder.header("X-Saarthi-Client", "driver/${CoreConfig.versionName}")

        val request = builder.build()

        try {
            execute(request, authenticated)
        } catch (error: Failure.SignedOut) {
            if (!authenticated || !retryAfterRefresh) throw error
            // Exactly one retry. A loop that refreshes on every 401 turns a
            // revoked driver into a handset hammering the auth endpoint until
            // its battery dies.
            restore() ?: throw error
            send(method, path, body, authenticated, retryAfterRefresh = false)
        }
    }

    private fun execute(request: Request, authenticated: Boolean = true): String {
        val response = try {
            client.newCall(request).execute()
        } catch (error: IOException) {
            throw Failure.Offline(error)
        }

        response.use { raw ->
            val payload = raw.body?.string().orEmpty()
            if (raw.isSuccessful) return payload

            val parsed = runCatching {
                json.decodeFromString(Envelope.serializer(NoData.serializer()), payload).error
            }.getOrNull()

            /*
             * A 401 means two different things, and they must not read alike.
             *
             * On a request that carried a token it means the session is over —
             * expired, or revoked by the fleet — and the app should quietly go
             * back to sign-in. On sign-in itself there is no session to lose:
             * it means the email or the password is wrong, and the server says
             * so in the body.
             *
             * Both used to become `SignedOut`, so a driver who mistyped their
             * password on the sign-in screen was told "Please sign in again" —
             * on the sign-in screen, with no hint that anything was wrong with
             * what they typed. The server's own sentence is the useful one.
             */
            if (raw.code == 401) {
                if (authenticated) throw Failure.SignedOut
                throw Failure.Refused(
                    raw.code,
                    parsed?.message ?: "The email address or password is incorrect.",
                )
            }

            // The path and the status, never the body: a sign-in payload
            // carries the password this method just sent.
            DebugLog.warn(TAG, "${raw.code} ${request.method} ${request.url.encodedPath}")
            throw Failure.Refused(raw.code, parsed?.message ?: "Saarthi refused that request.")
        }
    }

    @Serializable
    private class NoData

    private companion object {
        const val TAG = "DriverApi"
        val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}
