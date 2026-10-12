package com.saarthi.core.domain

import com.saarthi.core.network.RoutePointDto
import kotlin.math.cos
import kotlin.math.sqrt

/**
 * Fit a road route into [maxPoints] without changing its shape.
 *
 * Keeping every n-th vertex cuts across hairpin bends — the shape a ghat road
 * is made of — by more than the distance at which a vehicle counts as off its
 * route, so a driver following the plan exactly would be drawn red. This uses
 * Douglas–Peucker instead: points are dropped only where the line stays within
 * a tolerance of the original, starting at five metres and doubling until the
 * route fits. Both ends are always kept.
 */
fun simplifyRoute(points: List<RoutePointDto>, maxPoints: Int): List<RoutePointDto> {
    if (points.size <= maxPoints || points.size < 3) return points
    var tolerance = START_TOLERANCE_METRES
    while (true) {
        val kept = douglasPeucker(points, tolerance)
        if (kept.size <= maxPoints) return kept
        tolerance *= 2
    }
}

private fun douglasPeucker(points: List<RoutePointDto>, toleranceMetres: Double): List<RoutePointDto> {
    val keep = BooleanArray(points.size)
    keep[0] = true
    keep[points.lastIndex] = true
    val stack = ArrayDeque<Pair<Int, Int>>().apply { add(0 to points.lastIndex) }
    val metresPerDegreeLng = METRES_PER_DEGREE * cos(Math.toRadians(points[0].latitude))

    while (stack.isNotEmpty()) {
        val (first, last) = stack.removeLast()
        var farthest = -1
        var farthestDistance = toleranceMetres
        for (index in first + 1 until last) {
            val distance = offsetMetres(points[index], points[first], points[last], metresPerDegreeLng)
            if (distance > farthestDistance) {
                farthestDistance = distance
                farthest = index
            }
        }
        if (farthest >= 0) {
            keep[farthest] = true
            stack.add(first to farthest)
            stack.add(farthest to last)
        }
    }
    return points.filterIndexed { index, _ -> keep[index] }
}

/** Distance from [point] to the segment [start]–[end], in a local flat frame. */
private fun offsetMetres(
    point: RoutePointDto,
    start: RoutePointDto,
    end: RoutePointDto,
    metresPerDegreeLng: Double,
): Double {
    val ax = (start.longitude - point.longitude) * metresPerDegreeLng
    val ay = (start.latitude - point.latitude) * METRES_PER_DEGREE
    val bx = (end.longitude - point.longitude) * metresPerDegreeLng
    val by = (end.latitude - point.latitude) * METRES_PER_DEGREE
    val dx = bx - ax
    val dy = by - ay
    val lengthSquared = dx * dx + dy * dy
    val t = if (lengthSquared <= 0.0) 0.0 else ((-ax * dx - ay * dy) / lengthSquared).coerceIn(0.0, 1.0)
    val px = ax + dx * t
    val py = ay + dy * t
    return sqrt(px * px + py * py)
}

private const val METRES_PER_DEGREE = 111_320.0
private const val START_TOLERANCE_METRES = 5.0
