package com.saarthi.terminal.telemetry

import android.content.Context
import com.saarthi.terminal.BuildConfig
import com.saarthi.terminal.util.DebugLog
import com.saarthi.terminal.util.DeviceEnvironment
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * One normalised view of the vehicle, assembled from every provider.
 *
 * This is the seam section 20 describes: the dashboard, the checklist and the
 * assistant read [snapshot] and know nothing about where a value came from.
 * Swapping the simulator for a real OBD adapter is a change here and nowhere
 * else.
 *
 * **Precedence is the one rule that matters.** When two providers offer the
 * same metric, the *measured* one wins — always, and regardless of order. A
 * real OBD fuel reading beats a simulated one; a real GPS speed beats a
 * simulated one. There is no configuration for this, because a configuration
 * that let a simulated value shadow a real one would be a way to fabricate
 * telemetry for a working truck.
 */
class TelemetryHub(
    context: Context,
    private val scope: CoroutineScope,
) {

    val phone = PhoneTelemetryProvider(context)
    val simulator = SimulatedTelemetryProvider()
    val obd = BluetoothObdTelemetryProvider(context)

    private val providers: List<TelemetryProvider> = listOf(phone, obd, simulator)

    private val _snapshot = MutableStateFlow(TelemetrySnapshot())
    val snapshot: StateFlow<TelemetrySnapshot> = _snapshot.asStateFlow()

    private var pollJob: Job? = null

    /** Whether the simulator is permitted at all, on this build and this server. */
    @Volatile
    var simulationAllowed: Boolean = BuildConfig.ALLOW_SIMULATION
        set(value) {
            // The build type is the ceiling. A server saying "simulation is fine"
            // must not switch it on in a release build, because a release build
            // is what is fitted to a customer's vehicle.
            field = value && BuildConfig.ALLOW_SIMULATION
        }

    /** Server-owned reporting cadence. Adopted whenever Saarthi changes it. */
    @Volatile
    var intervalMs: Long = 5_000L
        set(value) {
            field = value.coerceIn(1_000L, 300_000L)
            phone.intervalMs = field
        }

    suspend fun start() {
        phone.start()
        obd.start()
        if (simulationAllowed) simulator.start() else simulator.stop()

        pollJob?.cancel()
        pollJob = scope.launch {
            while (isActive) {
                assemble()
                delay(intervalMs)
            }
        }
        DebugLog.info("telemetry", "Telemetry hub running")
    }

    suspend fun stop() {
        pollJob?.cancel()
        pollJob = null
        providers.forEach { it.stop() }
        _snapshot.value = TelemetrySnapshot()
    }

    /** Re-evaluate whether the simulator should be running. */
    suspend fun applySimulationPolicy(allowedByServer: Boolean) {
        simulationAllowed = allowedByServer
        if (simulationAllowed) simulator.start() else simulator.stop()
    }

    /**
     * Merge every provider into one snapshot.
     *
     * The merge, in order:
     *
     *  1. Take everything each provider offers.
     *  2. Where two providers offer the same metric, keep the measured one.
     *  3. Where both are measured, keep the more recent.
     *
     * Step 2 is not a preference. It is what stops a simulated value ever
     * shadowing a real one, which is the failure mode that would put fabricated
     * engine data into a fleet's history under the label of a measurement.
     */
    private fun assemble() {
        val merged = mutableMapOf<Metric, MetricValue>()
        val contributors = mutableListOf<String>()

        for (provider in providers) {
            val sample = provider.sample()
            if (sample.isEmpty()) continue
            contributors += provider.id

            for ((metric, value) in sample) {
                val existing = merged[metric]
                merged[metric] = when {
                    existing == null -> value
                    existing.source.isMeasured && !value.source.isMeasured -> existing
                    !existing.source.isMeasured && value.source.isMeasured -> value
                    else -> if (value.at >= existing.at) value else existing
                }
            }
        }

        // The simulator derives engine values from the *real* road speed, so a
        // stationary truck does not show cruising RPM. Fed here rather than
        // inside the simulator, which has no business reaching into another
        // provider.
        merged[Metric.SPEED]?.let { speed ->
            if (speed.source.isMeasured) simulator.observedSpeedKph = speed.value
        }

        val diagnostics = buildList {
            addAll(obd.diagnostics())
            if (simulationAllowed) addAll(simulator.diagnostics())
        }

        _snapshot.value = TelemetrySnapshot(
            at = System.currentTimeMillis(),
            values = merged,
            position = phone.position,
            diagnostics = diagnostics,
            contributors = contributors,
        )
    }

    /**
     * What the terminal should report as its telemetry source.
     *
     * The most authoritative *measured* source contributing engine data, or
     * PHONE when only the tablet's own sensors are in play. Shown on the admin
     * screen so an installer can confirm at a glance what the cockpit is reading.
     */
    fun activeEngineSource(): MetricSource? {
        val snapshot = _snapshot.value
        val engineMetrics = listOf(
            Metric.RPM,
            Metric.FUEL_LEVEL,
            Metric.COOLANT_TEMPERATURE,
            Metric.BATTERY_VOLTAGE,
        )
        val sources = engineMetrics.mapNotNull { snapshot[it]?.source }
        return sources.firstOrNull { it == MetricSource.OBD }
            ?: sources.firstOrNull { it == MetricSource.PRODUCTION }
            ?: sources.firstOrNull()
    }

    /** Provider states, for the admin diagnostics screen (section 46). */
    fun providerStates(): List<Triple<String, String, ProviderStatus>> =
        providers.map { Triple(it.id, it.label, it.status.value) }

    /** GPS state as the heartbeat spells it, derived from the phone provider. */
    fun gpsStatusForHeartbeat(context: Context): String = when (phone.status.value) {
        ProviderStatus.RUNNING -> DeviceEnvironment.Subsystem.OK
        ProviderStatus.DEGRADED -> DeviceEnvironment.Subsystem.DEGRADED
        ProviderStatus.PERMISSION_DENIED -> DeviceEnvironment.Subsystem.PERMISSION_DENIED
        ProviderStatus.UNAVAILABLE -> DeviceEnvironment.Subsystem.UNAVAILABLE
        else -> DeviceEnvironment.gpsStatus(context)
    }
}
