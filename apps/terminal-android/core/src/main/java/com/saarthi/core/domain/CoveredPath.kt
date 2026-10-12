package com.saarthi.core.domain

/**
 * The path a vehicle has covered, coloured by how it got there — blue with no
 * trip, green on the trip's planned route, red off it, and amber on another
 * road to the destination while Google Maps guides.
 *
 * The server judges every stored point once, at ingest, and the app draws what
 * it was told. Only the fixes the app has not yet heard back about are judged
 * here, by the same rule with the same distances as
 * `packages/shared/src/domain/route-trail.ts`, so a point drawn green on the
 * phone is green on the fleet's screen too.
 */
enum class RouteState {
    NO_TRIP,
    ON_ROUTE,
    OFF_ROUTE,

    /** Another road to the destination while Google Maps guides — not the driver's fault. */
    ALTERNATE;

    /** Off the planned road, whichever way it is coloured. */
    val offRoute: Boolean get() = this == OFF_ROUTE || this == ALTERNATE

    companion object {
        /** An unknown spelling from a newer server reads as "no trip" — the neutral colour. */
        fun parse(value: String?): RouteState = entries.firstOrNull { it.name == value } ?: NO_TRIP
    }
}

data class TrailPoint(val latitude: Double, val longitude: Double, val state: RouteState)

object RouteTrail {

    /** Further than this from the planned route and the vehicle has left it. */
    const val LEAVE_METRES = 120.0

    /** Back within this and it has rejoined; the gap stops GPS wobble flickering the colour. */
    const val REJOIN_METRES = 80.0

    /**
     * The state of one fix.
     *
     * A trip without road geometry is "on its trip": measuring a road journey
     * against a two-point straight line would paint every bend red.
     */
    fun next(
        tripUnderway: Boolean,
        route: RoutePath?,
        latitude: Double,
        longitude: Double,
        previous: RouteState?,
    ): RouteState {
        if (!tripUnderway) return RouteState.NO_TRIP
        if (route == null || !route.isRoad) return RouteState.ON_ROUTE

        val offRouteMetres = route.locate(latitude, longitude).offRouteMetres
        return when {
            offRouteMetres > LEAVE_METRES -> RouteState.OFF_ROUTE
            offRouteMetres < REJOIN_METRES -> RouteState.ON_ROUTE
            previous?.offRoute == true -> RouteState.OFF_ROUTE
            else -> RouteState.ON_ROUTE
        }
    }

    /** How far back "still heading for the destination?" looks; a bend or a loop is not turning back. */
    const val ALTERNATE_LOOKBACK_MS = 3 * 60_000L

    /** Further from the destination than this, over the lookback, is moving away. */
    const val ALTERNATE_AWAY_METRES = 300.0

    /**
     * Whether a vehicle off its planned road is still on its way — asked only
     * while the driver follows Google Maps, whose route Saarthi cannot see.
     * With nothing to compare against yet, the benefit of the doubt goes to the
     * driver.
     */
    fun stillHeadingThere(earlierMetresToGo: Double?, nowMetresToGo: Double): Boolean =
        earlierMetresToGo == null || nowMetresToGo <= earlierMetresToGo + ALTERNATE_AWAY_METRES
}
