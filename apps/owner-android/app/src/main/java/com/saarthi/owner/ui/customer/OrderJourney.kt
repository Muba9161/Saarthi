package com.saarthi.owner.ui.customer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.network.OrdersApi
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.ago
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.dayOf
import com.saarthi.owner.ui.common.km
import com.saarthi.owner.ui.common.minutesSpan
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.fleet.RouteStops
import com.saarthi.owner.ui.map.TrailTone
import com.saarthi.owner.ui.map.TripRouteMap
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

    TripRouteMap(
        route = route,
        trail = trail,
        pickup = trip?.pickupPoint ?: order.pickupPoint,
        drop = trip?.dropPoint ?: order.dropPoint,
        vehicle = vehicle,
        routeLabel = if (trail.isEmpty()) "Planned route" else "Still to go",
        trailLabels = mapOf(TrailTone.ON_ROUTE to "Covered"),
        modifier = modifier,
    ) {
        val look = orderStatusLook(order.status)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            (trip?.truck?.registrationNumber ?: order.assignedTruck?.registrationNumber)?.ifBlank { null }?.let { PlateChip(it, size = 12.sp) }
            Text(look.word, style = SType.captionStrong, color = look.ink)
        }

        when {
            trip == null && tripError != null -> NoticeCard("Couldn't load the trip. $tripError", NoticeTone.WARNING)
            else -> Text(routeCaption(order, trip), style = SType.caption, color = c.muted)
        }

        RouteStops(
            from = order.originAddress ?: trip?.originAddress.orEmpty(),
            fromNote = clockOf(trip?.actualStartAt)?.let { "Left $it" } ?: clockOf(order.pickupAt)?.let { "Pickup planned $it" },
            to = order.destinationAddress ?: trip?.destinationAddress.orEmpty(),
            toNote = clockOf(trip?.actualArrivalAt)?.let { "Arrived $it" } ?: clockOf(order.deliverBy)?.let { "Deliver by $it" },
            eta = clockOf(trip?.etaAt)?.takeIf { trip?.underway == true },
        )

        journeyFacts(order, trip).takeIf { it.isNotEmpty() }?.let { Facts(it) }
    }
}

/** One sentence on what the map is showing, and how fresh it is. */
private fun routeCaption(order: OrdersApi.Order, trip: TripsApi.Trip?): String {
    if (trip == null) {
        return when {
            !order.open -> "Pickup and drop are marked."
            order.tripId != null -> "Loading the trip…"
            else -> "Pickup and drop are marked. The road appears here once the fleet sends a vehicle."
        }
    }
    val reported = trip.currentLocation?.recordedAt?.let(::ago)?.let { if (it == "now") "Reporting now." else "Last reported $it ago." }
    return when {
        trip.status == "CANCELLED" -> "This trip was cancelled. Its planned road is shown."
        trip.plannedRoute.size < 2 -> "The road for this trip has not been planned yet. Pickup and drop are marked."
        trip.reachedDrop -> "The vehicle has reached your drop along this road."
        trip.underway && trip.currentLocation == null -> "The vehicle has not reported its position yet."
        trip.underway -> listOfNotNull("Shaded as far as the vehicle has come.", reported).joinToString(" ")
        trip.currentLocation != null -> listOfNotNull("The vehicle has not set off yet and is shown where it last reported.", reported).joinToString(" ")
        else -> "The vehicle has not set off yet."
    }
}

/** How far, how much is left, how long and how late. */
private fun journeyFacts(order: OrdersApi.Order, trip: TripsApi.Trip?): List<Fact> = buildList {
    (trip?.plannedDistanceKm ?: order.distanceKm)?.let { add(Fact("Distance", km(it)!!)) }
    if (trip?.underway == true) trip.remainingKm?.let { add(Fact("To go", km(it)!!)) }
    when {
        trip?.actualDurationMin != null -> add(Fact("On the road", minutesSpan(trip.actualDurationMin)!!))
        trip?.plannedDurationMin != null -> add(Fact("Run time", minutesSpan(trip.plannedDurationMin)!!, "planned"))
    }
    if (trip != null && trip.late && !trip.closed) add(Fact("Running late", minutesSpan(trip.delayMinutes)!!))
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

    TripSection("Vehicle and driver", modifier) {
        truck?.let { VehicleLine(it) }
        // The customer is never given the driver's phone: no call here.
        driver?.let { DriverLine(it, trip?.driver?.overallScore) }
        order.fleetName?.let { Text("Run by $it", style = SType.small, color = c.muted) }
    }
}

/** What was ordered, what it needs, what it costs and what has been paid. */
@Composable
fun OrderDetailsCard(order: OrdersApi.Order, finance: OrdersApi.Finance?, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val needs = listOfNotNull(
        order.requiredTruckType?.takeIf { it.isNotBlank() && it != "OTHER" }?.let(::wordOf),
        order.requiredCapacityTons?.takeIf { it > 0 }?.let { "${if (it % 1.0 == 0.0) it.toInt() else it} t" },
    ).joinToString(" · ").ifBlank { null }
    val paid = finance?.payments?.filter { it.status == "SUCCEEDED" }?.sumOf { it.amount }?.takeIf { it > 0 }

    TripSection("Order details", modifier) {
        Facts(
            listOfNotNull(
                Fact("Load", order.what),
                needs?.let { Fact("Vehicle needed", it) },
                order.reference.ifBlank { null }?.let { Fact("Reference", it) },
                dayOf(order.createdAt)?.let { Fact("Placed", it) },
            ),
        )
        val lines = listOfNotNull(
            order.materialPrice?.let { "Material" to it },
            order.transportPrice?.let { "Transport" to it },
            (finance?.finalAmount ?: finance?.agreedAmount ?: order.totalPrice)?.let { "Total" to it },
            paid?.let { "Paid so far" to it },
            finance?.balanceDue?.takeIf { it > 0 }?.let { "Balance due" to it },
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
                Text("Your note", style = SType.captionStrong, color = c.muted)
                Text(notes, style = SType.body, color = c.fg)
            }
        }
    }
}
