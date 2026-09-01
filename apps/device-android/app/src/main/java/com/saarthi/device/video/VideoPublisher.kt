package com.saarthi.device.video

import android.content.Context
import com.saarthi.device.util.DebugLog
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withTimeoutOrNull
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack

/**
 * Publishing this phone's camera as a live WebRTC stream.
 *
 * The piece that was missing: Saarthi already issued a real ticket and recorded
 * a real session, but nothing encoded or sent any frames. This does.
 *
 *     Camera2 ─▶ VideoSource ─▶ VideoTrack ─▶ PeerConnection ─▶ WHIP ─▶ gateway
 *                     └──────────────────────▶ local SurfaceViewRenderer
 *
 * ## One instance per process
 *
 * `PeerConnectionFactory.initialize` loads a native library and may only be
 * called once, and an `EglBase` context is expensive and shared by the encoder
 * and every renderer. So this is a singleton owned by the application, not
 * something a screen creates — a second instance would either crash on the
 * native init or silently fight the first one for the camera.
 *
 * ## Why the capture pipeline is separate from the connection
 *
 * The camera can be previewing without publishing, and publishing without a
 * screen attached. Those are genuinely independent: a driver opens the camera
 * screen to check the lens is not covered, and a dispatcher starts a stream on a
 * phone that is in somebody's pocket. Keeping capture and connection separate is
 * what lets both work, and lets a preview attach to a stream already running
 * rather than restarting it.
 *
 * ## Audio
 *
 * Deliberately not sent. The specification says "microphone where required", and
 * for a road-facing camera it is not required — a cabin microphone streaming
 * without a separate, explicit decision is a much bigger step than video, and it
 * should be somebody's choice rather than a default.
 */
class VideoPublisher private constructor(context: Context) {

    private val appContext = context.applicationContext

    /** Shared by the hardware encoder and every renderer. */
    val eglBase: EglBase = EglBase.create()

    private val factory: PeerConnectionFactory

    private var capturer: CameraVideoCapturer? = null
    private var surfaceHelper: SurfaceTextureHelper? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var audioTrack: AudioTrack? = null

    private var peerConnection: PeerConnection? = null
    private val whip = WhipClient()

    /** Renderers currently showing the local camera. */
    private val sinks = mutableSetOf<SurfaceViewRenderer>()

    private var currentCameraIsFront = false
    private var session: WhipClient.Session? = null
    private var sessionToken: String? = null

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    data class State(
        val capturing: Boolean = false,
        val publishing: Boolean = false,
        val connectionState: String = "IDLE",
        val channel: Int = 1,
        val sessionId: String? = null,
        val simulated: Boolean = false,
        val resolution: String? = null,
        val error: String? = null,
        /**
         * True once a stream has been asked for and not yet stopped by a person.
         *
         * The difference between "not streaming" and "streaming, currently
         * broken" — and the only thing that can tell a reconnect apart from
         * respecting a Stop. Losing Wi-Fi must not be read as the driver having
         * switched the camera off.
         */
        val wanted: Boolean = false,
        /** Consecutive failed attempts, for backoff and for the UI. */
        val attempts: Int = 0,
    )

