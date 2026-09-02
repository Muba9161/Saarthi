package com.saarthi.terminal.telemetry

import com.saarthi.terminal.BuildConfig
import com.saarthi.terminal.util.DebugLog
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.math.max
import kotlin.math.min
import kotlin.random.Random

/**
 * The engine block, until the OBD adapter arrives.
 *
 * Section 19 of the specification: the adapter has been ordered and is not
 * available, so implementation must not wait for it. This produces the values a
 * tablet physically cannot measure — RPM, coolant, fuel, engine load, throttle,
 * battery voltage, odometer and trouble codes — so the cockpit, the pre-trip
 * checklist and the assistant can all be built and tested end to end.
 *
 * Every value it produces is stamped [MetricSource.SIMULATED], and that label
 * survives all the way to the reading stored on the server and the checklist
 * submission read back a year later. Section 19 is explicit that simulated data
 * must be clearly marked and must not be presented as real ECU data, and the
 * enforcement is structural rather than a convention: there is no path by which
 * a value leaves this class without its source attached.
 *
 * `ALLOW_SIMULATION` is a build-type constant, not a setting. A release build
 * does not contain the code path that starts this provider, because a switch a
 * driver could find is a switch that eventually gets flipped on a real vehicle.
 */
class SimulatedTelemetryProvider(
    initialScenario: Scenario = Scenario.NORMAL,
) : TelemetryProvider {

    /**
     * The scenarios section 49 asks for.
     *
     * Each is a *coherent* vehicle rather than one dial moved: an overheating
     * engine is also working harder and burning more fuel, and a scenario that
     * changed only the coolant number would let a checklist rule pass that
     * should not.
     */
    enum class Scenario(
        val label: String,
        val description: String,
        val idleRpm: Double,
        val cruiseRpm: Double,
        val coolantC: Double,
        val fuelPercent: Double,
        val batteryVolts: Double,
        val engineLoadPercent: Double,
        val diagnostics: List<Pair<String, String>> = emptyList(),
    ) {
        NORMAL(
            "Normal",
            "A healthy vehicle at working temperature.",
            750.0, 1_850.0, 87.0, 64.0, 27.3, 42.0,
        ),
        LOW_FUEL(
            "Low fuel",
            "Tank near empty — exercises the fuel warning and the nearest-pump flow.",
            750.0, 1_700.0, 86.0, 7.0, 27.2, 38.0,
        ),
        HIGH_COOLANT(
            "High coolant",
            "Coolant above the safe range. The pre-trip check must block on this.",
            800.0, 2_100.0, 112.0, 51.0, 27.0, 66.0,
        ),
        ENGINE_WARNING(
            "Engine warning",
            "A stored trouble code, for the diagnostic-fault path.",
            820.0, 1_900.0, 91.0, 55.0, 26.9, 55.0,
            listOf("P0128" to "Coolant thermostat below regulating temperature."),
        ),
        LOW_BATTERY(
            "Low battery",
            "Charging-system fault on a 24 V system.",
            700.0, 1_600.0, 84.0, 60.0, 22.4, 35.0,
        ),
        HIGH_RPM(
            "High RPM",
            "Sustained high engine speed, for idling and load rules.",
            900.0, 2_900.0, 94.0, 58.0, 27.1, 78.0,
        ),
        /**
         * No engine block at all.
         *
         * The honest default for a terminal that is *not* pretending: the
         * cockpit shows "not reported" for every engine gauge, which is exactly
         * what a driver will see on day one with a real adapter that cannot read
         * fuel level.
         */
        OFF(
            "Off",
            "No simulated engine data. Only what the tablet can measure.",
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        ),
        ;
    }

    override val id = "simulated"
    override val label = "Simulated engine data"

    override val supportedMetrics = setOf(
        Metric.RPM,
        Metric.ENGINE_LOAD,
        Metric.COOLANT_TEMPERATURE,
        Metric.FUEL_LEVEL,
        Metric.THROTTLE_POSITION,
        Metric.BATTERY_VOLTAGE,
        Metric.ODOMETER,
        Metric.DTC,
    )

    private val _status = MutableStateFlow(ProviderStatus.STOPPED)
    override val status: StateFlow<ProviderStatus> = _status.asStateFlow()

    @Volatile
    var scenario: Scenario = initialScenario
        set(value) {
            field = value
            DebugLog.info("telemetry", "Simulator scenario set to ${value.name}")
        }

    /**
     * Speed, fed in from the phone provider.
     *
     * The simulator reads the *real* road speed and derives plausible engine
     * values from it, rather than inventing a speed of its own. A stationary
     * truck showing 1,850 rpm is obviously wrong to anybody looking at the
     * screen, and obviously wrong test data teaches nobody anything.
     */
    @Volatile
    var observedSpeedKph: Double = 0.0

    /** Odometer, seeded from the vehicle's stored figure at sign-on. */
    @Volatile
    var odometerKm: Double = 0.0

    private val random = Random(System.currentTimeMillis())
    private var fuel: Double = 0.0
    private var startedAtMs: Long = 0L

    override suspend fun start() {
        if (!BuildConfig.ALLOW_SIMULATION) {
            // The provider exists in a release build but refuses to run, so the
            // rest of the app needs no build-type branches of its own.
            _status.value = ProviderStatus.UNAVAILABLE
            return
        }
        fuel = scenario.fuelPercent
        startedAtMs = System.currentTimeMillis()
        _status.value = if (scenario == Scenario.OFF) {
            ProviderStatus.NOT_CONNECTED
        } else {
            ProviderStatus.RUNNING
        }
        DebugLog.info("telemetry", "Simulator started: ${scenario.name}")
    }

    override suspend fun stop() {
        _status.value = ProviderStatus.STOPPED
    }

    override fun sample(): Map<Metric, MetricValue> {
        if (_status.value != ProviderStatus.RUNNING) return emptyMap()
        if (scenario == Scenario.OFF) return emptyMap()

        val moving = observedSpeedKph > 3.0
        val now = System.currentTimeMillis()

        // RPM tracks real road speed between idle and cruise, with a little
        // jitter so a gauge does not look frozen.
        val rpm = if (moving) {
            val fraction = min(1.0, observedSpeedKph / 70.0)
            scenario.idleRpm + (scenario.cruiseRpm - scenario.idleRpm) * fraction
        } else {
            scenario.idleRpm
        } + random.nextDouble(-25.0, 25.0)

        // Fuel falls while moving. Slowly — a driver watching a tank empty in
        // ten minutes learns nothing except that the data is fake.
        if (moving) {
            fuel = max(0.0, fuel - FUEL_BURN_PER_SAMPLE)
            odometerKm += observedSpeedKph / 3_600.0 * (SAMPLE_SECONDS)
        }

        val load = if (moving) {
            min(100.0, scenario.engineLoadPercent + observedSpeedKph / 4.0)
        } else {
            scenario.engineLoadPercent * 0.4
        }

        // Coolant climbs toward the scenario's figure from a cold start, so a
        // terminal that has just been switched on does not immediately report a
        // fully warmed engine.
        val warmupFraction = min(1.0, (now - startedAtMs) / WARMUP_MS.toDouble())
        val coolant = COLD_START_C + (scenario.coolantC - COLD_START_C) * warmupFraction

        return buildMap {
            put(Metric.RPM, MetricValue(rpm, MetricSource.SIMULATED, now))
            put(Metric.ENGINE_LOAD, MetricValue(load, MetricSource.SIMULATED, now))
            put(Metric.COOLANT_TEMPERATURE, MetricValue(coolant, MetricSource.SIMULATED, now))
            put(Metric.FUEL_LEVEL, MetricValue(fuel, MetricSource.SIMULATED, now))
            put(
                Metric.THROTTLE_POSITION,
                MetricValue(min(100.0, load * 0.9), MetricSource.SIMULATED, now),
            )
            put(
                Metric.BATTERY_VOLTAGE,
                MetricValue(
                    scenario.batteryVolts + random.nextDouble(-0.15, 0.15),
                    MetricSource.SIMULATED,
                    now,
                ),
            )
            if (odometerKm > 0.0) {
                put(Metric.ODOMETER, MetricValue(odometerKm, MetricSource.SIMULATED, now))
            }
            if (scenario.diagnostics.isNotEmpty()) {
                put(Metric.DTC, MetricValue(scenario.diagnostics.size.toDouble(), MetricSource.SIMULATED, now))
            }
        }
    }

    fun diagnostics(): List<DiagnosticCode> =
        if (_status.value != ProviderStatus.RUNNING) {
            emptyList()
        } else {
            scenario.diagnostics.map { (code, description) ->
                DiagnosticCode(code, description, MetricSource.SIMULATED)
            }
        }

    private companion object {
        const val COLD_START_C = 24.0
        const val WARMUP_MS = 240_000L
        const val SAMPLE_SECONDS = 5.0
        const val FUEL_BURN_PER_SAMPLE = 0.004
    }
}
