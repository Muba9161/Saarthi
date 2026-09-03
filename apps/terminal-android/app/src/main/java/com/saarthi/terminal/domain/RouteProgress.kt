package com.saarthi.terminal.domain

import com.saarthi.terminal.network.RouteDto
import com.saarthi.terminal.network.RouteStepDto
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Where the vehicle is *on the route*, rather than near it.
 *
 * The previous answer to "which turn is next" was: of every step in the route,
 * whichever manoeuvre point happens to be closest in a straight line. That is
 * wrong in the two situations a driver most needs it to be right.
 *
 *  * **Just after a turn.** The manoeuvre you have completed is still the
 *    nearest one for several hundred metres, so the banner kept pointing at a
 *    junction that was already behind the cab, its distance counting *up*.
 *  * **Anywhere a route doubles back** — a cloverleaf, a service road running
 *    beside the carriageway, a U-turn at a central reservation. The nearest
 *    manoeuvre by straight line is routinely one on the other carriageway,
 *    twenty metres away and forty minutes ahead.
 *
 * The fix is to stop measuring proximity and start measuring *progress*: the
 * vehicle is projected onto the polyline, which gives one number — how far along
 * the route it is — and every question then has an unambiguous answer. The next
 * manoeuvre is the first one further along than the vehicle. The distance to it
 * is the difference. What remains of the journey is the rest of the line. And
 * how far the vehicle sits *off* the line is the same calculation's by-product,
 * which is what makes re-routing possible at all.
 *
 * All of it runs on the device, on a route it already holds. A driver has to
 * keep being told where to turn inside a tunnel, and a server round trip per
 * instruction would be slow when it worked and useless when it did not.
 */
