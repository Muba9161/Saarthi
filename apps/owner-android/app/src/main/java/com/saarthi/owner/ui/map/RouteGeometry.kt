package com.saarthi.owner.ui.map

import kotlin.math.cos

/**
 * The arithmetic behind a route drawn on [VehicleMap]: where a vehicle stands
 * on its planned road, and how a run of stored fixes becomes coloured trail.
 *
 * Pure Kotlin on (latitude, longitude) pairs, so it is tested without a map.
 */

/** A planned route cut where the vehicle stands on it. */
data class RouteSplit(
    /** From the start of the route to the vehicle's place on it. */
    val behind: List<Pair<Double, Double>>,
    /** From the vehicle's place on the route to its end. */
    val ahead: List<Pair<Double, Double>>,
)

/**
 * Cut [route] at the point on it nearest ([latitude], [longitude]).
 *
 * The web app's route-progress projection, in the same local planar
 * approximation: the position is snapped onto the nearest *segment*, not the
 * nearest vertex, so a two-point route still splits where the vehicle is
 * rather than at either end. Null when the route has no usable segment.
 */
fun splitRoute(route: List<Pair<Double, Double>>, latitude: Double, longitude: Double): RouteSplit? {
    if (route.size < 2) return null
    val lngScale = METRES_PER_DEGREE * cos(Math.toRadians(latitude))

    var bestSegment = -1
    var bestT = 0.0
    var bestDistance = Double.POSITIVE_INFINITY
    for (index in 1 until route.size) {
        val (startLat, startLng) = route[index - 1]
        val (endLat, endLng) = route[index]
        val ex = (endLng - startLng) * lngScale
        val ey = (endLat - startLat) * METRES_PER_DEGREE
        val lengthSquared = ex * ex + ey * ey
        if (lengthSquared == 0.0) continue

        val px = (longitude - startLng) * lngScale
        val py = (latitude - startLat) * METRES_PER_DEGREE
        val t = ((px * ex + py * ey) / lengthSquared).coerceIn(0.0, 1.0)
        val dx = px - t * ex
        val dy = py - t * ey
        val distance = dx * dx + dy * dy
        if (distance < bestDistance) {
            bestDistance = distance
            bestSegment = index - 1
            bestT = t
        }
    }
    if (bestSegment < 0) return null

    val (startLat, startLng) = route[bestSegment]
    val (endLat, endLng) = route[bestSegment + 1]
    val snapped = (startLat + (endLat - startLat) * bestT) to (startLng + (endLng - startLng) * bestT)
    return RouteSplit(
        behind = route.subList(0, bestSegment + 1) + snapped,
        ahead = listOf(snapped) + route.subList(bestSegment + 1, route.size),
    )
}

/** The trail tone for a route state the server stored on a fix. */
fun trailToneOf(routeState: String?): TrailTone = when (routeState) {
    "ON_ROUTE" -> TrailTone.ON_ROUTE
    "OFF_ROUTE" -> TrailTone.OFF_ROUTE
    "ALTERNATE" -> TrailTone.ALTERNATE
    else -> TrailTone.NO_TRIP
}

/**
 * Fixes grouped into runs of one tone, in the order given. Each run starts on
 * the last fix of the run before it, so the line never breaks where its
 * colour changes.
 */
fun <T> trailRuns(fixes: List<T>, at: (T) -> Pair<Double, Double>, toneOf: (T) -> TrailTone): List<TrailRun> {
    val runs = mutableListOf<TrailRun>()
    var points = mutableListOf<Pair<Double, Double>>()
    var tone: TrailTone? = null
    for (fix in fixes) {
        val next = toneOf(fix)
        val current = tone
        if (current != null && next != current) {
            if (points.size >= 2) runs += TrailRun(points, current)
            points = mutableListOf(points.last())
        }
        tone = next
        points += at(fix)
    }
    tone?.let { if (points.size >= 2) runs += TrailRun(points, it) }
    return runs
}

private const val METRES_PER_DEGREE = 111_320.0
