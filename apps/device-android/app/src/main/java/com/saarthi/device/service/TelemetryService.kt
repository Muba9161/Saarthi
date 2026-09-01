package com.saarthi.device.service

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.SensorManager
import android.location.Location
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.saarthi.device.MainActivity
import com.saarthi.device.R
import com.saarthi.device.SaarthiDeviceApp
import com.saarthi.device.data.DeviceRepository
import com.saarthi.device.domain.MotionDetector
import com.saarthi.device.domain.TelemetrySimulator
import com.saarthi.device.network.FrameHealth
import com.saarthi.device.network.FrameLocation
import com.saarthi.device.network.FrameMotion
import com.saarthi.device.network.HeartbeatRequest
import com.saarthi.device.network.TelemetryFrame
import com.saarthi.device.util.DebugLog
import com.saarthi.device.util.DeviceEnvironment
import com.saarthi.device.util.isoNow
import com.saarthi.device.util.isoOf
import com.saarthi.device.video.VideoPublisher
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The tracking service.
 *
 * A foreground service, which on modern Android is the only honest way to do
 * this: a phone standing in for a fitted tracker has to keep reporting while
 * the screen is off and the app is not in front, and everything short of a
 * foreground service is subject to Doze, app standby and being killed for
 * memory. The persistent notification it forces is not a cost — it is the
 * privacy notice section 46 asks for, in the one place the driver will
 * certainly see it.
 *
 * ## What it does each tick
 *
 * A GPS fix arrives, motion is sampled against it, the simulator adds the engine
 * values a phone cannot measure, and the whole frame is written to the buffer.
 * Uploading is separate and asynchronous, because whether Saarthi is reachable
 * has nothing to do with whether the vehicle is moving.
 *
 * ## Battery
 *
 * The reporting interval is the single biggest lever and it is server-owned, so
 * a fleet can slow a phone down without touching it. Beyond that: no wake locks
 * beyond what the foreground service already holds, the accelerometer is
 * registered only while running, and uploads are batched rather than one request
 * per fix — a radio woken sixty times a minute costs far more than the bytes do.
 */
class TelemetryService : LifecycleService() {

    private val repository by lazy { SaarthiDeviceApp.repository(this) }
    private val simulator = TelemetrySimulator()
    private var motion: MotionDetector? = null

    private lateinit var locationClient: com.google.android.gms.location.FusedLocationProviderClient
    private var locationCallback: LocationCallback? = null

    private var heartbeatJob: Job? = null
    private var uploadJob: Job? = null

    /** The previous fix, for the speed delta harsh-event detection needs. */
    private var lastLocation: Location? = null
    private var lastFixAt: Long = 0

    /** What the notification currently says, so it is not rewritten every fix. */
    private var notifiedVehicle: String? = null
    private var notifiedStreaming = false

    /**
     * The camera, owned by the service rather than by a screen.
     *
     * Section 40 lets the dashboard send START_CAMERA, which means a stream
     * has to survive the app being backgrounded and has to be startable with
     * nobody looking at the phone. A capturer owned by a composable could do
     * neither, and from Android 14 a background camera access needs a
     * foreground service that declares the camera type anyway.
     */
    /**
     * The last position accepted as a genuine move.
     *
     * Distinct from `lastLocation`, which is the last fix Android produced.
     * While the vehicle is parked those diverge: fixes keep arriving and
     * wandering, and this stays put.
     */
    private var lastMovedLocation: Location? = null
    private var lastStationaryReportAt = 0L

    private val publisher by lazy { VideoPublisher.get(this) }
    private var publisherWatcher: Job? = null
    private var streamKeepAlive: Job? = null
    private var reconnect: Job? = null

    override fun onCreate() {
        super.onCreate()
        locationClient = LocationServices.getFusedLocationProviderClient(this)
        motion = MotionDetector(getSystemService(Context.SENSOR_SERVICE) as? SensorManager)
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)