class RoutePath private constructor(
    private val latitudes: DoubleArray,
    private val longitudes: DoubleArray,
    /** Distance in metres from the start of the route to each vertex. */
    private val cumulative: DoubleArray,
    /** Every step, with how far along the route its manoeuvre point sits. */
    val steps: List<StepOnPath>,
) {

    /** The route's full length, in metres. */
    val totalMetres: Double get() = cumulative.lastOrNull() ?: 0.0

    /** One instruction, and where on the line it happens. */
    data class StepOnPath(
        val step: RouteStepDto,
        val alongMetres: Double,
    )

    /**
     * The vehicle's position, resolved against the line.
     *
     * `alongMetres` is how far the vehicle has travelled measured along the
     * route rather than through the air, and `offRouteMetres` is how far it is
     * from the line — the two numbers everything else here is built from.
     */
    data class Fix(
        val alongMetres: Double,
        val offRouteMetres: Double,
        /** Index of the segment the vehicle projected onto. Seeds the next search. */
        val segmentIndex: Int,
        /** Bearing of the road at that point, in degrees. Null on a degenerate segment. */
        val courseDegrees: Double?,
    )

    /**
     * Put the vehicle on the line.
     *
     * [near] is the segment index the last fix landed on. Searching outward from
     * it rather than scanning the whole polyline is what keeps this cheap on a
     * three-hundred-kilometre route at one fix a second — and, more importantly,
     * it is what stops a route that passes near itself from teleporting the
     * vehicle to the wrong lap of a ring road.
     *
     * The window is abandoned when nothing in it is close: a driver who has just
     * rejoined the route ten kilometres further on, or a terminal that was off
     * for an hour, needs the full scan. That is the rare case, so it costs the
     * full scan and nothing else pays for it.
     */
    fun locate(latitude: Double, longitude: Double, near: Int = 0): Fix {
        if (latitudes.size < 2) {
            return Fix(alongMetres = 0.0, offRouteMetres = 0.0, segmentIndex = 0, courseDegrees = null)
        }

        val windowed = search(latitude, longitude, from = near, to = near + SEARCH_WINDOW_SEGMENTS)
        if (windowed.offRouteMetres <= WINDOW_TRUSTED_METRES) return windowed

        val full = search(latitude, longitude, from = 0, to = latitudes.size - 2)
        return if (full.offRouteMetres < windowed.offRouteMetres) full else windowed
    }

    private fun search(latitude: Double, longitude: Double, from: Int, to: Int): Fix {
        val first = from.coerceIn(0, latitudes.size - 2)
        val last = to.coerceIn(first, latitudes.size - 2)

        var bestDistance = Double.MAX_VALUE
        var bestAlong = 0.0
        var bestIndex = first
        var bestCourse: Double? = null

        // A local flat-earth frame. Over a route segment — tens of metres to a
        // few kilometres — the error against a proper geodesic projection is
        // centimetres, and it turns a per-segment trigonometric distance into
        // arithmetic. That matters: this runs over every segment in the window
        // on every GPS fix.
        val metresPerDegreeLng = METRES_PER_DEGREE_LAT * cos(Math.toRadians(latitude))

        for (index in first..last) {
            val ax = (longitudes[index] - longitude) * metresPerDegreeLng
            val ay = (latitudes[index] - latitude) * METRES_PER_DEGREE_LAT
            val bx = (longitudes[index + 1] - longitude) * metresPerDegreeLng
            val by = (latitudes[index + 1] - latitude) * METRES_PER_DEGREE_LAT

            val dx = bx - ax
            val dy = by - ay
            val lengthSquared = dx * dx + dy * dy

            // How far along this segment the perpendicular from the vehicle
            // falls, clamped to the segment so a projection that lands beyond
            // either end resolves to that end rather than off the line.
            val t = if (lengthSquared <= 0.0) {
                0.0
            } else {
                (((-ax) * dx + (-ay) * dy) / lengthSquared).coerceIn(0.0, 1.0)
            }

            val px = ax + dx * t
            val py = ay + dy * t
            val distance = sqrt(px * px + py * py)

            if (distance < bestDistance) {
                bestDistance = distance
                val segmentLength = cumulative[index + 1] - cumulative[index]
                bestAlong = cumulative[index] + segmentLength * t
                bestIndex = index
                bestCourse = if (lengthSquared <= 0.0) {
                    null
                } else {
                    bearing(
                        latitudes[index],
                        longitudes[index],
                        latitudes[index + 1],
                        longitudes[index + 1],
                    )
                }
            }
        }

        return Fix(
            alongMetres = bestAlong,
            offRouteMetres = bestDistance,
            segmentIndex = bestIndex,
            courseDegrees = bestCourse,
        )
    }

    /**
     * The manoeuvre the driver is heading for.
     *
     * The first step further along the route than the vehicle, with a small
     * tolerance so a fix that lands a few metres past a junction does not skip
     * the instruction the driver is in the middle of following.
     *
     * `depart` is never returned: it describes the moment of setting off, and a
     * banner telling somebody to head north on the road they are already on is
     * an instruction with no decision in it.
     */
    fun nextStep(alongMetres: Double): StepOnPath? =
        steps.firstOrNull { it.alongMetres > alongMetres - STEP_PASSED_TOLERANCE_METRES }

    companion object {

        /**
         * Build the line, or null when there is not enough of one to follow.
         *
         * A route with fewer than two points cannot be projected onto and cannot
         * carry a distance. Returning null rather than an empty path means every
         * caller has to decide what to do without one, which is the correct
         * amount of thinking to force.
         */
        fun of(route: RouteDto): RoutePath? {
            val geometry = route.geometry
            if (geometry.size < 2) return null

            val size = geometry.size
            val latitudes = DoubleArray(size)
            val longitudes = DoubleArray(size)
            val cumulative = DoubleArray(size)

            for (index in 0 until size) {
                latitudes[index] = geometry[index].latitude
                longitudes[index] = geometry[index].longitude
                cumulative[index] = if (index == 0) {
                    0.0
                } else {
                    cumulative[index - 1] + haversineMetres(
                        latitudes[index - 1],
                        longitudes[index - 1],
                        latitudes[index],
                        longitudes[index],
                    )
                }
            }

            val path = RoutePath(latitudes, longitudes, cumulative, emptyList())

            /*
             * Each step, placed on the line.
             *
             * Steps arrive as coordinates, not as offsets, so each manoeuvre
             * point is projected onto the polyline the same way the vehicle is.
             * The search is seeded from the previous step's position and moves
             * only forward, because route steps are in order and a junction that
             * geometrically resembles an earlier one must not be matched to it.
             */
            var cursor = 0
            val placed = mutableListOf<StepOnPath>()
            for (step in route.steps) {
                val fix = path.search(step.latitude, step.longitude, cursor, cursor + STEP_SEARCH_SEGMENTS)
                cursor = fix.segmentIndex
                if (step.maneuver == "depart") continue
                placed += StepOnPath(step = step, alongMetres = fix.alongMetres)
            }

            return RoutePath(
                latitudes,
                longitudes,
                cumulative,
                // Sorted defensively: a router that emits a step out of order
                // would otherwise make `nextStep` skip everything after it.
                placed.sortedBy { it.alongMetres },
            )
        }

        private const val METRES_PER_DEGREE_LAT = 111_320.0

        /**
         * How far ahead and behind the last fix to look.
         *
         * Generous enough to cover a terminal that missed a minute of fixes at
         * motorway speed, small enough that a route folding back on itself
         * cannot capture the projection.
         */
        private const val SEARCH_WINDOW_SEGMENTS = 400

        /** Within this of the line, the windowed answer needs no second opinion. */
        private const val WINDOW_TRUSTED_METRES = 40.0

        /** How far a step's own projection may wander from the previous one. */
        private const val STEP_SEARCH_SEGMENTS = 2_000

        /**
         * How far past a manoeuvre it still counts as next.
         *
         * A fix taken mid-junction can land beyond the manoeuvre point while the
         * driver is still turning. Dropping the instruction at that moment is
         * exactly when they are looking up at it.
         */
        private const val STEP_PASSED_TOLERANCE_METRES = 15.0
    }
}

