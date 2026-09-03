package com.saarthi.terminal.telemetry

import com.saarthi.terminal.domain.haversineMetres
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.math.max

/**
 * How far the vehicle went, how fast, and how it was driven.
 *
 * The terminal already knew all of this a fix at a time and threw every bit of
 * it away. Speed was rendered on a dial and discarded; the accelerometer's harsh
 * events were consumed by whichever telemetry frame happened to read them next;
 * distance was never computed at all. So a vehicle could drive to a petrol pump
 * and back and the only trace was a scatter of positions on a map — no distance,
 * no top speed, no braking, and an odometer that had not moved.
 *
 * This is the accumulator that fixes that. It runs whenever the telemetry hub
 * runs, not only during a trip, because the two questions it answers have
 * different lifetimes:
 *
 *  * **The odometer** is a property of the vehicle and never resets. It accrues
 *    whether the driver is on a dispatched trip, running to a workshop, or
 *    repositioning in a yard.
 *  * **A run's summary** — distance, top speed, average speed, harsh events — is
 *    a property of one journey, and [beginSegment] starts a fresh one.
 *
 * Both are computed from measurements the tablet genuinely made. Nothing here is
 * simulated, and nothing here is stamped as a measurement it is not: an odometer
 * derived from GPS is honest about being derived, and the server keeps whichever
 * of that and a real ECU reading is larger.
 */
class TripRecorder {

    /**
     * What one journey added up to.
     *
     * Every field optional-by-convention rather than by type: a run with no GPS
     * reports zero distance and a null top speed, and the difference between
     * "did not move" and "nobody knows" is carried by [samples] being zero.
     */
    data class Segment(
        val distanceKm: Double = 0.0,
        val topSpeedKph: Double = 0.0,
        /**
         * Mean speed while actually moving.
         *
         * Moving-average rather than distance-over-elapsed-time, deliberately.
         * A run that included twenty minutes queuing at a pump has an
         * elapsed-time average that describes the queue rather than the driving,
         * and a fleet comparing drivers on it would be comparing forecourts.
         */
        val averageSpeedKph: Double = 0.0,
        val harshBrakingCount: Int = 0,
        val harshAccelerationCount: Int = 0,
        /** How many fixes contributed. Zero means there is nothing to report. */
        val samples: Int = 0,
        val startedAtMs: Long = System.currentTimeMillis(),
    ) {
        val hasData: Boolean get() = samples > 0
    }

    private val _segment = MutableStateFlow(Segment())

    /** The journey currently being measured. */
    val segment: StateFlow<Segment> = _segment.asStateFlow()

    private val _odometerKm = MutableStateFlow<Double?>(null)
    /**
     * The vehicle's odometer, as this terminal believes it.
     *
     * Null until Saarthi has told the terminal where the vehicle started, which
     * is the honest answer: a tablet has no way of knowing a truck's mileage,
     * only how far it has watched it travel. Once seeded, it advances with the
     * vehicle so the cockpit gauge moves in real time rather than stepping
     * every thirty seconds when the state poll comes back.
     */
    val odometerKm: StateFlow<Double?> = _odometerKm.asStateFlow()

    private var lastLatitude: Double? = null
    private var lastLongitude: Double? = null
    private var lastFixAtMs: Long = 0L

    /** Sum of moving speeds, and how many there were. The average's two halves. */
    private var movingSpeedSum: Double = 0.0
    private var movingSpeedSamples: Int = 0

    /**
     * Seed the odometer from the vehicle's stored figure.
     *
     * Applied once, and then only ever raised. Saarthi's figure is refreshed
     * every thirty seconds; adopting it each time would rewind whatever this
     * terminal has measured since the last poll and lose those kilometres on
     * every cycle. Taking the larger of the two means a terminal that has been
     * running ahead keeps its ground, and one that has just started — or has
     * been overtaken by a fitted tracker reporting the same vehicle — catches up.
     */
    fun seedOdometer(vehicleOdometerKm: Double?) {
        if (vehicleOdometerKm == null || vehicleOdometerKm <= 0.0) return
        val current = _odometerKm.value
        if (current == null || vehicleOdometerKm > current) {
            _odometerKm.value = vehicleOdometerKm
        }
    }

    /** Start measuring a new journey. Returns what the previous one came to. */
    fun beginSegment(): Segment {
        val previous = _segment.value
        movingSpeedSum = 0.0
        movingSpeedSamples = 0
        _segment.value = Segment()
        return previous
    }

    /** What the current journey has come to, without ending it. */
    fun currentSegment(): Segment = _segment.value

