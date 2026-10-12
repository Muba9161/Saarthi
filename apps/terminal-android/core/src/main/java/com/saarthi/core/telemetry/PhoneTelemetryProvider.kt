package com.saarthi.core.telemetry

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Looper
import android.os.SystemClock
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.saarthi.core.util.DebugLog
import com.saarthi.core.util.DeviceEnvironment
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * What the tablet itself can measure.
 *
 * Position, speed, heading, altitude, accuracy and motion. Real measurements of
 * a real vehicle, every one of them — which is why they are stamped
 * [MetricSource.PHONE] and never marked simulated, however much of the rest of
 * the dashboard is standing in for hardware that has not arrived.
 *
 * What it deliberately cannot produce: RPM, fuel, coolant, engine load, battery
 * voltage, odometer or trouble codes. A tablet has no connection to the engine.
 * Those come from the simulator today and the OBD adapter tomorrow, and
 * pretending otherwise here would defeat every safeguard downstream.
 */
class PhoneTelemetryProvider(
    private val context: Context,
    /**
     * How often to ask for a fix.
     *
     * Server-owned in practice: the terminal adopts whatever interval Saarthi
     * configures. One second of GPS for a working day is 28,800 rows and a flat
     * battery, so the default is the normal preset rather than the fastest one.
     */
    @Volatile var intervalMs: Long = 5_000L,
) : TelemetryProvider {

    override val id = "phone"
    override val label = "Tablet sensors"

    override val supportedMetrics = setOf(
        Metric.LOCATION,
        Metric.SPEED,
        Metric.HEADING,
        Metric.ALTITUDE,
        Metric.GPS_ACCURACY,
        Metric.ACCELEROMETER,
    )

    private val _status = MutableStateFlow(ProviderStatus.STOPPED)
    override val status: StateFlow<ProviderStatus> = _status.asStateFlow()

    private val locationClient = LocationServices.getFusedLocationProviderClient(context)
    private val sensorManager =
        context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager

    private val latest = AtomicReference<Map<Metric, MetricValue>>(emptyMap())
    private val latestPosition = AtomicReference<Position?>(null)

    /** When the last fix arrived, on the monotonic clock. Zero before the first. */
    private val lastFixNanos = java.util.concurrent.atomic.AtomicLong(0)

    /** The moving/stopped verdict held between fixes — see [MotionGate]. */
    private val motion = MotionGate()

    /** Harsh-event detection state. See [onSensorEvent] for why it is here. */
    @Volatile private var lastAcceleration: Double = 0.0
    @Volatile private var harshBraking = false
    @Volatile private var harshAcceleration = false
    @Volatile private var suddenMovement = false

    /**
     * Running totals, alongside the one-shot flags.
     *
     * The flags are cleared by whoever reads them first, which is correct for a
     * telemetry frame — an event belongs in exactly one frame — and useless for
     * anything that wants to count events over a journey, because the frame
     * loop would consume every one before the counter saw it. So the events are
     * recorded twice: once as a flag for the next frame, once as a monotonic
     * total that anybody can sample without taking it away from anybody else.
     */
    private val harshBrakingTotal = java.util.concurrent.atomic.AtomicLong(0)
    private val harshAccelerationTotal = java.util.concurrent.atomic.AtomicLong(0)

    val position: Position? get() = latestPosition.get()

    fun consumeMotionFlags(): Triple<Boolean, Boolean, Boolean> {
        val flags = Triple(harshBraking, harshAcceleration, suddenMovement)
        harshBraking = false
        harshAcceleration = false
        suddenMovement = false
        return flags
    }

    /** Harsh events since the provider started. Never decreases, never resets. */
    fun motionTotals(): Pair<Long, Long> =
        harshBrakingTotal.get() to harshAccelerationTotal.get()

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val fix = result.lastLocation ?: return
            lastFixNanos.set(fix.elapsedRealtimeNanos)
            val movingNow = isMoving(fix)

            val values = buildMap {
                put(Metric.LOCATION, MetricValue(1.0, MetricSource.PHONE, fix.time))
                // m/s → km/h. Only when Android says it has a speed: a fix from
                // a cold start has none, and reporting 0 km/h for a moving truck
                // would corrupt the speed series and everything built on it.
                if (fix.hasSpeed()) {
                    /*
                     * Parked means 0 km/h — see [isMoving].
                     *
                     * A phone lying still does not report 0 m/s; it reports a
                     * metre or two per second of noise as the satellite geometry
                     * shifts. The old filter only zeroed that noise on a fix
                     * whose accuracy was *bad*, so a parked truck with a good
                     * clear-sky fix — the normal case — showed 1 to 5 km/h.
                     */
                    put(
                        Metric.SPEED,
                        MetricValue(
                            if (movingNow) fix.speed * 3.6 else 0.0,
                            MetricSource.PHONE,
                            fix.time,
                        ),
                    )
                }
                // Bearing from a stationary fix is meaningless — the vehicle
                // is not pointing anywhere in particular, and letting it through
                // spins the marker on the spot.
                if (fix.hasBearing() && movingNow) {
                    put(
                        Metric.HEADING,
                        MetricValue(fix.bearing.toDouble(), MetricSource.PHONE, fix.time),
                    )
                }
                if (fix.hasAltitude()) {
                    put(Metric.ALTITUDE, MetricValue(fix.altitude, MetricSource.PHONE, fix.time))
                }
                if (fix.hasAccuracy()) {
                    put(
                        Metric.GPS_ACCURACY,
                        MetricValue(fix.accuracy.toDouble(), MetricSource.PHONE, fix.time),
                    )
                }
            }

            latest.set(values)
            /*
             * Only publish a position the vehicle actually reached.
             *
             * A stationary device does not sit on one coordinate. Its fixes
             * wander — twenty, thirty, occasionally fifty metres between samples
             * — as satellites rise, set and reflect off buildings. Published
             * raw, that wander is indistinguishable from driving: the marker
             * crawls around the map on a parked vehicle, and every consumer that
             * measures the gap between two fixes books it as distance. Three
             * kilometres appeared on an odometer overnight in a car park.
             *
             * So the last *accepted* fix is held as an anchor and only replaced
             * when the new one is real movement — see [isRealMovement]. Nothing
             * downstream needs to know: the map, the trip recorder and the
             * frames posted to Saarthi all read one position that stops moving
             * when the vehicle does.
             */
            if (shouldMoveAnchor(fix, movingNow)) {
                latestPosition.set(
                    Position(
                        latitude = fix.latitude,
                        longitude = fix.longitude,
                        accuracyMetres = if (fix.hasAccuracy()) fix.accuracy.toDouble() else null,
                        source = MetricSource.PHONE,
                        at = fix.time,
                    ),
                )
            }

            // A fix with 500 m of error still moves a marker across a map, so the
            // provider says it is degraded rather than pretending it is fine.
            _status.value = if (fix.hasAccuracy() && fix.accuracy > 100f) {
                ProviderStatus.DEGRADED
            } else {
                ProviderStatus.RUNNING
            }
        }
    }

    /**
     * Has the vehicle moved, or has the sky changed?
     *
     * **A position is only believed when the fix says the vehicle is moving.**
     * That is a stronger rule than the obvious one — "did the coordinates
     * change" — and it is the only one that actually holds indoors.
     *
     * Android's speed comes from Doppler shift on the satellite carrier, not
     * from differencing two positions, so it stays at zero on a stationary
     * device however far the coordinates wander. A *fused* fix, though, may have
     * no speed at all: indoors and in dense streets the platform falls back to
     * Wi-Fi and cell positioning, which can place a device to within twenty
     * metres, cannot say how fast it is going, and re-triangulates to a
     * different spot every few seconds as access points come and go.
     *
     * That is the case that put three kilometres on a parked vehicle's odometer
     * and made the marker crawl around a car park: no speed, plausible-looking
     * accuracy, and a fresh position every fix. Comparing the step against the
     * accuracy is not enough, because the *jump between two Wi-Fi fixes* is
     * routinely larger than the *claimed accuracy of either*.
     *
     * So a fix with no speed is treated as no evidence of movement, and the
     * position is held. A vehicle that is genuinely driving gets satellite
     * fixes with a speed on them within seconds of moving, which is exactly when
     * this starts believing it again.
     *
     * One exception while parked: a fix far *better* than the anchor replaces
     * it. The first fix of a session is accepted whatever it is — often a coarse
     * network fix — and a parked truck never moves to replace it, so the nearby
     * search and the map were working from a position a few hundred metres out
     * for as long as the vehicle stood still. A sharper fix is not movement; it
     * only corrects where the vehicle was all along, and with the speed at zero
     * nothing books the correction as distance.
     */
    private fun shouldMoveAnchor(fix: android.location.Location, movingNow: Boolean): Boolean {
        val anchor = latestPosition.get() ?: return true
        if (movingNow) return true

        val anchorAccuracy = anchor.accuracyMetres ?: return false
        return fix.hasAccuracy() &&
            fix.accuracy <= SHARP_FIX_METRES &&
            fix.accuracy < anchorAccuracy * SHARPER_FACTOR
    }

    /** Whether the vehicle is moving — see [MotionGate] for the rule. */
    private fun isMoving(fix: android.location.Location): Boolean {
        if (!fix.hasSpeed()) return false
        return motion.update(
            speedMps = fix.speed,
            speedAccuracyMps = if (fix.hasSpeedAccuracy()) fix.speedAccuracyMetersPerSecond else null,
            accuracyMetres = if (fix.hasAccuracy()) fix.accuracy else null,
        )
    }

    private val sensorListener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) = onSensorEvent(event)
        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    }

    /**
     * Harsh-driving detection, from the accelerometer.
     *
     * Crude on purpose. This is a tablet in a bracket, not an instrumented test
     * rig: it registers whatever the mount transmits, including a pothole and
     * the door slamming. So the thresholds are set well above ordinary road
     * noise, the flags are one-shot and cleared when read, and the server's own
     * rule engine remains the thing that decides whether an event is real.
     *
     * The alternative — reporting every bump — trains a fleet to ignore harsh
     * driving alerts entirely, which costs more than missing a few.
     */
    private fun onSensorEvent(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ACCELEROMETER) return

        val x = event.values.getOrElse(0) { 0f }.toDouble()
        val y = event.values.getOrElse(1) { 0f }.toDouble()
        val z = event.values.getOrElse(2) { 0f }.toDouble()

        // Total magnitude, minus gravity, in g.
        val magnitude = sqrt(x * x + y * y + z * z) / GRAVITY
        val delta = magnitude - lastAcceleration
        lastAcceleration = magnitude

        if (abs(delta) > SUDDEN_G) suddenMovement = true
        if (delta < -HARSH_G) {
            harshBraking = true
            harshBrakingTotal.incrementAndGet()
        }
        if (delta > HARSH_G) {
            harshAcceleration = true
            harshAccelerationTotal.incrementAndGet()
        }

        val current = latest.get().toMutableMap()
        current[Metric.ACCELEROMETER] = MetricValue(magnitude, MetricSource.PHONE)
        latest.set(current)
    }

    override suspend fun start() {
        if (_status.value == ProviderStatus.RUNNING) return
        _status.value = ProviderStatus.STARTING

        if (!DeviceEnvironment.hasLocationPermission(context)) {
            _status.value = ProviderStatus.PERMISSION_DENIED
            DebugLog.warn("telemetry", "Location permission not granted; phone provider idle")
            return
        }

        val fine = DeviceEnvironment.hasPermission(
            context,
            android.Manifest.permission.ACCESS_FINE_LOCATION,
        )

        val request = LocationRequest.Builder(
            if (fine) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            intervalMs,
        )
            // Never faster than half the nominal interval. Fused location will
            // happily deliver at whatever rate another app has requested, and a
            // terminal that suddenly gets 1 Hz fixes because a maps app is open
            // would triple its data use for no benefit.
            .setMinUpdateIntervalMillis(intervalMs / 2)
            .setWaitForAccurateLocation(false)
            .build()

        try {
            @Suppress("MissingPermission") // Checked immediately above.
            locationClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
            _status.value = if (fine) ProviderStatus.RUNNING else ProviderStatus.DEGRADED
        } catch (error: SecurityException) {
            // The permission was revoked between the check and the call. Rare,
            // and entirely possible while a driver is in Settings.
            _status.value = ProviderStatus.PERMISSION_DENIED
            DebugLog.error("telemetry", "Location updates refused", error)
            return
        }

        sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let { sensor ->
            sensorManager.registerListener(
                sensorListener,
                sensor,
                SensorManager.SENSOR_DELAY_NORMAL,
            )
        }

        DebugLog.info("telemetry", "Phone provider started at ${intervalMs}ms")
    }

    override suspend fun stop() {
        locationClient.removeLocationUpdates(locationCallback)
        sensorManager?.unregisterListener(sensorListener)
        latest.set(emptyMap())
        lastFixNanos.set(0)
        motion.reset()
        _status.value = ProviderStatus.STOPPED
    }

    /**
     * The latest readings, with speed and heading withdrawn once they are old.
     *
     * Fixes stop in a basement, a tunnel, or when the platform throttles a
     * background app, and the last speed used to be re-published for ever — a
     * vehicle parked underground for an hour still "doing 40". Unknown is the
     * truth then, and the screens show unknown as a standstill.
     */
    override fun sample(): Map<Metric, MetricValue> {
        val values = latest.get()
        val ageNanos = SystemClock.elapsedRealtimeNanos() - lastFixNanos.get()
        if (lastFixNanos.get() == 0L || ageNanos <= staleAfterNanos) return values
        return values - Metric.SPEED - Metric.HEADING
    }

    /** Twice the reporting interval, and never under fifteen seconds. */
    private val staleAfterNanos: Long
        get() = maxOf(intervalMs * 2, STALE_FLOOR_MS) * 1_000_000L

    private companion object {
        /** A fix this good may correct a parked vehicle's coarse anchor. */
        const val SHARP_FIX_METRES = 30f

        /** …when it is at least this much better than the anchor. */
        const val SHARPER_FACTOR = 0.5

        const val STALE_FLOOR_MS = 15_000L

        const val GRAVITY = 9.80665
        /** Change in g between samples that counts as harsh. */
        const val HARSH_G = 0.45
        const val SUDDEN_G = 0.75
    }
}