/**
 * Everything the cockpit needs to know about following a route, in one object.
 *
 * Assembled on every fix. One value rather than six flows, for the same reason
 * the cockpit's own state is one object: a banner that read them separately
 * could render a distance from one fix against an instruction from the next.
 */
data class RouteProgress(
    /** The manoeuvre coming up, or null once the last one is behind. */
    val step: RouteStepDto?,
    /** Metres to that manoeuvre, measured along the road. */
    val stepMetres: Int,
    /** Metres left of the whole journey. */
    val remainingMetres: Int,
    /** Minutes left, scaled from the route's own free-flow estimate. */
    val remainingMinutes: Int,
    /** How far the vehicle is from the line it is meant to be on. */
    val offRouteMetres: Int,
    /** True once that has been true for long enough to act on. See [RouteFollower]. */
    val offRoute: Boolean,
    /** True when the vehicle has reached where it was going. */
    val arrived: Boolean,
    /** Fraction of the route covered, 0..1. For the progress bar. */
    val fraction: Float,
)

/**
 * Follows a route across fixes, and decides when something has gone wrong.
 *
 * Stateful on purpose, and the state is the point: a single fix cannot tell you
 * whether a driver has left the route. GPS in a city puts a vehicle on the wrong
 * side of a dual carriageway several times a minute, and a re-route fired on one
 * bad sample is a re-route fired constantly — which costs the fleet a routing
 * call each time and, far worse, replaces a correct instruction with a wrong one
 * at the moment the driver is acting on it.
 *
 * So leaving the route has to be *sustained*: several consecutive fixes, all
 * well off the line, before it is believed. Rejoining is immediate, because a
 * driver who is back on the route should not be told otherwise for another five
 * seconds.
 */
class RouteFollower(route: RouteDto) {

    private val path: RoutePath? = RoutePath.of(route)
    private val destinationLat = route.destination.latitude
    private val destinationLng = route.destination.longitude
    private val plannedSeconds = route.durationMinutes * 60.0
    private val plannedMetres = route.distanceKm * 1_000.0

    private var lastSegment = 0
    private var offRouteFixes = 0

    /** The furthest the vehicle has got. Stops a noisy fix rewinding progress. */
    private var furthestAlong = 0.0