    /**
     * Fold in one fix.
     *
     * Called from the telemetry hub on every assembled snapshot, which is the
     * only place that has a position, a speed and the motion flags together.
     *
     * The two filters are the whole of the accuracy story:
     *
     *  * **A step below [MIN_STEP_METRES] is discarded.** A parked vehicle's
     *    fixes wander by a metre or two as the satellite geometry shifts, and
     *    summed over a shift that is a kilometre of distance on a truck that
     *    never moved.
     *  * **A step that implies an impossible speed is discarded.** A cold-start
     *    fix, a multipath reflection off a warehouse, or the gap either side of a
     *    tunnel produce jumps of hundreds of metres between consecutive samples.
     *    The vehicle may genuinely have covered that ground, but not in a way
     *    this step can account for, and counting it would put phantom kilometres
     *    on a fleet's odometer every time a truck went under a bridge.
     */
    fun record(snapshot: TelemetrySnapshot, harshBraking: Int, harshAcceleration: Int) {
        val position = snapshot.position
        val speedKph = snapshot.value(Metric.SPEED)
        val now = snapshot.at

        var stepKm = 0.0
        val previousLat = lastLatitude
        val previousLng = lastLongitude

        /*
         * The odometer moves only while the vehicle reports a speed.
         *
         * Every other guard here is about whether a *measurement* is good
         * enough; this one is about whether the vehicle moved at all, and it is
         * the one that holds when the others do not. A device with no satellite
         * lock still produces positions — from Wi-Fi and cell towers — that jump
         * twenty or thirty metres between samples while sitting on a desk, and
         * no amount of comparing step size against claimed accuracy separates
         * that from driving.
         *
         * A speed reading does separate them: it comes from Doppler shift, it is
         * absent on a network fix, and it is zero on a stationary one.
         */
        val moving = (speedKph ?: 0.0) >= MOVING_KPH

        if (position != null) {
            if (moving && previousLat != null && previousLng != null) {
                val metres = haversineMetres(previousLat, previousLng, position.latitude, position.longitude)
                val elapsedSeconds = max(1.0, (now - lastFixAtMs) / 1_000.0)
                val impliedKph = metres / elapsedSeconds * 3.6

                /*
                 * Bigger than the error bars, or not counted.
                 *
                 * The phone provider already holds its position still when the
                 * vehicle is parked, so most noise never reaches here. This is
                 * the second net, and it is worth having because the two filters
                 * fail differently: that one is about whether the vehicle moved,
                 * this one is about whether *this measurement* is good enough to
                 * add to a number a fleet bills against.
                 */
                val uncertainty = position.accuracyMetres ?: ASSUMED_ACCURACY_METRES
                val believable = metres >= maxOf(MIN_STEP_METRES, uncertainty)

                if (believable && impliedKph <= MAX_IMPLIED_KPH) {
                    stepKm = metres / 1_000.0
                }
            }
            lastLatitude = position.latitude
            lastLongitude = position.longitude
            lastFixAtMs = now
        }

        if (moving && speedKph != null) {
            movingSpeedSum += speedKph
            movingSpeedSamples += 1
        }

        val current = _segment.value
        _segment.value = current.copy(
            distanceKm = current.distanceKm + stepKm,
            topSpeedKph = max(current.topSpeedKph, speedKph ?: 0.0),
            averageSpeedKph = if (movingSpeedSamples == 0) {
                0.0
            } else {
                movingSpeedSum / movingSpeedSamples
            },
            harshBrakingCount = current.harshBrakingCount + harshBraking,
            harshAccelerationCount = current.harshAccelerationCount + harshAcceleration,
            samples = current.samples + 1,
        )

        if (stepKm > 0.0) {
            _odometerKm.value?.let { odometer -> _odometerKm.value = odometer + stepKm }
        }
    }

    /**
     * Forget where the vehicle was.
     *
     * Called when tracking stops. Without it, the first fix after a gap — the
     * app restarted, the driver signed off in one city and on in another — would
     * be measured against a position from hours ago and book the whole gap as
     * distance travelled in five seconds. The implied-speed filter catches most
     * of that; this closes the case where the gap is long enough that even a
     * continental jump implies a plausible speed.
     */
    fun forgetPosition() {
        lastLatitude = null
        lastLongitude = null
        lastFixAtMs = 0L
    }

    private companion object {
        /** Below this a vehicle is parked and the movement is satellite noise. */
        const val MIN_STEP_METRES = 15.0

        /** What to assume when a fix does not say how good it is. Pessimistic. */
        const val ASSUMED_ACCURACY_METRES = 30.0

        /** Above this the step is a glitch, not a journey. */
        const val MAX_IMPLIED_KPH = 200.0

        /**
         * Above this the vehicle counts as moving.
         *
         * Low enough to catch a truck creeping across a yard, high enough to
         * exclude the couple of km/h a stationary receiver reports as its
         * estimate wanders. Distance below this is not counted at all, which
         * loses a little genuine crawling and prevents a great deal of invented
         * mileage — and of the two, invented mileage is the one that reaches a
         * fleet's service intervals and its billing.
         */
        const val MOVING_KPH = 3.0
    }
}
