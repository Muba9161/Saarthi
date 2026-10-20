package com.saarthi.owner.ui.customer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.R
import com.saarthi.owner.network.OrdersApi
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.ago
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.dayOf
import com.saarthi.owner.ui.common.isNow
import com.saarthi.owner.ui.common.km
import com.saarthi.owner.ui.common.minutesSpan
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.fleet.RouteStops
import com.saarthi.owner.ui.map.TrailTone
import com.saarthi.owner.ui.map.RouteMapScreen
import com.saarthi.owner.ui.map.TripRouteMap
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.orders.orderStatusLook
import com.saarthi.owner.ui.trips.DriverLine
import com.saarthi.owner.ui.trips.Fact
import com.saarthi.owner.ui.trips.Facts
import com.saarthi.owner.ui.trips.TripSection
import com.saarthi.owner.ui.trips.VehicleLine
import com.saarthi.owner.ui.trips.coveredAlongPlan
import com.saarthi.owner.ui.trips.dropPoint
import com.saarthi.owner.ui.trips.mapVehicle
import com.saarthi.owner.ui.trips.pickupPoint
import com.saarthi.owner.ui.trips.wordOf

/*
 * The customer's order told as a journey: the road on a map, who is bringing
 * it, and what was ordered at what price. Only what the server shows a
 * customer is read here; the fleet's costs and the driver's phone never are.
 */

/** Where the order's two ends are, from the order itself before any trip exists. */
private val OrdersApi.Order.pickupPoint: Pair<Double, Double>?
    get() = originLatitude?.let { lat -> originLongitude?.let { lng -> lat to lng } }

private val OrdersApi.Order.dropPoint: Pair<Double, Double>?
    get() = destinationLatitude?.let { lat -> destinationLongitude?.let { lng -> lat to lng } }

/**
 * The order's road: pickup and drop from the start, the planned road once a
 * vehicle is dispatched, shaded as far as the vehicle has come, and the
 * vehicle itself while it is on the job.
 *
 * The shading is the planned road cut where the vehicle stands, the web's
 * driven/ahead split: a customer's plan keeps no stored GPS history to draw.
 */
@Composable
fun OrderRouteCard(
    order: OrdersApi.Order,
    trip: TripsApi.Trip?,
    tripError: String?,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    val (route, trail) = remember(trip) { trip?.coveredAlongPlan() ?: (emptyList<Pair<Double, Double>>() to emptyList()) }
    val vehicle = trip?.mapVehicle()
    val navigator = LocalNavigator.current
    val pickup = trip?.pickupPoint ?: order.pickupPoint
    val drop = trip?.dropPoint ?: order.dropPoint
    val routeLabel = stringResource(if (trail.isEmpty()) R.string.customer_route_planned else R.string.customer_route_still_to_go)
    val trailLabels = mapOf(TrailTone.ON_ROUTE to stringResource(R.string.customer_route_covered))

    TripRouteMap(
        route = route,
        trail = trail,
        pickup = pickup,
        drop = drop,
        vehicle = vehicle,
        routeLabel = routeLabel,
        trailLabels = trailLabels,
        onExpand = {
            navigator.push("order-map-${order.id}") {
                RouteMapScreen(
                    title = order.reference.ifBlank { stringResource(R.string.customer_your_order) },
                    route = route,
                    trail = trail,
                    pickup = pickup,
                    drop = drop,
                    vehicle = vehicle,
                    routeLabel = routeLabel,
                    trailLabels = trailLabels,
                )
            }
        },
        modifier = modifier,
    ) {
        val look = orderStatusLook(order.status)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            (trip?.truck?.registrationNumber ?: order.assignedTruck?.registrationNumber)?.ifBlank { null }?.let { PlateChip(it, size = 12.sp) }
            Text(look.word, style = SType.captionStrong, color = look.ink)
        }

        when {
            trip == null && tripError != null -> NoticeCard(stringResource(R.string.customer_route_load_failed, tripError), NoticeTone.WARNING)
            else -> Text(routeCaption(order, trip), style = SType.caption, color = c.muted)
        }

        RouteStops(
            from = order.originAddress ?: trip?.originAddress.orEmpty(),
            fromNote = clockOf(trip?.actualStartAt)?.let { stringResource(R.string.customer_route_left_at, it) }
                ?: clockOf(order.pickupAt)?.let { stringResource(R.string.customer_route_pickup_planned, it) },
            to = order.destinationAddress ?: trip?.destinationAddress.orEmpty(),
            toNote = clockOf(trip?.actualArrivalAt)?.let { stringResource(R.string.customer_arrived_at, it) }
                ?: clockOf(order.deliverBy)?.let { stringResource(R.string.customer_route_deliver_by, it) },
            eta = clockOf(trip?.etaAt)?.takeIf { trip?.underway == true },
        )

        journeyFacts(order, trip).takeIf { it.isNotEmpty() }?.let { Facts(it) }
    }
}

