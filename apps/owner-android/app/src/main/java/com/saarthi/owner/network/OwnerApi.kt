package com.saarthi.owner.network

import android.util.Log
import com.saarthi.owner.data.AccountType
import com.saarthi.owner.data.SessionStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Saarthi's API, as a signed-in owner or business reaches it.
 *
 * The same contract the web app uses — `{ success, data, error }` envelopes
 * under `/api/v1` — with the one difference every Saarthi app has: it sends
 * `X-Saarthi-Client`, so the server returns the refresh token in the body
 * instead of a browser cookie, and the person signs in once rather than every
 * time the app is opened.
 */
class OwnerApi(
    baseUrl: String,
    private val clientVersion: String,
    private val session: SessionStore,
) {

    private val baseUrl: String = baseUrl.trimEnd('/')

    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
        coerceInputValues = true
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    /** One refresh at a time, however many requests noticed the expiry. */
    private val refreshLock = Mutex()

    /** What went wrong, in the shape a screen can act on. */
    sealed class Failure(override val message: String) : Exception(message) {
        /** No usable connection. Wait, do not re-enter a password. */
        class Offline(cause: Throwable) : Failure("No connection to Saarthi. Check the internet and try again.") {
            init {
                initCause(cause)
            }
        }

        /** Signed out, or never signed in. The app returns to sign-in. */
        data object SignedOut : Failure("Please sign in again.") {
            private fun readResolve(): Any = SignedOut
        }

        /** The server refused, and said why in words worth showing. */
        class Refused(val status: Int, message: String, val code: String? = null) : Failure(message)
    }

    // -----------------------------------------------------------------------
    // Being signed in
    // -----------------------------------------------------------------------

    @Serializable
    private data class SignInRequest(val email: String, val password: String)

    @Serializable
    private data class RefreshRequest(val refreshToken: String)

    @Serializable
    private data class SessionUser(
        val id: String,
        val firstName: String = "",
        val lastName: String = "",
        val email: String = "",
        val status: String = "ACTIVE",
    )

    @Serializable
    private data class SessionOrganization(
        val id: String = "",
        val name: String = "",
        val type: String? = null,
        val membershipRole: String = "",
        val isPersonalSeat: Boolean = false,
        val billingArchivedAt: String? = null,
    )

    @Serializable
    private data class SessionSubscription(val planTier: String? = null, val planName: String? = null)

    @Serializable
    private data class SessionDto(
        val user: SessionUser? = null,
        val organization: SessionOrganization? = null,
        val organizations: List<SessionOrganization> = emptyList(),
        val subscription: SessionSubscription? = null,
        val driver: JsonObject? = null,
        val permissions: List<String> = emptyList(),
    )

    @Serializable
    private data class AuthDto(
        val accessToken: String,
        val expiresIn: Long = 900,
        /** Present only because this app sends `X-Saarthi-Client`. */
        val refreshToken: String? = null,
        val session: SessionDto? = null,
    )

    suspend fun signIn(email: String, password: String): SessionStore.Account =
        authenticate(
            "/api/v1/auth/login",
            json.encodeToString(SignInRequest.serializer(), SignInRequest(email.trim(), password)),
        )

    @Serializable
    private data class ForgotRequest(val email: String)

    @Serializable
    private data class ForgotReply(val message: String = "")

    /**
     * Ask for a password-reset email.
     *
     * The server answers the same whether or not the address has an account,
     * so the sentence it returns is the one to show.
     */
    suspend fun forgotPassword(email: String): String {
        val raw = send(
            "POST",
            "/api/v1/auth/forgot-password",
            json.encodeToString(ForgotRequest.serializer(), ForgotRequest(email.trim())),
            authenticated = false,
        )
        return json.decodeFromString(Envelope.serializer(ForgotReply.serializer()), raw).data?.message
            ?.ifBlank { null }
            ?: "If an account exists for that email address, we have emailed it a password reset link."
    }

    /**
     * Get back in without asking anything.
     *
     * Called on launch. A refusal means the thirty days elapsed or the session
     * was revoked, and the honest answer is the sign-in screen.
     */
    suspend fun restore(): SessionStore.Account? {
        val refresh = session.refreshToken ?: return null
        return try {
            authenticate(
                "/api/v1/auth/refresh",
                json.encodeToString(RefreshRequest.serializer(), RefreshRequest(refresh)),
            )
        } catch (error: Failure) {
            if (error is Failure.Refused || error is Failure.SignedOut) session.clear()
            if (error is Failure.Offline) throw error
            null
        }
    }

    /**
     * Give up the session on this phone, and tell the server to forget it.
     *
     * The server ends the session the access token belongs to, so the token is
     * what goes; the phone forgets everything whether or not that call lands.
     */
    suspend fun signOut() {
        runCatching { send("POST", "/api/v1/auth/logout", "{}", retryAfterRefresh = false) }
        session.clear()
    }

    private suspend fun authenticate(path: String, body: String): SessionStore.Account {
        val raw = send("POST", path, body, authenticated = false)
        val auth = json.decodeFromString(Envelope.serializer(AuthDto.serializer()), raw).data
            ?: throw Failure.Refused(200, "Saarthi answered but sent nothing back.")
        return adopt(auth)
    }

    @Serializable
    private data class SwitchRequest(val organizationId: String)

    /**
     * Act for another of this person's businesses. The server moves the
     * session itself, so the choice survives a restart and a refresh.
     */
    suspend fun switchOrganization(organizationId: String): SessionStore.Account {
        val raw = send(
            "POST",
            "/api/v1/auth/switch-organization",
            json.encodeToString(SwitchRequest.serializer(), SwitchRequest(organizationId)),
        )
        val auth = json.decodeFromString(Envelope.serializer(AuthDto.serializer()), raw).data
            ?: throw Failure.Refused(200, "Saarthi answered but sent nothing back.")
        // Only the access token changes hands here; the refresh token stays as it was.
        return if (auth.session != null) adopt(auth) else restore() ?: throw Failure.SignedOut
    }

    private fun adopt(auth: AuthDto): SessionStore.Account {
        val payload = auth.session ?: throw Failure.Refused(200, "Saarthi did not say who signed in.")
        val user = payload.user ?: throw Failure.Refused(200, "Saarthi did not say who signed in.")
        val organization = payload.organization

        val account = SessionStore.Account(
            userId = user.id,
            firstName = user.firstName.ifBlank { user.email.substringBefore('@') },
            fullName = listOf(user.firstName, user.lastName).filter { it.isNotBlank() }
                .joinToString(" ")
                .ifBlank { user.email },
            email = user.email,
            organizationName = organization?.name.orEmpty(),
            accountType = AccountType.of(
                organizationType = organization?.type,
                personalSeat = organization?.isPersonalSeat == true,
                planTier = payload.subscription?.planTier,
                isDriver = payload.driver != null,
            ),
            membershipRole = organization?.membershipRole.orEmpty(),
            planName = payload.subscription?.planName,
            paused = user.status != "ACTIVE" || organization?.billingArchivedAt != null,
            permissions = payload.permissions.toSet(),
            businesses = payload.organizations
                .filter { it.id.isNotBlank() && it.type != null }
                .map { SessionStore.Business(it.id, it.name, it.type.orEmpty()) },
            organizationId = organization?.id.orEmpty(),
        )
        session.store(account, auth.accessToken, auth.expiresIn, auth.refreshToken)
        return account
    }

    // -----------------------------------------------------------------------
    // Signed-in calls
    // -----------------------------------------------------------------------

    /** A signed-in GET. Null when the server answered with no data. */
    suspend fun <T> get(path: String, serializer: KSerializer<T>): T? {
        val raw = send("GET", "/api/v1$path", null)
        return json.decodeFromString(Envelope.serializer(serializer), raw).data
    }

    /** A signed-in POST. */
    suspend fun <T> post(path: String, body: String, serializer: KSerializer<T>): T? {
        val raw = send("POST", "/api/v1$path", body)
        return json.decodeFromString(Envelope.serializer(serializer), raw).data
    }

    /** A signed-in PATCH — a partial change to something already there. */
    suspend fun <T> patch(path: String, body: String, serializer: KSerializer<T>): T? {
        val raw = send("PATCH", "/api/v1$path", body)
        return json.decodeFromString(Envelope.serializer(serializer), raw).data
    }

    /**
     * The bytes behind a URL the API itself handed out — an arrival photo.
     * Only Saarthi's own addresses are followed, so the token never leaves it.
     */
    suspend fun image(url: String): ByteArray? = withContext(Dispatchers.IO) {
        val full = if (url.startsWith("/")) "$baseUrl$url" else url
        if (!full.startsWith(baseUrl)) return@withContext null
        val request = Request.Builder().url(full).header("Authorization", "Bearer ${bearer()}").build()
        runCatching {
            client.newCall(request).execute().use { response -> if (response.isSuccessful) response.body?.bytes() else null }
        }.getOrNull()
    }

    /** A signed-in DELETE. */
    suspend fun delete(path: String) {
        send("DELETE", "/api/v1$path", null)
    }

    /**
     * Save the file behind a signed-in GET into [into] — a paper, or the RC
     * certificate — for a viewer app to open.
     *
     * A refusal throws with the server's own reason, as every other call does,
     * so "enter your Secure PIN" reaches the screen rather than an empty file.
     * Written beside the target and moved into place, so a dropped connection
     * never leaves half a PDF where a whole one is expected.
     */
    suspend fun download(path: String, into: File, retryAfterRefresh: Boolean = true) {
        try {
            withContext(Dispatchers.IO) {
                val request = Request.Builder()
                    .url("$baseUrl/api/v1$path")
                    .header("Authorization", "Bearer ${bearer()}")
                    .header("X-Saarthi-Client", "owner/$clientVersion")
                    .build()
                val response = try {
                    client.newCall(request).execute()
                } catch (error: IOException) {
                    throw Failure.Offline(error)
                }
                response.use { raw ->
                    if (!raw.isSuccessful) refuse(raw.code, raw.body?.string().orEmpty(), request, authenticated = true)
                    val body = raw.body ?: throw Failure.Refused(raw.code, "Saarthi sent an empty file.")
                    into.parentFile?.mkdirs()
                    val partial = File(into.parentFile, "${into.name}.part")
                    try {
                        body.byteStream().use { input -> partial.outputStream().use { input.copyTo(it) } }
                    } catch (error: IOException) {
                        partial.delete()
                        throw Failure.Offline(error)
                    }
                    into.delete()
                    if (!partial.renameTo(into)) throw IOException("Could not save ${into.name}")
                }
            }
        } catch (error: Failure.SignedOut) {
            if (!retryAfterRefresh) throw error
            refreshLock.withLock { restore() } ?: throw error
            download(path, into, retryAfterRefresh = false)
        }
    }

    /** A valid access token, refreshing once if the held one is stale. */
    private suspend fun bearer(): String {
        if (session.hasUsableAccessToken()) return session.accessToken!!
        refreshLock.withLock {
            if (session.hasUsableAccessToken()) return session.accessToken!!
            restore() ?: throw Failure.SignedOut
        }
        return session.accessToken ?: throw Failure.SignedOut
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
            "PATCH" -> builder.patch((body ?: "{}").toRequestBody(JSON_MEDIA))
            "DELETE" -> builder.delete()
            else -> throw IllegalArgumentException("Unsupported method $method")
        }
        if (authenticated) builder.header("Authorization", "Bearer ${bearer()}")
        builder.header("Accept", "application/json")
        builder.header("X-Saarthi-Client", "owner/$clientVersion")
        val request = builder.build()

        try {
            execute(request, authenticated)
        } catch (error: Failure.SignedOut) {
            if (!authenticated || !retryAfterRefresh) throw error
            // Exactly one retry: a loop that refreshes on every 401 hammers the
            // auth endpoint for a session that was revoked on purpose.
            refreshLock.withLock { restore() } ?: throw error
            send(method, path, body, authenticated, retryAfterRefresh = false)
        }
    }

    private fun execute(request: Request, authenticated: Boolean): String {
        val response = try {
            client.newCall(request).execute()
        } catch (error: IOException) {
            throw Failure.Offline(error)
        }
        response.use { raw ->
            val payload = raw.body?.string().orEmpty()
            if (raw.isSuccessful) return payload
            refuse(raw.code, payload, request, authenticated)
        }
    }

    /** A refused response, as the [Failure] a screen can act on. */
    private fun refuse(status: Int, payload: String, request: Request, authenticated: Boolean): Nothing {
        val parsed = runCatching {
            json.decodeFromString(Envelope.serializer(NoData.serializer()), payload).error
        }.getOrNull()

        // On a signed-in call a 401 means the session is over; on sign-in
        // itself it means the email or password is wrong, and says so.
        if (status == 401) {
            if (authenticated) throw Failure.SignedOut
            throw Failure.Refused(status, parsed?.message ?: "The email address or password is incorrect.")
        }
        // The path and status only — a sign-in body carries the password.
        Log.w(TAG, "$status ${request.method} ${request.url.encodedPath}")
        throw Failure.Refused(status, parsed?.message ?: "Saarthi refused that request.", parsed?.code)
    }

    @Serializable
    private class NoData

    private companion object {
        const val TAG = "OwnerApi"
        val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}

/** Every Saarthi response: the data, or the reason there is none. */
@Serializable
data class Envelope<T>(
    val success: Boolean = false,
    val data: T? = null,
    val error: ApiError? = null,
)

@Serializable
data class ApiError(val code: String? = null, val message: String? = null)

/** A page of a list, as every paginated route returns it. */
@Serializable
data class Page<T>(val items: List<T> = emptyList(), val pagination: Pagination = Pagination())

@Serializable
data class Pagination(val page: Int = 1, val total: Int = 0, val hasNextPage: Boolean = false)