    init {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(appContext)
                // Native tracing off: it is noisy, and on a device app the log it
                // produces is one more place a credential could end up.
                .setEnableInternalTracer(false)
                .createInitializationOptions(),
        )

        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(
                // Hardware where the phone has it, software as the fallback. On
                // the low-end Android the specification targets, software H.264
                // at 720p is the difference between a stream and a slideshow —
                // so hardware is tried first and VP8 is kept as the universal
                // fallback.
                DefaultVideoEncoderFactory(
                    eglBase.eglBaseContext,
                    /* enableIntelVp8Encoder = */ true,
                    /* enableH264HighProfile = */ true,
                ),
            )
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
    }

    // -----------------------------------------------------------------------
    // Capture
    // -----------------------------------------------------------------------

    /**
     * Start the camera.
     *
     * Idempotent, and switching channel restarts capture on the other lens.
     * Channel 1 is the road-facing (rear) camera and channel 2 the cabin
     * (front), matching the two Saarthi registers when the device pairs.
     */
    @Synchronized
    fun startCapture(channel: Int, width: Int = 1280, height: Int = 720, fps: Int = 15) {
        val wantFront = channel == 2

        if (_state.value.capturing && wantFront == currentCameraIsFront) {
            return
        }
        if (_state.value.capturing) {
            switchCamera(wantFront)
            _state.value = _state.value.copy(channel = channel)
            return
        }

        val enumerator = Camera2Enumerator(appContext)
        val deviceName = enumerator.deviceNames.firstOrNull {
            if (wantFront) enumerator.isFrontFacing(it) else enumerator.isBackFacing(it)
            // A phone with only one camera should still work rather than
            // refusing because the requested facing is unavailable.
        } ?: enumerator.deviceNames.firstOrNull()

        if (deviceName == null) {
            _state.value = _state.value.copy(error = "This phone has no usable camera.")
            return
        }

        val created = enumerator.createCapturer(deviceName, null)
        if (created == null) {
            _state.value = _state.value.copy(error = "The camera could not be opened.")
            return
        }

        val helper = SurfaceTextureHelper.create("SaarthiCapture", eglBase.eglBaseContext)
        val source = factory.createVideoSource(created.isScreencast)
        created.initialize(helper, appContext, source.capturerObserver)
        created.startCapture(width, height, fps)

        val track = factory.createVideoTrack("saarthi-video", source)
        track.setEnabled(true)
        sinks.forEach { track.addSink(it) }

        capturer = created
        surfaceHelper = helper
        videoSource = source
        videoTrack = track
        currentCameraIsFront = wantFront

        _state.value = _state.value.copy(
            capturing = true,
            channel = channel,
            resolution = "${width}x${height} @ ${fps}fps",
            error = null,
        )
        DebugLog.add("CAMERA STARTED ch$channel ${width}x$height@$fps")
    }

    private fun switchCamera(toFront: Boolean) {
        capturer?.switchCamera(object : CameraVideoCapturer.CameraSwitchHandler {
            override fun onCameraSwitchDone(isFrontCamera: Boolean) {
                currentCameraIsFront = isFrontCamera
                DebugLog.add("CAMERA SWITCHED to ${if (isFrontCamera) "cabin" else "road"}")
            }

            override fun onCameraSwitchError(errorDescription: String?) {
                DebugLog.add("CAMERA SWITCH FAILED: $errorDescription")
            }
        })
        currentCameraIsFront = toFront
    }

    @Synchronized
    fun stopCapture() {
        if (!_state.value.capturing) return

        runCatching { capturer?.stopCapture() }
        videoTrack?.let { track -> sinks.forEach { track.removeSink(it) } }
        videoTrack?.dispose()
        videoSource?.dispose()
        surfaceHelper?.dispose()
        runCatching { capturer?.dispose() }

        videoTrack = null
        videoSource = null
        surfaceHelper = null
        capturer = null

        _state.value = _state.value.copy(capturing = false, resolution = null)
        DebugLog.add("CAMERA STOPPED")
    }

    /**
     * Attach a preview surface.
     *
     * Works whether or not a stream is running, so opening the camera screen
     * during a live publish shows what is being sent rather than restarting it.
     */
    @Synchronized
    fun attachPreview(renderer: SurfaceViewRenderer) {
        sinks += renderer
        videoTrack?.addSink(renderer)
    }

    @Synchronized
    fun detachPreview(renderer: SurfaceViewRenderer) {
        videoTrack?.removeSink(renderer)
        sinks -= renderer
    }

    // -----------------------------------------------------------------------
    // Publishing
    // -----------------------------------------------------------------------

    /** Everything the gateway ticket tells this device to do. */
    data class Ticket(
        val sessionId: String,
        val ingestUrl: String,
        val token: String,
        val protocol: String,
        val simulated: Boolean,
        val maxWidth: Int,
        val maxHeight: Int,
        val maxFrameRate: Int,
        val maxBitrateKbps: Int,
        val iceServers: List<IceServerConfig>,
    )

    data class IceServerConfig(
        val urls: String,
        val username: String?,
        val credential: String?,
    )

    /**
     * Open a stream.
     *
     * The ticket's constraints are applied rather than negotiated: they are
     * Saarthi's decision about how much of a driver's uplink and data allowance
     * this may use, and a device that ignored them would make the control
     * decorative.
     */
    suspend fun publish(ticket: Ticket, channel: Int): Result<Unit> {
        // Marked wanted before anything can fail, so a failure on the first
        // attempt still schedules a retry rather than looking like a Stop.
        _state.value = _state.value.copy(wanted = true)
        closeConnection()

        startCapture(
            channel = channel,
            width = ticket.maxWidth,
            height = ticket.maxHeight,
            fps = ticket.maxFrameRate,
        )

        val track = videoTrack
            ?: return Result.failure(IllegalStateException("The camera is not available."))

        if (ticket.simulated) {
            // A mock ticket points at a gateway that does not exist. The capture
            // pipeline is left running — that half is genuinely working and
            // worth showing — but no offer is sent, because posting to nothing
            // and reporting a timeout would be a worse answer than the truth.
            _state.value = _state.value.copy(
                publishing = false,
                simulated = true,
                sessionId = ticket.sessionId,
                connectionState = "NO GATEWAY",
                error = null,
            )
            DebugLog.add("CAMERA PREVIEW ONLY — ticket is simulated, no gateway configured")
            return Result.success(Unit)
        }

        val iceServers = ticket.iceServers.map { config ->
            PeerConnection.IceServer.builder(config.urls)
                .setUsername(config.username.orEmpty())
                .setPassword(config.credential.orEmpty())
                .createIceServer()
        }

        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            // A gateway on the same LAN as the phone is the common case in
            // testing and a real one in a yard, so host candidates must be
            // gathered rather than forced through a relay.
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_ONCE
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
        }

        val gathered = CompletableDeferred<Unit>()

        /*
         * Completes when the media connection resolves, either way.
         *
         * Needed because an SDP exchange succeeding says nothing about
         * whether frames will flow: on mobile data against a gateway that
         * only advertises a LAN address, the handshake completes perfectly
         * and the connection then never establishes. Without waiting for
         * this, `publish` reported success, the phone showed Live, and the
         * dashboard answered 404 because no publisher had ever arrived.
         */
        val established = CompletableDeferred<Boolean>()

        val connection = factory.createPeerConnection(
            rtcConfig,
            object : PeerConnection.Observer {
                override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState?) {
                    if (newState == PeerConnection.IceGatheringState.COMPLETE) {
                        gathered.complete(Unit)
                    }
                }

                override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
                    val name = newState?.name ?: "UNKNOWN"
                    val connected = newState == PeerConnection.PeerConnectionState.CONNECTED
                    val broken =
                        newState == PeerConnection.PeerConnectionState.FAILED ||
                            newState == PeerConnection.PeerConnectionState.DISCONNECTED ||
                            newState == PeerConnection.PeerConnectionState.CLOSED

                    _state.value = _state.value.copy(
                        connectionState = name,
                        publishing = connected,
                        // Cleared on a good connection so a reconnect that
                        // succeeds stops reporting the failure that preceded it.
                        attempts = if (connected) 0 else _state.value.attempts,
                        error = if (connected) null else _state.value.error,
                    )
                    DebugLog.add("WEBRTC $name")

                    // Resolves the wait in `publish`. `complete` is a no-op
                    // once completed, so a later transition cannot rewrite
                    // the outcome of the attempt that has already returned.
                    if (connected) established.complete(true)

                    // The watcher in TelemetryService reads `broken` through the
                    // state flow and decides whether to retry. Deciding here
                    // would put a network policy inside the encoder.
                    if (broken) {
                        established.complete(false)
                        DebugLog.add("CAMERA STREAM LOST ($name)")
                    }
                }

                override fun onIceCandidate(candidate: IceCandidate?) = Unit
                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
                override fun onSignalingChange(state: PeerConnection.SignalingState?) = Unit
                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) = Unit
                override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
                override fun onAddStream(stream: MediaStream?) = Unit
                override fun onRemoveStream(stream: MediaStream?) = Unit
                override fun onDataChannel(channel: org.webrtc.DataChannel?) = Unit
                override fun onRenegotiationNeeded() = Unit
            },
        ) ?: return Result.failure(IllegalStateException("WebRTC could not be started."))

        peerConnection = connection

        // Send-only. This device publishes; it never receives, and saying so in
        // the transceiver keeps the offer honest and the negotiation simple.
        connection.addTransceiver(
            track,
            RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_ONLY),
        )

        val offer = createOffer(connection)
            ?: return Result.failure(IllegalStateException("Could not create a WebRTC offer."))

        setLocalDescription(connection, offer)

        // Non-trickle: the offer only leaves once every candidate is in it. A
        // few seconds at start-up, and it works against every WHIP server rather
        // than only the ones that implement PATCH.
        withTimeoutOrNull(ICE_GATHER_TIMEOUT_MS) { gathered.await() }

        val completeOffer = connection.localDescription?.description ?: offer.description

        return runCatching {
            val opened = whip.publish(ticket.ingestUrl, ticket.token, completeOffer)
            setRemoteDescription(
                connection,
                SessionDescription(SessionDescription.Type.ANSWER, opened.answerSdp),
            )

            // Applied after the answer, when the sender exists. The ceiling is
            // what stops one phone on a shared 4G plan from spending a fleet's
            // data allowance in an afternoon.
            connection.setBitrate(
                MIN_BITRATE_BPS,
                ticket.maxBitrateKbps * 1_000 / 2,
                ticket.maxBitrateKbps * 1_000,
            )

            session = opened
            sessionToken = ticket.token

            /*
             * Signalling done — which is not the same as streaming.
             *
             * `publishing` is deliberately not set here. All that has happened
             * is an offer out and an answer back over HTTP; the media connection
             * is negotiated separately and may still fail entirely, which is
             * exactly what happens when the phone is on mobile data and the
             * gateway only advertises a LAN address.
             *
             * Setting it here claimed "Live" on a stream that never carried a
             * frame, and the dashboard meanwhile answered 404 because no
             * publisher had arrived — two screens disagreeing, with the phone
             * being the one that was wrong.
             *
             * `onConnectionChange` sets it, and only on CONNECTED.
             */
            _state.value = _state.value.copy(
                connectionState = "CONNECTING",
                simulated = false,
                sessionId = ticket.sessionId,
                error = null,
            )
            DebugLog.add("CAMERA OFFER ACCEPTED session ${ticket.sessionId.take(8)} — awaiting media")

            // Wait for frames to have somewhere to go before calling this a
            // success. A failure here is a real failure and must reach the
            // retry loop, rather than being reported as a working stream.
            val connected =
                withTimeoutOrNull(MEDIA_CONNECT_TIMEOUT_MS) { established.await() } ?: false

            if (!connected) {
                throw IllegalStateException(
                    "The gateway accepted the stream but no media connection could be made. " +
                        "On a mobile network this usually means the gateway is only reachable " +
                        "on its local network, and a TURN relay is needed.",
                )
            }
        }.onFailure { error ->
            val message = when (error) {
                is WhipClient.WhipException -> error.message
                else -> error.message ?: "The stream could not be started."
            }
            _state.value = _state.value.copy(publishing = false, error = message)
            DebugLog.add("CAMERA STREAM FAILED: $message")
            closeConnection()
        }.map { }
    }

    /** Stop, and stay stopped — this is a person's decision, not a fault. */
    suspend fun stopPublishing() {
        _state.value = _state.value.copy(wanted = false, attempts = 0)
        val open = session
        val token = sessionToken
        session = null
        sessionToken = null

        closeConnection()

        if (open != null && token != null) {
            whip.delete(open.resourceUrl, token)
        }

        _state.value = _state.value.copy(
            publishing = false,
            simulated = false,
            sessionId = null,
            connectionState = "IDLE",
        )
    }

    /** Note a failed attempt, so the service can back off sensibly. */
    fun recordFailedAttempt(message: String?) {
        _state.value = _state.value.copy(
            attempts = _state.value.attempts + 1,
            publishing = false,
            error = message ?: _state.value.error,
        )
    }

    @Synchronized
    private fun closeConnection() {
        peerConnection?.let {
            runCatching { it.close() }
            runCatching { it.dispose() }
        }
        peerConnection = null
    }

    /** Full teardown. Called when the process is genuinely finished with video. */
    @Synchronized
    fun release() {
        closeConnection()
        stopCapture()
        audioTrack?.dispose()
        audioTrack = null
        factory.dispose()
        eglBase.release()
    }

    // -----------------------------------------------------------------------
    // SDP, as coroutines
    // -----------------------------------------------------------------------
    //
    // libwebrtc's API is callback-based and its observers are easy to get subtly
    // wrong — `createOffer` reports through one method pair and
    // `setLocalDescription` through the other, on the same interface. Wrapping
    // each in a one-shot deferred makes the sequence read in the order it
    // happens and makes a missed callback a timeout rather than a hang.

    private suspend fun createOffer(connection: PeerConnection): SessionDescription? {
        val result = CompletableDeferred<SessionDescription?>()
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"))
        }

        connection.createOffer(
            object : SdpObserver {
                override fun onCreateSuccess(description: SessionDescription?) {
                    result.complete(description)
                }

                override fun onCreateFailure(error: String?) {
                    DebugLog.add("SDP offer failed: $error")
                    result.complete(null)
                }

                override fun onSetSuccess() = Unit
                override fun onSetFailure(error: String?) = Unit
            },
            constraints,
        )

        return withTimeoutOrNull(SDP_TIMEOUT_MS) { result.await() }
    }

    private suspend fun setLocalDescription(
        connection: PeerConnection,
        description: SessionDescription,
    ) {
        val done = CompletableDeferred<Unit>()
        connection.setLocalDescription(
            object : SdpObserver {
                override fun onSetSuccess() {
                    done.complete(Unit)
                }

                override fun onSetFailure(error: String?) {
                    DebugLog.add("setLocalDescription failed: $error")
                    done.complete(Unit)
                }

                override fun onCreateSuccess(description: SessionDescription?) = Unit
                override fun onCreateFailure(error: String?) = Unit
            },
            description,
        )
        withTimeoutOrNull(SDP_TIMEOUT_MS) { done.await() }
    }

    private suspend fun setRemoteDescription(
        connection: PeerConnection,
        description: SessionDescription,
    ) {
        val done = CompletableDeferred<Boolean>()
        connection.setRemoteDescription(
            object : SdpObserver {
                override fun onSetSuccess() {
                    done.complete(true)
                }

                override fun onSetFailure(error: String?) {
                    DebugLog.add("setRemoteDescription failed: $error")
                    done.complete(false)
                }

                override fun onCreateSuccess(description: SessionDescription?) = Unit
                override fun onCreateFailure(error: String?) = Unit
            },
            description,
        )

        val ok = withTimeoutOrNull(SDP_TIMEOUT_MS) { done.await() } ?: false
        if (!ok) throw IllegalStateException("The gateway's answer was not usable.")
    }

    companion object {
        private const val ICE_GATHER_TIMEOUT_MS = 8_000L

        /**
         * How long to wait for media after the gateway accepts the offer.
         *
         * Longer than the gateway's own patience, so a slow-but-working
         * connection is not abandoned by this side first; short enough that a
         * hopeless one is reported rather than left looking like progress.
         */
        private const val MEDIA_CONNECT_TIMEOUT_MS = 20_000L
        private const val SDP_TIMEOUT_MS = 10_000L

        /**
         * Floor for the encoder.
         *
         * Below roughly this, H.264 at 720p stops being a picture somebody could
         * identify a hazard from, and a stream nobody can read is worse than no
         * stream because it looks like it is working.
         */
        private const val MIN_BITRATE_BPS = 150_000

        @Volatile private var instance: VideoPublisher? = null

        fun get(context: Context): VideoPublisher =
            instance ?: synchronized(this) {
                instance ?: VideoPublisher(context).also { instance = it }
            }
    }
}
