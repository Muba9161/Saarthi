package com.saarthi.terminal.network

import com.saarthi.terminal.data.TerminalIdentityStore
import com.saarthi.terminal.util.DebugLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.random.Random

/**
 * The realtime link to Saarthi.
 *
 * The terminal's socket exists for one thing above all others: a driver
 * standing beside a truck watching this screen for an approval. Polling for
 * that would mean the difference between "approved" and the driver knowing it
 * is up to a poll interval, every time, and a person waiting in a yard notices
 * five seconds.
 *
 * Everything else the socket carries — commands, config changes — is a
 * convenience. The approval is not.
 *
 * The device socket is one-way by design on the server side, so this class does
 * not send anything except a keep-alive ping. Telemetry, heartbeats and
 * acknowledgements go over HTTP where they are validated, rate limited and
 * idempotent.
 */
class RealtimeClient(
    private val api: SaarthiApi,
    private val identity: TerminalIdentityStore,
    private val scope: CoroutineScope,
) {

    enum class Status { DISCONNECTED, CONNECTING, CONNECTED }

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    private val client = OkHttpClient.Builder()
        // OkHttp's own ping. A mobile network drops an idle connection without
        // telling either end, and a socket that looks open but is not is worse
        // than no socket at all — it is a driver waiting for a message that will
        // never arrive.
        .pingInterval(25, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private val _status = MutableStateFlow(Status.DISCONNECTED)
    val status: StateFlow<Status> = _status.asStateFlow()

    private val _messages = MutableSharedFlow<SocketMessage>(
        // A small replay so a screen that subscribes just after a message
        // arrives still sees it — the alternative is a race that shows up as a
        // terminal that missed exactly one approval.
        replay = 1,
        extraBufferCapacity = 32,
    )
    val messages: SharedFlow<SocketMessage> = _messages.asSharedFlow()

    private var socket: WebSocket? = null
    private var connectJob: Job? = null

    @Volatile private var shouldRun = false
    @Volatile private var attempt = 0

    fun start() {
        if (shouldRun) return
        shouldRun = true
        scheduleConnect(immediate = true)
    }

    fun stop() {
        shouldRun = false
        connectJob?.cancel()
        connectJob = null
        socket?.close(1000, "terminal stopping")
        socket = null
        _status.value = Status.DISCONNECTED
    }

    private fun scheduleConnect(immediate: Boolean = false) {
        if (!shouldRun) return
        connectJob?.cancel()
        connectJob = scope.launch {
            if (!immediate) delay(backoffMs())
            if (!shouldRun || !isActive) return@launch
            connect()
        }
    }

    /**
     * Exponential backoff with jitter.
     *
     * The jitter is not decoration. A fleet's terminals all lose signal at the
     * same tunnel and all reconnect at the same instant, and a synchronised
     * fleet is a thundering herd against the gateway at exactly the moment it is
     * least able to absorb one.
     */
    private fun backoffMs(): Long {
        val base = min(INITIAL_BACKOFF_MS shl min(attempt, 6), MAX_BACKOFF_MS)
        val jitter = (base * JITTER_RATIO * Random.nextDouble(-1.0, 1.0)).toLong()
        return (base + jitter).coerceAtLeast(500L)
    }

    private suspend fun connect() {
        _status.value = Status.CONNECTING
        attempt += 1

        val token = try {
            identity.validAccessToken() ?: api.refreshToken()
        } catch (error: Throwable) {
            // No credentials means no socket, and no amount of retrying fixes
            // that — but the loop keeps running, because a terminal that has just
            // been re-paired should reconnect without being restarted.
            DebugLog.warn("realtime", "No token for the socket: ${error.message}")
            _status.value = Status.DISCONNECTED
            scheduleConnect()
            return
        }

        val url = api.baseUrl
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://") + "/ws/device?token=$token"

        val request = Request.Builder().url(url).build()

        socket = client.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    attempt = 0
                    _status.value = Status.CONNECTED
                    DebugLog.info("realtime", "Socket connected")
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val message = runCatching {
                        json.decodeFromString(SocketMessage.serializer(), text)
                    }.getOrNull() ?: return
                    _messages.tryEmit(message)
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(1000, null)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    _status.value = Status.DISCONNECTED
                    // 4401 is the server saying the credentials are gone. Retrying
                    // is still correct — the terminal may be re-paired at any
                    // moment — but the backoff keeps it from becoming a loop.
                    DebugLog.info("realtime", "Socket closed ($code)")
                    scheduleConnect()
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    _status.value = Status.DISCONNECTED
                    DebugLog.debug("realtime", "Socket failed: ${t.message}")
                    scheduleConnect()
                }
            },
        )
    }

    /** Keep-alive, so a NAT on a mobile network does not quietly drop the link. */
    fun ping() {
        socket?.send("""{"type":"ping"}""")
    }

    private companion object {
        const val INITIAL_BACKOFF_MS = 2_000L
        const val MAX_BACKOFF_MS = 120_000L
        const val JITTER_RATIO = 0.2
    }
}