    /**
     * Advance the follower with a new position.
     *
     * Returns null when the route has no usable geometry — a straight-line
     * fallback from a router that could not produce a polyline, say. The caller
     * then has a destination and a distance but no turn-by-turn, which is
     * exactly what it should show.
     */
    fun update(latitude: Double, longitude: Double): RouteProgress? {
        val path = this.path ?: return null

        val fix = path.locate(latitude, longitude, near = lastSegment)
        lastSegment = fix.segmentIndex

        /*
         * Progress ratchets forward.
         *
         * Without this, a fix that projects a few metres back down the line —
         * routine at a junction where two segments run close together — makes
         * the distance-to-turn count *up*, which reads as the vehicle going
         * backwards. Reset only when the driver genuinely leaves the route,
         * where the old high-water mark is meaningless.
         */
        furthestAlong = if (fix.offRouteMetres > OFF_ROUTE_METRES) {
            fix.alongMetres
        } else {
            max(furthestAlong, fix.alongMetres)
        }

        offRouteFixes = if (fix.offRouteMetres > OFF_ROUTE_METRES) {
            min(offRouteFixes + 1, OFF_ROUTE_FIXES * 2)
        } else {
            0
        }

        val next = path.nextStep(furthestAlong)
        val remaining = max(0.0, path.totalMetres - furthestAlong)
        val straightLineToDestination =
            haversineMetres(latitude, longitude, destinationLat, destinationLng)

        /*
         * Arrival, decided two ways.
         *
         * By the route, because a driver who has covered all of it has arrived
         * whatever the pin says; and by straight line, because a destination
         * mapped fifty metres inside a forecourt leaves the route ending in the
         * wrong place and a driver parked at the pump waiting to be told they
         * are there.
         */
        val arrived =
            remaining <= ARRIVAL_ALONG_METRES || straightLineToDestination <= ARRIVAL_METRES

        return RouteProgress(
            step = next?.step,
            stepMetres = ((next?.alongMetres ?: path.totalMetres) - furthestAlong)
                .coerceAtLeast(0.0)
                .toInt(),
            remainingMetres = remaining.toInt(),
            // Scaled from the route's own estimate rather than from current
            // speed. A vehicle stopped at a light has a speed of zero, and an
            // ETA computed from it is infinity — which is both useless and,
            // briefly, alarming.
            remainingMinutes = remainingMinutes(remaining),
            offRouteMetres = fix.offRouteMetres.toInt(),
            offRoute = offRouteFixes >= OFF_ROUTE_FIXES,
            arrived = arrived,
            fraction = if (path.totalMetres <= 0.0) {
                0f
            } else {
                (furthestAlong / path.totalMetres).coerceIn(0.0, 1.0).toFloat()
            },
        )
    }

    private fun remainingMinutes(remainingMetres: Double): Int {
        if (plannedMetres <= 0.0 || plannedSeconds <= 0.0) return 0
        val seconds = plannedSeconds * (remainingMetres / plannedMetres)
        return max(0, Math.round(seconds / 60.0).toInt())
    }

    private companion object {
        /**
         * How far off the line counts as off the route.
         *
         * Wide enough to absorb a dual carriageway's other side and a city
         * centre's multipath, narrow enough to catch a driver who took the
         * previous exit. A tighter figure produces re-routes on straight roads.
         */
        const val OFF_ROUTE_METRES = 55.0

        /**
         * How many consecutive fixes have to agree before it is believed.
         *
         * At the terminal's default five-second cadence that is fifteen seconds
         * — long enough that a burst of bad fixes passes, short enough that a
         * driver who has taken the wrong exit is re-routed before the next
         * junction.
         */
        const val OFF_ROUTE_FIXES = 3

        /** Within this of the destination pin, the driver has arrived. */
        const val ARRIVAL_METRES = 55.0

        /** Or within this of the end of the line, which is the same thing. */
        const val ARRIVAL_ALONG_METRES = 30.0
    }
}

/** Metres between two points on the sphere. Good to a few metres at these scales. */
internal fun haversineMetres(
    fromLat: Double,
    fromLng: Double,
    toLat: Double,
    toLng: Double,
): Double {
    val earthRadius = 6_371_000.0
    val dLat = Math.toRadians(toLat - fromLat)
    val dLng = Math.toRadians(toLng - fromLng)
    val a = sin(dLat / 2) * sin(dLat / 2) +
        cos(Math.toRadians(fromLat)) * cos(Math.toRadians(toLat)) *
        sin(dLng / 2) * sin(dLng / 2)
    return 2 * earthRadius * atan2(sqrt(a), sqrt(1 - a))
}

/** Initial bearing from one point to another, in degrees clockwise from north. */
internal fun bearing(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
    val fromLatRad = Math.toRadians(fromLat)
    val toLatRad = Math.toRadians(toLat)
    val dLng = Math.toRadians(toLng - fromLng)
    val y = sin(dLng) * cos(toLatRad)
    val x = cos(fromLatRad) * sin(toLatRad) - sin(fromLatRad) * cos(toLatRad) * cos(dLng)
    return (Math.toDegrees(atan2(y, x)) + 360.0) % 360.0
}

/** The shorter way round between two bearings, in degrees. Always 0..180. */
internal fun bearingDelta(from: Double, to: Double): Double {
    val delta = abs(((to - from + 540.0) % 360.0) - 180.0)
    return delta
}
