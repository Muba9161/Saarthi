package com.saarthi.terminal.telemetry

import kotlinx.coroutines.flow.StateFlow

/**
 * Where vehicle data comes from.
 *
 * This is the abstraction sections 20 and 21 of the specification ask for, and
 * the reason it exists is a date: the OBD adapter has been ordered and has not
 * arrived. Everything above this interface — the cockpit gauges, the pre-trip
 * checklist, the assistant, the frames posted to Saarthi — is written against
 * [TelemetrySnapshot] and knows nothing about where a value came from. When the
 * adapter arrives, [BluetoothObdTelemetryProvider] starts returning real
 * readings and nothing else in the app changes.
 *
 * The rule that makes it safe is [MetricSource]. Every value carries the source
 * that produced it, and a simulated one says so all the way to the screen, into
 * the frame posted to the gateway, and into the checklist submission stored
 * against the vehicle a year later. A fabricated coolant temperature that read
 * as real would send a working truck to a workshop for a fault that does not
 * exist — so the type makes it impossible to hold a value without its
 * provenance.
 */
interface TelemetryProvider {

    /** Stable identifier, used in diagnostics and in the admin screen. */
    val id: String

    /** What an installer sees. */
    val label: String

    /** Metrics this provider can genuinely produce. Never aspirational. */
    val supportedMetrics: Set<Metric>

    val status: StateFlow<ProviderStatus>

    /** Begin producing. Idempotent — a second call on a running provider is a no-op. */
    suspend fun start()

    suspend fun stop()

    /**
     * The current values, or an empty map.
     *
     * Absent means "not measured", never zero. A provider that cannot read fuel
     * omits the key rather than reporting 0%, because a gauge showing an empty
     * tank on a full truck is worse than a gauge showing nothing.
     */
    fun sample(): Map<Metric, MetricValue>
}

/**
 * The normalised metric vocabulary.
 *
 * Deliberately the same names as `TelemetryMetric` in `packages/shared`, so a
 * value can travel from a sensor here to a checklist rule on the server without
 * a translation table in the middle that somebody has to keep in step.
 */
enum class Metric {
    LOCATION,
    SPEED,
    HEADING,
    ALTITUDE,
    GPS_ACCURACY,
    SATELLITES,
    ACCELEROMETER,
    SIGNAL_STRENGTH,

    // Engine metrics. A phone or tablet can never measure these; they come from
    // the simulator today and from the OBD adapter when it arrives.
    RPM,
    ENGINE_LOAD,
    COOLANT_TEMPERATURE,
    // Air on the way in. Reads high on a blocked filter, which is a fault a
    // driver cannot see and a workshop charges to diagnose.
    INTAKE_TEMPERATURE,
    FUEL_LEVEL,
    // Litres per hour, straight from the ECU — the number a fuel card cannot
    // give a fleet, because a card only knows what was bought.
    FUEL_RATE,
    THROTTLE_POSITION,
    BATTERY_VOLTAGE,
    ODOMETER,
    DTC,
}

/** Where one value came from. Travels with the value, always. */
enum class MetricSource {
    /** Measured by the tablet's own sensors. Real. */
    PHONE,

    /** Produced by the on-device simulator. Never real, always labelled. */
    SIMULATED,

    /** Read from the vehicle's ECU over a Bluetooth OBD adapter. Real. */
    OBD,

    /** Read from fitted production hardware. Real. */
    PRODUCTION,
    ;

    val isMeasured: Boolean get() = this != SIMULATED
}

/**
 * One reading and its provenance.
 *
 * There is no constructor that produces a value without a source. That is the
 * whole point of the class: the alternative — a `Double` plus a `simulated`
 * boolean somewhere else — is a pairing that eventually gets separated by a
 * refactor, and the value survives while the warning does not.
 */
data class MetricValue(
    val value: Double,
    val source: MetricSource,
    val at: Long = System.currentTimeMillis(),
) {
    val simulated: Boolean get() = source == MetricSource.SIMULATED
}

/**
 * A provider's own report on itself.
 *
 * `NOT_CONNECTED` is a first-class state rather than an error. The OBD provider
 * lives in this state permanently until the adapter arrives, and nothing about
 * the app should treat that as a fault to be surfaced to a driver.
 */
enum class ProviderStatus {
    STOPPED,
    STARTING,
    RUNNING,
    /** Available but with nothing attached. The OBD provider's resting state. */
    NOT_CONNECTED,
    /** Running with reduced fidelity — coarse location, say. */
    DEGRADED,
    /** The permission this provider needs was refused. */
    PERMISSION_DENIED,
    /** The hardware is not present on this device at all. */
    UNAVAILABLE,
    ERROR,
}

/**
 * Everything known about the vehicle at one instant, normalised.
 *
 * This is what the entire app above the telemetry layer consumes — section 20's
 * "the UI consumes normalized data" made concrete. Nothing in a screen or a
 * view model knows whether the fuel level came from a simulator or an ECU; they
 * know only whether it is present and whether it is measured.
 */
data class TelemetrySnapshot(
    val at: Long = System.currentTimeMillis(),
    val values: Map<Metric, MetricValue> = emptyMap(),
    /**
     * Where the vehicle is.
     *
     * Carried alongside `values` rather than inside it, because a position is
     * two numbers that must never be separated and [MetricValue] holds one.
     * `Metric.LOCATION` still appears in `values` as the presence flag and to
     * carry the source, so the "is this measured or simulated" question has one
     * answer for every metric including this one.
     */
    val position: Position? = null,
    val diagnostics: List<DiagnosticCode> = emptyList(),
    /** Which providers contributed, for the diagnostics screen. */
    val contributors: List<String> = emptyList(),
) {
    operator fun get(metric: Metric): MetricValue? = values[metric]

    fun value(metric: Metric): Double? = values[metric]?.value

    /** True when this metric is present *and* was actually measured. */
    fun isMeasured(metric: Metric): Boolean = values[metric]?.source?.isMeasured == true

    fun isSimulated(metric: Metric): Boolean = values[metric]?.simulated == true

    val hasSimulatedValues: Boolean get() = values.values.any { it.simulated }

    val hasPosition: Boolean get() = position != null

    /** Metric names, as the Saarthi wire contract spells them. */
    fun metricNames(): List<String> = values.keys.map { it.name }

    fun simulatedMetricNames(): List<String> =
        values.filterValues { it.simulated }.keys.map { it.name }
}

data class Position(
    val latitude: Double,
    val longitude: Double,
    val accuracyMetres: Double? = null,
    val source: MetricSource = MetricSource.PHONE,
    val at: Long = System.currentTimeMillis(),
)

data class DiagnosticCode(
    val code: String,
    val description: String?,
    val source: MetricSource,
) {
    val simulated: Boolean get() = source == MetricSource.SIMULATED
}
