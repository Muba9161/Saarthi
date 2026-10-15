package com.saarthi.owner.ui.trips

import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.map.MapVehicle
import com.saarthi.owner.ui.map.MarkerState
import com.saarthi.owner.ui.map.TrailRun
import com.saarthi.owner.ui.map.TrailTone
import com.saarthi.owner.ui.map.splitRoute
import com.saarthi.owner.ui.map.trailRuns
import com.saarthi.owner.ui.map.trailToneOf

/**
 * What a trip draws on the route map, read from the trip as the server sent
 * it: its two ends, its planned road, and the vehicle while it is on the job.
 */

/** Where the trip picks up, when the server sent the point. */
val TripsApi.Trip.pickupPoint: Pair<Double, Double>?
    get() = originLatitude?.let { lat -> originLongitude?.let { lng -> lat to lng } }

/** Where the trip drops, when this viewer may know it. */
val TripsApi.Trip.dropPoint: Pair<Double, Double>?
    get() = destinationLatitude?.let { lat -> destinationLongitude?.let { lng -> lat to lng } }

val TripsApi.Trip.routePoints: List<Pair<Double, Double>>
    get() = plannedRoute.map { it.latitude to it.longitude }

/**
 * The vehicle as a disc, only while the trip is still its job. Once a trip is
 * completed or cancelled the vehicle's position is wherever its next work
 * took it, which is not part of this trip.
 */
fun TripsApi.Trip.mapVehicle(): MapVehicle? {
    val here = currentLocation ?: return null
    if (closed) return null
    return MapVehicle(
        id = id,
        latitude = here.latitude,
        longitude = here.longitude,
        state = if (underway) MarkerState.MOVING else MarkerState.IDLE,
        label = formatPlate(truck?.registrationNumber.orEmpty()),
    )
}

/** Stored fixes as coloured runs, by the route state the server judged on each. */
fun travelledRuns(points: List<TripsApi.TrackPoint>): List<TrailRun> =
    trailRuns(points, at = { it.latitude to it.longitude }, toneOf = { trailToneOf(it.routeState) })

/**
 * The planned road split where the vehicle stands, for a viewer with no stored
 * path to draw: the road behind it as covered trail, the rest as the route.
 *
 * Before the vehicle sets off nothing is covered; once it reaches the drop
 * everything is. A cancelled trip shows only its plan.
 */
fun TripsApi.Trip.coveredAlongPlan(): Pair<List<Pair<Double, Double>>, List<TrailRun>> {
    val route = routePoints
    if (route.size < 2) return route to emptyList()
    if (reachedDrop) return emptyList<Pair<Double, Double>>() to listOf(TrailRun(route, TrailTone.ON_ROUTE))
    val here = currentLocation
    if (!underway || here == null) return route to emptyList()
    val split = splitRoute(route, here.latitude, here.longitude) ?: return route to emptyList()
    return split.ahead to listOf(TrailRun(split.behind, TrailTone.ON_ROUTE))
}