/** One sentence on what the map is showing, and how fresh it is. */
private fun routeCaption(order: OrdersApi.Order, trip: TripsApi.Trip?): String {
    if (trip == null) {
        return when {
            !order.open -> Words.get(R.string.customer_route_marked)
            order.tripId != null -> Words.get(R.string.customer_route_loading_trip)
            else -> Words.get(R.string.customer_route_marked_waiting)
        }
    }
    val reported = trip.currentLocation?.recordedAt?.let {
        if (isNow(it)) Words.get(R.string.customer_route_reporting_now) else Words.get(R.string.customer_route_last_reported, ago(it))
    }
    return when {
        trip.status == "CANCELLED" -> Words.get(R.string.customer_route_trip_cancelled)
        trip.plannedRoute.size < 2 -> Words.get(R.string.customer_route_not_planned)
        trip.reachedDrop -> Words.get(R.string.customer_route_reached_drop)
        trip.underway && trip.currentLocation == null -> Words.get(R.string.customer_route_no_position)
        trip.underway -> listOfNotNull(Words.get(R.string.customer_route_shaded), reported).joinToString(" ")
        trip.currentLocation != null -> listOfNotNull(Words.get(R.string.customer_route_parked_shown), reported).joinToString(" ")
        else -> Words.get(R.string.customer_route_not_set_off)
    }
}

/** How far, how much is left, how long and how late. */
private fun journeyFacts(order: OrdersApi.Order, trip: TripsApi.Trip?): List<Fact> = buildList {
    (trip?.plannedDistanceKm ?: order.distanceKm)?.let { add(Fact(Words.get(R.string.customer_fact_distance), km(it)!!)) }
    if (trip?.underway == true) trip.remainingKm?.let { add(Fact(Words.get(R.string.customer_fact_to_go), km(it)!!)) }
    when {
        trip?.actualDurationMin != null -> add(Fact(Words.get(R.string.customer_fact_on_the_road), minutesSpan(trip.actualDurationMin)!!))
        trip?.plannedDurationMin != null ->
            add(Fact(Words.get(R.string.customer_fact_run_time), minutesSpan(trip.plannedDurationMin)!!, Words.get(R.string.customer_fact_planned)))
    }
    if (trip != null && trip.late && !trip.closed) add(Fact(Words.get(R.string.customer_fact_running_late), minutesSpan(trip.delayMinutes)!!))
}

/** Who is bringing the order: the vehicle, its driver and the fleet. Nothing until one is assigned. */
@Composable
fun OrderVehicleCard(order: OrdersApi.Order, trip: TripsApi.Trip?, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val truck = trip?.truck ?: order.assignedTruck?.takeIf { it.registrationNumber.isNotBlank() }?.let {
        TripsApi.TripTruck(id = it.id, registrationNumber = it.registrationNumber)
    }
    val driver = trip?.driver?.name?.ifBlank { null } ?: order.assignedDriver?.name?.ifBlank { null }
    if (truck == null && driver == null) return

    TripSection(stringResource(R.string.customer_vehicle_and_driver), modifier) {
        truck?.let { VehicleLine(it) }
        // The customer is never given the driver's phone: no call here.
        driver?.let { DriverLine(it, trip?.driver?.overallScore) }
        order.fleetName?.let { Text(stringResource(R.string.customer_run_by, it), style = SType.small, color = c.muted) }
    }
}

/** What was ordered, what it needs, what it costs and what has been paid. */
@Composable
fun OrderDetailsCard(order: OrdersApi.Order, finance: OrdersApi.Finance?, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val needs = listOfNotNull(
        order.requiredTruckType?.takeIf { it.isNotBlank() && it != "OTHER" }?.let(::wordOf),
        order.requiredCapacityTons?.takeIf { it > 0 }?.let { stringResource(R.string.customer_capacity_tonnes, "${if (it % 1.0 == 0.0) it.toInt() else it}") },
    ).joinToString(" · ").ifBlank { null }
    val paid = finance?.payments?.filter { it.status == "SUCCEEDED" }?.sumOf { it.amount }?.takeIf { it > 0 }

    TripSection(stringResource(R.string.customer_order_details), modifier) {
        Facts(
            listOfNotNull(
                Fact(stringResource(R.string.customer_fact_load), order.what),
                needs?.let { Fact(stringResource(R.string.customer_fact_vehicle_needed), it) },
                order.reference.ifBlank { null }?.let { Fact(stringResource(R.string.customer_fact_reference), it) },
                dayOf(order.createdAt)?.let { Fact(stringResource(R.string.customer_fact_placed), it) },
            ),
        )
        val lines = listOfNotNull(
            order.materialPrice?.let { stringResource(R.string.customer_line_material) to it },
            order.transportPrice?.let { stringResource(R.string.customer_line_transport) to it },
            (finance?.finalAmount ?: finance?.agreedAmount ?: order.totalPrice)?.let { stringResource(R.string.customer_total) to it },
            paid?.let { stringResource(R.string.customer_line_paid_so_far) to it },
            finance?.balanceDue?.takeIf { it > 0 }?.let { stringResource(R.string.customer_line_balance_due) to it },
        )
        if (lines.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                lines.forEach { (label, amount) ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(label, style = SType.small, color = c.muted, modifier = Modifier.weight(1f))
                        Text(rupees(amount), style = SType.smallStrong, color = c.fg)
                    }
                }
            }
        }
        order.notes?.ifBlank { null }?.let { notes ->
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(stringResource(R.string.customer_your_note), style = SType.captionStrong, color = c.muted)
                Text(notes, style = SType.body, color = c.fg)
            }
        }
    }
}