        when (intent?.action) {
            ACTION_STOP -> {
                repository.settings.wasRunning = false
                lifecycleScope.launch { runCatching { publisher.stopPublishing() } }
                stopSelf()
                return START_NOT_STICKY
            }

            ACTION_START_CAMERA -> {
                val channel = intent.getIntExtra(EXTRA_CHANNEL, repository.settings.cameraChannel)
                // Re-entered with the camera type included, which is what
                // Android 14 requires before the capturer touches the lens.
                startForeground(
                    NOTIFICATION_ID,
                    buildNotification(repository.state.value.vehicleRegistration, streaming = true),
                )
                startPublishing(channel)
                return START_STICKY
            }

            ACTION_STOP_CAMERA -> {
                lifecycleScope.launch {
                    runCatching { publisher.stopPublishing() }
                    publisher.stopCapture()
                    updateNotificationIfNeeded(force = true)
                }
                return START_STICKY
            }
        }

        startForeground(
            NOTIFICATION_ID,
            buildNotification(repository.state.value.vehicleRegistration, streaming = false),
        )
        repository.settings.wasRunning = true

        startLocationUpdates()
        startHeartbeat()
        startUploads()
        watchPublisher()
        motion?.start()

        DebugLog.add("SERVICE STARTED")

        // START_STICKY so a service killed for memory comes back. It restarts
        // with a null intent, which is why nothing above depends on the intent's
        // contents — the state it needs is all in the repository.
        return START_STICKY
    }

    override fun onDestroy() {
        locationCallback?.let { locationClient.removeLocationUpdates(it) }
        locationCallback = null
        motion?.stop()
        heartbeatJob?.cancel()
        uploadJob?.cancel()
        publisherWatcher?.cancel()
        streamKeepAlive?.cancel()
        reconnect?.cancel()
        // The camera is released with the service. Leaving it capturing after
        // tracking stops would keep the indicator lit and the lens open with
        // nothing consuming the frames.
        publisher.stopCapture()
        DebugLog.add("SERVICE STOPPED")
        super.onDestroy()
    }

    // -----------------------------------------------------------------------
    // Camera
    // -----------------------------------------------------------------------

    /**
     * Ask Saarthi for a publish ticket and open the stream.
     *
     * The ticket is authorised against the device assignment and recorded in
     * the same access log that records every human viewing, so a stream started
     * by a dashboard command is as accountable as one somebody watched.
     */
    private fun startPublishing(channel: Int) {
        lifecycleScope.launch {
            repository.settings.cameraChannel = channel

            val ticket = runCatching { repository.api.publishTicket(channel) }
                .onFailure {
                    DebugLog.add("PUBLISH TICKET REFUSED: ${it.message}")
                    // Counted as an attempt so the backoff widens rather
                    // than retrying every two seconds against a server that
                    // is not answering.
                    publisher.recordFailedAttempt(it.message)
                    updateNotificationIfNeeded(force = true)
                }
                .getOrNull() ?: return@launch

            publisher.publish(
                VideoPublisher.Ticket(
                    sessionId = ticket.sessionId,
                    ingestUrl = ticket.ingestUrl,
                    token = ticket.token,
                    protocol = ticket.protocol,
                    simulated = ticket.simulated,
                    maxWidth = ticket.constraints.maxWidth,
                    maxHeight = ticket.constraints.maxHeight,
                    maxFrameRate = ticket.constraints.maxFrameRate,
                    maxBitrateKbps = ticket.constraints.maxBitrateKbps,
                    iceServers = ticket.iceServers.map {
                        VideoPublisher.IceServerConfig(it.urls, it.username, it.credential)
                    },
                ),
                channel = channel,
            ).onFailure { publisher.recordFailedAttempt(it.message) }
            updateNotificationIfNeeded(force = true)
        }
    }

    /**
     * Watch the stream and act on what it does.
     *
     * Three jobs, and they belong here rather than in the publisher because
     * each needs the network: the notification has to stay honest, a session
     * has to be held open while it is genuinely streaming, and a stream that
     * drops has to come back.
     *
     * The reconnect is the reason this exists. A phone that loses Wi-Fi in a
     * yard and silently never resumes is worse than one that never started:
     * the dashboard shows a camera that was working, and nobody finds out it
     * stopped until they need the footage.
     */
    private fun watchPublisher() {
        publisherWatcher?.cancel()
        publisherWatcher = lifecycleScope.launch {
            publisher.state.collect { state ->
                updateNotificationIfNeeded()

                if (state.publishing && state.sessionId != null) {
                    startStreamKeepAlive(state.sessionId)
                } else {
                    streamKeepAlive?.cancel()
                    streamKeepAlive = null
                }

                // Wanted but not connected, and not already retrying. The
                // `wanted` flag is what separates a dropped connection from
                // a driver having pressed Stop.
                val lost = state.wanted && !state.publishing && !state.simulated
                if (lost && reconnect?.isActive != true) {
                    scheduleReconnect(state.channel, state.attempts)
                }
            }
        }
    }

    /**
     * Tell Saarthi the camera is still on.
     *
     * Without it the server closes the session and the access log records
     * every stream as one ticket long, whatever really happened. For a lens
     * pointed at a driver that is the number that matters most.
     */
    private fun startStreamKeepAlive(sessionId: String) {
        if (streamKeepAlive?.isActive == true) return
        streamKeepAlive = lifecycleScope.launch {
            while (true) {
                delay(STREAM_KEEPALIVE_MS)
                val current = publisher.state.value
                if (!current.publishing || current.sessionId != sessionId) return@launch
                runCatching { repository.api.keepPublishingAlive(sessionId) }
                    .onFailure { DebugLog.add("STREAM KEEPALIVE FAILED: ${it.message}") }
            }
        }
    }

    /**
     * Try again, later, with a widening gap.
     *
     * Exponential with a ceiling, because the common cause is a network that
     * will come back on its own and hammering it meanwhile costs battery for
     * nothing. It never gives up entirely: a truck out of coverage for an
     * hour should still be streaming when it comes back, without somebody
     * having to open the app.
     */
    private fun scheduleReconnect(channel: Int, attempts: Int) {
        reconnect?.cancel()
        reconnect = lifecycleScope.launch {
            val backoff = (RECONNECT_BASE_MS shl attempts.coerceAtMost(5))
                .coerceAtMost(RECONNECT_MAX_MS)
            DebugLog.add("CAMERA RECONNECT in ${backoff / 1000}s (attempt ${attempts + 1})")
            delay(backoff)

            // Re-checked after the wait: the driver may have pressed Stop, or
            // it may have recovered on its own, in which case retrying would
            // tear down a working stream.
            val current = publisher.state.value
            if (!current.wanted || current.publishing) return@launch

            startPublishing(channel)
        }
    }

    override fun onBind(intent: Intent): IBinder? {
        super.onBind(intent)
        return null
    }

    // -----------------------------------------------------------------------
    // Location
    // -----------------------------------------------------------------------

    private fun startLocationUpdates() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            DebugLog.add("LOCATION PERMISSION MISSING — SERVICE IDLE")
            return
        }

        val intervalMs = repository.settings.reportingIntervalSeconds * 1000L

        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
            // Never faster than asked for, however many other apps are also
            // listening — otherwise a navigation app running alongside this one
            // would silently triple its reporting rate.
            .setMinUpdateIntervalMillis(intervalMs)
            // A ceiling as well as a floor: a stationary vehicle should still
            // prove it is there rather than going silent and looking offline.
            .setMaxUpdateDelayMillis(intervalMs * 2)
            .setWaitForAccurateLocation(false)
            .build()

        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { handleFix(it) }
            }
        }
        locationCallback = callback

        runCatching {
            locationClient.requestLocationUpdates(request, callback, mainLooper)
        }.onFailure {
            DebugLog.add("LOCATION UPDATES REFUSED: ${it.message}")
        }
    }

    private fun handleFix(location: Location) {
        val now = System.currentTimeMillis()
        val previous = lastLocation
        val secondsElapsed = if (lastFixAt > 0) (now - lastFixAt) / 1000.0 else 0.0

        val rawSpeedKph = if (location.hasSpeed()) location.speed * 3.6 else null

        /*
         * Is this movement, or is it the GPS wandering?
         *
         * A stationary phone with a 15 m fix drifts continuously, and Android
         * reports each drift as a speed — 1 to 13 km/h indoors is entirely
         * normal. Passed through unfiltered that becomes a parked truck
         * crawling around a car park on the fleet map, a trip that accumulates
         * distance it never travelled, and harsh-driving events invented from
         * noise.
         *
         * The test is whether the move is larger than the fix could be wrong
         * by. Within the accuracy radius there is no way to tell drift from a
         * slow crawl, so reporting zero is the honest answer: it says "not
         * measurably moving", which is true, rather than inventing a figure.
         *
         * Section 13 of the specification asks for exactly this — change
         * detection, and no unnecessary duplicate events.
         */
        val accuracyMeters = if (location.hasAccuracy()) location.accuracy.toDouble() else 0.0
        val driftAllowance = accuracyMeters.coerceIn(MIN_DRIFT_METERS, MAX_DRIFT_METERS)
        val movedMeters = lastMovedLocation?.let { location.distanceTo(it).toDouble() }

        val stationary =
            (rawSpeedKph ?: 0.0) < STATIONARY_SPEED_KPH &&
                movedMeters != null &&
                movedMeters < driftAllowance

        // Reported instead of the raw figure. The position reported while
        // stationary is the last one accepted as real, so the marker holds
        // still rather than jittering around the true location.
        val reported = if (stationary) lastMovedLocation ?: location else location
        val speedKph = if (stationary) 0.0 else rawSpeedKph

        if (!stationary) lastMovedLocation = location

        val previousSpeedKph = previous?.takeIf { it.hasSpeed() }?.let { it.speed * 3.6 } ?: 0.0
        // Zeroed while stationary so the motion detector does not read drift
        // as acceleration and raise a harsh-driving event on a parked truck.
        val speedDelta = if (stationary) 0.0 else (speedKph ?: 0.0) - previousSpeedKph
        val distanceKm = if (stationary) 0.0 else previous?.let { location.distanceTo(it) / 1000.0 } ?: 0.0

        /*
         * A parked vehicle still reports, just rarely.
         *
         * Something has to keep the map current and the device visibly alive,
         * but not once every five seconds with the same coordinates — that is
         * 17,000 identical rows a day per vehicle for no information. The
         * heartbeat already carries liveness; this only has to prove the
         * position has not changed.
         */
        if (stationary) {
            if (now - lastStationaryReportAt < STATIONARY_REPORT_INTERVAL_MS) {
                lastLocation = location
                lastFixAt = now
                return
            }
            lastStationaryReportAt = now
            DebugLog.add("STATIONARY — holding position, speed 0")
        } else {
            lastStationaryReportAt = 0L
        }

        val motionReading = motion?.sample(
            speedDeltaKph = speedDelta,
            secondsElapsed = secondsElapsed,
            movingKph = previousSpeedKph,
        )

        val engine = simulator.next(
            mode = repository.settings.effectiveSimulationMode(),
            speedKph = speedKph ?: 0.0,
            distanceKm = distanceKm,
        )

        val battery = DeviceEnvironment.battery(this)

        val frame = TelemetryFrame(
            eventId = repository.newEventId(),
            recordedAt = isoOf(now),
            location = FrameLocation(
                // The held position while stationary, the live one while moving.
                latitude = reported.latitude,
                longitude = reported.longitude,
                speedKph = speedKph,
                // Only reported when Android says it has one, and never while
                // stationary: a bearing derived from drift points wherever the
                // noise went, and would spin the map marker on a parked truck.
                // A fix with no bearing sends none rather than zero, which
                // would read as "pointing due north".
                heading = if (!stationary && location.hasBearing()) {
                    location.bearing.toDouble()
                } else {
                    null
                },
                altitude = if (location.hasAltitude()) location.altitude else null,
                accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
            ),
            motion = motionReading?.let {
                FrameMotion(
                    accelerationX = it.accelerationX,
                    accelerationY = it.accelerationY,
                    accelerationZ = it.accelerationZ,
                    harshBraking = it.harshBraking,
                    harshAcceleration = it.harshAcceleration,
                    suddenMovement = it.suddenMovement,
                )
            },
            health = FrameHealth(
                signalStrength = DeviceEnvironment.signalStrengthDbm(this),
                networkType = DeviceEnvironment.networkType(this),
                batteryPercent = battery.percent,
                batteryCharging = battery.charging,
            ),
            simulated = engine,
        )

        repository.queueFrame(frame, now)
        // Kept so an SOS raised from the UI has a position even when the app was
        // opened after tracking started.
        repository.recordFix(
            DeviceRepository.LastFix(
                latitude = location.latitude,
                longitude = location.longitude,
                speedKph = speedKph,
                heading = if (location.hasBearing()) location.bearing.toDouble() else null,
                accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
                recordedAt = now,
            ),
        )
        lastLocation = location
        lastFixAt = now

        DebugLog.add(
            "GPS ${"%.5f".format(location.latitude)}, ${"%.5f".format(location.longitude)}" +
                (speedKph?.let { " @ ${"%.0f".format(it)} km/h" } ?: "") +
                (if (motionReading?.harshBraking == true) " HARSH BRAKING" else "") +
                (if (motionReading?.harshAcceleration == true) " HARSH ACCEL" else ""),
        )

        updateNotificationIfNeeded()
    }

    // -----------------------------------------------------------------------
    // Heartbeat and uploads
    // -----------------------------------------------------------------------

    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = lifecycleScope.launch {
            while (isActive) {
                val battery = DeviceEnvironment.battery(this@TelemetryService)
                repository.heartbeat(
                    HeartbeatRequest(
                        batteryPercent = battery.percent,
                        batteryCharging = battery.charging,
                        networkType = DeviceEnvironment.networkType(this@TelemetryService),
                        gpsStatus = DeviceEnvironment.gpsStatus(this@TelemetryService),
                        cameraStatus = DeviceEnvironment.cameraStatus(this@TelemetryService),
                        bufferedEvents = repository.buffer.count(),
                        appVersion = com.saarthi.device.BuildConfig.VERSION_NAME,
                        deviceTime = isoNow(),
                    ),
                )
                DebugLog.add("HEARTBEAT SENT")
                delay(HEARTBEAT_INTERVAL_MS)
            }
        }
    }

    /**
     * The upload loop.
     *
     * Separate from the capture loop on purpose. Whether Saarthi is reachable
     * has nothing to do with whether the vehicle is moving, and tying them
     * together would mean a fix is lost every time a request fails.
     *
     * Backs off when it cannot get through, so a phone in a two-hour tunnel
     * makes a handful of attempts rather than several thousand.
     */
    private fun startUploads() {
        uploadJob?.cancel()
        uploadJob = lifecycleScope.launch {
            var backoffMs = INITIAL_BACKOFF_MS

            while (isActive) {
                val uploaded = repository.flush()
                backoffMs = if (uploaded == null) {
                    // Capped rather than unbounded: a device that gave up
                    // entirely would never notice the network coming back.
                    (backoffMs * 2).coerceAtMost(MAX_BACKOFF_MS)
                } else {
                    INITIAL_BACKOFF_MS
                }

                val interval = repository.settings.reportingIntervalSeconds * 1000L
                delay(maxOf(interval, backoffMs))
            }
        }
    }

    // -----------------------------------------------------------------------
    // Notification
    // -----------------------------------------------------------------------

    private fun createChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.service_channel_name),
            // Low: it must be permanently visible, but a tracker that buzzes
            // every time it starts would be turned off within a day.
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.service_channel_description)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(vehicle: String?, streaming: Boolean): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, TelemetryService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val text = when {
            vehicle == null -> getString(R.string.service_text_unpaired)
            // The camera being on is a different fact from the location
            // being shared, and the person holding the phone deserves to see
            // which is happening.
            streaming -> getString(R.string.service_text_streaming, vehicle)
            else -> getString(R.string.service_text_paired, vehicle)
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.service_title))
            // Names the vehicle, so the driver can see at a glance which truck
            // this phone is reporting for — and notice immediately if it is the
            // wrong one.
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(open)
            .addAction(0, getString(R.string.service_action_stop), stop)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
    }

    private fun updateNotificationIfNeeded(force: Boolean = false) {
        val vehicle = repository.state.value.vehicleRegistration
        val streaming = publisher.state.value.capturing
        if (!force && vehicle == notifiedVehicle && streaming == notifiedStreaming) return

        notifiedVehicle = vehicle
        notifiedStreaming = streaming
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(vehicle, streaming))
    }

    companion object {
        private const val CHANNEL_ID = "saarthi_device_tracking"
        private const val NOTIFICATION_ID = 1001
        const val ACTION_STOP = "com.saarthi.device.STOP"
        /**
         * Below this, a GPS speed on a stationary phone is indistinguishable
         * from noise. Chosen above walking pace so a genuine slow crawl in a
         * yard still registers once it moves beyond the accuracy radius.
         */
        private const val STATIONARY_SPEED_KPH = 3.0

        /**
         * How far a fix may wander before it counts as movement.
         *
         * Taken from the fix's own accuracy, bounded: a very optimistic
         * accuracy would let drift through, and a very pessimistic one would
         * swallow real movement.
         */
        private const val MIN_DRIFT_METERS = 12.0
        private const val MAX_DRIFT_METERS = 60.0

        /** How often a parked vehicle re-reports the same position. */
        private const val STATIONARY_REPORT_INTERVAL_MS = 60_000L

        /** How often a live stream tells Saarthi its session is still open. */
        private const val STREAM_KEEPALIVE_MS = 30_000L

        /** First reconnect delay; doubles per attempt up to the ceiling. */
        private const val RECONNECT_BASE_MS = 3_000L
        private const val RECONNECT_MAX_MS = 120_000L

        const val ACTION_START_CAMERA = "com.saarthi.device.START_CAMERA"
        const val ACTION_STOP_CAMERA = "com.saarthi.device.STOP_CAMERA"
        const val EXTRA_CHANNEL = "channel"

        /** Matches `DEVICE_HEARTBEAT_INTERVAL_SECONDS` in the shared contract. */
        private const val HEARTBEAT_INTERVAL_MS = 30_000L

        private const val INITIAL_BACKOFF_MS = 2_000L
        private const val MAX_BACKOFF_MS = 120_000L

        fun start(context: Context) {
            val intent = Intent(context, TelemetryService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, TelemetryService::class.java).setAction(ACTION_STOP),
            )
        }

        /**
         * Start streaming a camera.
         *
         * Routed through the service rather than done in a screen, because a
         * stream that stopped when the driver locked the phone would not be a
         * dashcam — and because Android 14 requires a camera-typed foreground
         * service for any camera access that is not in front of the user.
         */
        fun startCamera(context: Context, channel: Int) {
            val intent = Intent(context, TelemetryService::class.java)
                .setAction(ACTION_START_CAMERA)
                .putExtra(EXTRA_CHANNEL, channel)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stopCamera(context: Context) {
            context.startService(
                Intent(context, TelemetryService::class.java).setAction(ACTION_STOP_CAMERA),
            )
        }
    }
}
