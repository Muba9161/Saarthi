package com.saarthi.terminal.telemetry

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Looper
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.saarthi.terminal.util.DebugLog
import com.saarthi.terminal.util.DeviceEnvironment
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

    /** Harsh-event detection state. See [onSensorEvent] for why it is here. */
    @Volatile private var lastAcceleration: Double = 0.0
    @Volatile private var harshBraking = false
    @Volatile private var harshAcceleration = false
    @Volatile private var suddenMovement = false

    val position: Position? get() = latestPosition.get()

    fun consumeMotionFlags(): Triple<Boolean, Boolean, Boolean> {
        val flags = Triple(harshBraking, harshAcceleration, suddenMovement)
        harshBraking = false
        harshAcceleration = false
        suddenMovement = false
        return flags
    }

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val fix = result.lastLocation ?: return

            val values = buildMap {
                put(Metric.LOCATION, MetricValue(1.0, MetricSource.PHONE, fix.time))
                // m/s → km/h. Only when Android says it has a speed: a fix from
                // a cold start has none, and reporting 0 km/h for a moving truck
                // would corrupt the speed series and everything built on it.
                if (fix.hasSpeed()) {
                    /*
                     * Below walking pace, report a standstill.
                     *
                     * A phone lying still on a desk does not report 0 m/s — it
                     * reports a metre or two per second of noise, wandering as
                     * the satellite geometry shifts. Passed through untouched
                     * that became a truck spontaneously doing 5 km/h in a locked
                     * yard: the gauge swept, the marker twitched, and a driver
                     * watching a stationary vehicle move on screen has no reason
                     * to believe the next number either.
                     *
                     * 1.4 m/s is a slow walk. Anything under it, from a device
                     * whose own accuracy estimate is worse than 25 m, is noise
                     * rather than motion — and a vehicle genuinely creeping that
                     * slowly is a vehicle whose speed nobody is reading.
                     */
                    val kph = fix.speed * 3.6
                    val jitter = fix.speed < STATIONARY_MPS &&
                        (!fix.hasAccuracy() || fix.accuracy > NOISY_FIX_METRES)
                    put(
                        Metric.SPEED,
                        MetricValue(
                            if (jitter) 0.0 else kph.toDouble(),
                            MetricSource.PHONE,
                            fix.time,
                        ),
                    )
                }
                // Bearing from a stationary fix is meaningless — the vehicle
                // is not pointing anywhere in particular, and letting it through
                // spins the marker on the spot.
                if (fix.hasBearing() && fix.hasSpeed() && fix.speed >= STATIONARY_MPS) {
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
            latestPosition.set(
                Position(
                    latitude = fix.latitude,
                    longitude = fix.longitude,
                    accuracyMetres = if (fix.hasAccuracy()) fix.accuracy.toDouble() else null,
                    source = MetricSource.PHONE,
                    at = fix.time,
                ),
            )

            // A fix with 500 m of error still moves a marker across a map, so the
            // provider says it is degraded rather than pretending it is fine.
            _status.value = if (fix.hasAccuracy() && fix.accuracy > 100f) {
                ProviderStatus.DEGRADED
            } else {
                ProviderStatus.RUNNING
            }
        }
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
        if (delta < -HARSH_G) harshBraking = true
        if (delta > HARSH_G) harshAcceleration = true

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
        _status.value = ProviderStatus.STOPPED
    }

    override fun sample(): Map<Metric, MetricValue> = latest.get()

    private companion object {
        /** A slow walk. Below this a vehicle is parked, whatever GPS reports. */
        const val STATIONARY_MPS = 1.4f

        /** Past this much error, a small speed is the error rather than motion. */
        const val NOISY_FIX_METRES = 25f

        const val GRAVITY = 9.80665
        /** Change in g between samples that counts as harsh. */
        const val HARSH_G = 0.45
        const val SUDDEN_G = 0.75
    }
}
