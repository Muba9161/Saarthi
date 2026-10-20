package com.saarthi.owner.ui.trips

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.R
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.dial
import com.saarthi.owner.ui.common.km
import com.saarthi.owner.ui.common.minutesSpan
import com.saarthi.owner.ui.common.rememberPhoto
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.common.vehiclePhotoOf
import com.saarthi.owner.ui.design.Avatar
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiCard

/**
 * The cards a trip is told in, below its map: the figures, the money, how it
 * was driven, who was on it, its stops and its own record. Shared by the
 * owner's trip screen and, for the parts a customer may read, the order.
 */

/** A label and its value, one cell of a [Facts] grid. */
data class Fact(val label: String, val value: String, val note: String? = null)

/** Figures two to a row, each a label over its value. */
@Composable
fun Facts(facts: List<Fact>, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        facts.chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                pair.forEach { fact ->
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Eyebrow(fact.label, maxLines = 1)
                        Text(fact.value, style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        fact.note?.let { Text(it, style = SType.caption, color = c.muted, maxLines = 2) }
                    }
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

/** A titled card holding one part of the trip's story. */
@Composable
fun TripSection(title: String, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    SaarthiCard(modifier = modifier.fillMaxWidth(), radius = 22.dp, spacing = 14.dp) {
        Text(title, style = SType.cardTitle, color = Saarthi.colors.fg)
        content()
    }
}

/** "TIPPER" as "Tipper", "STOP_REACHED" as "Stop reached". */
fun wordOf(value: String): String = value.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }

/** How far, how long, when it left and when it got there. */
fun tripFacts(trip: TripsApi.Trip): List<Fact> = buildList {
    val driven = trip.actualDistanceKm?.takeIf { it > 0 }
    when {
        driven != null -> add(
            Fact(Words.get(R.string.net_trips_fact_driven), km(driven)!!, km(trip.plannedDistanceKm)?.let { Words.get(R.string.net_trips_of_planned, it) }),
        )
        trip.plannedDistanceKm != null -> add(Fact(Words.get(R.string.net_trips_fact_distance), km(trip.plannedDistanceKm)!!, Words.get(R.string.net_trips_planned)))
    }
    when {
        trip.actualDurationMin != null -> add(
            Fact(
                Words.get(R.string.net_trips_fact_on_road),
                minutesSpan(trip.actualDurationMin)!!,
                minutesSpan(trip.plannedDurationMin)?.let { Words.get(R.string.net_trips_span_planned, it) },
            ),
        )
        trip.plannedDurationMin != null -> add(Fact(Words.get(R.string.net_trips_fact_run_time), minutesSpan(trip.plannedDurationMin)!!, Words.get(R.string.net_trips_planned)))
    }
    clockOf(trip.actualStartAt)?.let { add(Fact(Words.get(R.string.net_trips_fact_started), it)) }
        ?: clockOf(trip.plannedStartAt)?.let { add(Fact(Words.get(R.string.net_trips_fact_starts), it, Words.get(R.string.net_trips_planned))) }
    when {
        trip.actualArrivalAt != null -> add(Fact(Words.get(R.string.net_trips_fact_arrived), clockOf(trip.actualArrivalAt)!!))
        trip.underway && trip.etaAt != null -> add(Fact(Words.get(R.string.net_trips_fact_arriving), clockOf(trip.etaAt)!!, Words.get(R.string.net_trips_estimated)))
        trip.plannedArrivalAt != null -> add(Fact(Words.get(R.string.net_trips_fact_arrival), clockOf(trip.plannedArrivalAt)!!, Words.get(R.string.net_trips_planned)))
    }
    if (trip.late && !trip.closed) add(Fact(Words.get(R.string.net_trips_fact_running_late), minutesSpan(trip.delayMinutes)!!))
    if (trip.underway) {
        add(
            Fact(
                Words.get(R.string.net_trips_fact_progress),
                Words.get(R.string.net_trips_percent, trip.progressPercent.coerceIn(0, 100)),
                Words.get(R.string.net_trips_of_planned_distance),
            ),
        )
    }
}

/** What the trip earned against what it cost beyond fuel. */
@Composable
fun TripMoneyCard(trip: TripsApi.Trip, modifier: Modifier = Modifier) {
    val price = trip.price
    val expenses = trip.expenses
    TripSection(stringResource(R.string.net_trips_money), modifier) {
        Facts(
            listOfNotNull(
                Fact(stringResource(R.string.net_trips_trip_value), price?.let(::rupees) ?: stringResource(R.string.net_trips_not_set)),
                // Null is "not logged", never "nothing spent".
                Fact(
                    stringResource(R.string.net_trips_expenses),
                    expenses?.let(::rupees) ?: stringResource(R.string.net_trips_none_recorded),
                    stringResource(R.string.net_trips_beyond_fuel),
                ),
                if (price != null && expenses != null) Fact(stringResource(R.string.net_trips_net), rupees(price - expenses)) else null,
            ),
        )
    }
}

/** How the vehicle was driven, written when the trip closed. Null-safe: shown only when there is something. */
@Composable
fun TripDrivingCard(trip: TripsApi.Trip, modifier: Modifier = Modifier) {
    val odometer = trip.endOdometerKm ?: trip.startOdometerKm
    val facts = listOfNotNull(
        trip.topSpeedKph?.let { Fact(stringResource(R.string.net_trips_top_speed), stringResource(R.string.net_trips_speed_kmh, it.toInt())) },
        trip.averageSpeedKph?.let {
            Fact(stringResource(R.string.net_trips_average_speed), stringResource(R.string.net_trips_speed_kmh, it.toInt()), stringResource(R.string.net_trips_while_moving))
        },
        Fact(stringResource(R.string.net_trips_harsh_braking), trip.harshBrakingCount.toString()),
        Fact(stringResource(R.string.net_trips_harsh_starts), trip.harshAccelerationCount.toString()),
        odometer?.let {
            val run = trip.startOdometerKm?.let { start -> trip.endOdometerKm?.let { end -> (end - start).coerceAtLeast(0.0) } }
            Fact(stringResource(R.string.net_trips_odometer), km(it)!!, run?.let { added -> stringResource(R.string.net_trips_odometer_added, km(added).orEmpty()) })
        },
    )
    TripSection(stringResource(R.string.net_trips_driving), modifier) { Facts(facts) }
}

/** Whether a trip has any driving record worth a card. */
val TripsApi.Trip.hasDrivingRecord: Boolean
    get() = topSpeedKph != null || averageSpeedKph != null || harshBrakingCount > 0 || harshAccelerationCount > 0

/** The vehicle, its driver and the order it carried. */
@Composable
fun TripCrewCard(trip: TripsApi.Trip, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val context = LocalContext.current
    TripSection(stringResource(R.string.net_trips_on_this_trip), modifier) {
        trip.truck?.let { truck -> VehicleLine(truck) }
        trip.driver?.takeIf { it.name.isNotBlank() }?.let { driver ->
            DriverLine(driver.name, driver.overallScore, onCall = driver.phone?.let { phone -> { context.dial(phone) } })
        }
        trip.order?.let { order ->
            Column {
                Eyebrow(stringResource(R.string.net_trips_order))
                Text(
                    listOfNotNull(order.reference.ifBlank { null }, order.materialName.ifBlank { null }).joinToString(" · "),
                    style = SType.rowTitle,
                    color = c.fg,
                )
                order.customerName.ifBlank { null }?.let { Text(it, style = SType.caption, color = c.muted) }
            }
        }
    }
}

/** The driver as a row: initials, name, score, and a call where the viewer may make one. */
@Composable
fun DriverLine(name: String, score: Int?, modifier: Modifier = Modifier, onCall: (() -> Unit)? = null) {
    val c = Saarthi.colors
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Avatar(name, size = 40.dp, background = c.primarySoft, ink = c.primary)
        Column(Modifier.weight(1f)) {
            Eyebrow(stringResource(R.string.net_trips_driver))
            Text(name, style = SType.rowTitle, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            score?.let { Text(stringResource(R.string.net_trips_score, it), style = SType.caption, color = c.muted) }
        }
        onCall?.let { CircleButton(Lucide.phone, stringResource(R.string.net_trips_call, name), it, size = 44.dp) }
    }
}

/** A vehicle as a row: its photograph where there is one, its plate and its kind. */
@Composable
fun VehicleLine(truck: TripsApi.TripTruck, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        val photo = vehiclePhotoOf(truck.truckType.orEmpty())?.let { rememberPhoto(it) }
        if (photo != null) {
            Image(photo, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.size(width = 70.dp, height = 40.dp))
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            PlateChip(truck.registrationNumber, size = 12.sp)
            listOfNotNull(
                truck.truckType?.takeIf { it.isNotBlank() && it != "OTHER" }?.let(::truckWord),
                truck.capacityTons?.takeIf { it > 0 }?.let { stringResource(R.string.net_trips_capacity_tons, (if (it % 1.0 == 0.0) it.toInt() else it).toString()) },
            ).takeIf { it.isNotEmpty() }?.let { Text(it.joinToString(" · "), style = SType.caption, color = c.muted) }
        }
    }
}

/** The planned stops in order, with when the vehicle reached each. */
@Composable
fun TripStopsCard(stops: List<TripsApi.Stop>, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    TripSection(stringResource(R.string.net_trips_stops), modifier) {
        stops.sortedBy { it.sequence }.forEach { stop ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(
                    Modifier
                        .padding(top = 5.dp)
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(if (stop.actualArrival != null || stop.reachedAt != null) c.success else c.track),
                )
                Column(Modifier.weight(1f)) {
                    Text(stop.name.ifBlank { stop.address ?: stopWord(stop.type) }, style = SType.bodyStrong, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(
                        listOfNotNull(
                            stopWord(stop.type),
                            clockOf(stop.actualArrival)?.let { stringResource(R.string.net_trips_stop_arrived, it) }
                                ?: clockOf(stop.reachedAt)?.let { stringResource(R.string.net_trips_stop_reached_gps, it) }
                                ?: clockOf(stop.plannedArrival)?.let { stringResource(R.string.net_trips_stop_planned, it) },
                            clockOf(stop.leftAt)?.let { stringResource(R.string.net_trips_stop_left, it) },
                        ).joinToString(" · "),
                        style = SType.caption,
                        color = c.muted,
                    )
                }
            }
        }
    }
}

/** The trip's own record, newest first, capped so a long journey stays readable. */
@Composable
fun TripEventsCard(events: List<TripsApi.Event>, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val shown = events.asReversed().take(EVENTS_SHOWN)
    TripSection(stringResource(R.string.net_trips_timeline), modifier) {
        shown.forEach { event ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(
                    Modifier
                        .padding(top = 6.dp)
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(c.primary),
                )
                Column(Modifier.weight(1f)) {
                    Text(event.description?.ifBlank { null } ?: eventWord(event.type), style = SType.body, color = c.fg)
                    Text(listOfNotNull(eventWord(event.type), clockOf(event.createdAt)).joinToString(" · "), style = SType.caption, color = c.muted)
                }
            }
        }
        if (events.size > shown.size) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
            Text(stringResource(R.string.net_trips_events_capped, shown.size, events.size), style = SType.caption, color = c.subtle)
        }
    }
}

private const val EVENTS_SHOWN = 40

/** A vehicle kind in words; a kind the app has no word for reads as its code. */
private fun truckWord(type: String): String = when (type) {
    "OPEN_BODY" -> Words.get(R.string.net_trips_truck_open_body)
    "CLOSED_CONTAINER" -> Words.get(R.string.net_trips_truck_closed_container)
    "TIPPER" -> Words.get(R.string.net_trips_truck_tipper)
    "TRAILER" -> Words.get(R.string.net_trips_truck_trailer)
    "TANKER" -> Words.get(R.string.net_trips_truck_tanker)
    "FLATBED" -> Words.get(R.string.net_trips_truck_flatbed)
    "REFRIGERATED" -> Words.get(R.string.net_trips_truck_refrigerated)
    "MINI_TRUCK" -> Words.get(R.string.net_trips_truck_mini_truck)
    "MULTI_AXLE" -> Words.get(R.string.net_trips_truck_multi_axle)
    else -> wordOf(type)
}

/** A planned stop's kind in words. */
private fun stopWord(type: String): String = when (type) {
    "ORIGIN" -> Words.get(R.string.net_trips_stop_type_origin)
    "DESTINATION" -> Words.get(R.string.net_trips_stop_type_destination)
    "WAYPOINT" -> Words.get(R.string.net_trips_stop_type_waypoint)
    "REST" -> Words.get(R.string.net_trips_stop_type_rest)
    "FUEL" -> Words.get(R.string.net_trips_stop_type_fuel)
    "CHECKPOINT" -> Words.get(R.string.net_trips_stop_type_checkpoint)
    else -> wordOf(type)
}

/** A line of the trip's record in words, by the server's `TripEventType`. */
private fun eventWord(type: String): String = when (type) {
    "CREATED" -> Words.get(R.string.net_trips_event_created)
    "ASSIGNED" -> Words.get(R.string.net_trips_event_assigned)
    "STATUS_CHANGED" -> Words.get(R.string.net_trips_event_status_changed)
    "LOADING_STARTED" -> Words.get(R.string.net_trips_event_loading_started)
    "DEPARTED" -> Words.get(R.string.net_trips_event_departed)
    "LOCATION_UPDATE" -> Words.get(R.string.net_trips_event_location_update)
    "STOP_STARTED" -> Words.get(R.string.net_trips_event_stop_started)
    "STOP_ENDED" -> Words.get(R.string.net_trips_event_stop_ended)
    "ROUTE_DEVIATION" -> Words.get(R.string.net_trips_event_route_deviation)
    "SPEED_VIOLATION" -> Words.get(R.string.net_trips_event_speed_violation)
    "HARSH_BRAKING" -> Words.get(R.string.net_trips_event_harsh_braking)
    "HARSH_ACCELERATION" -> Words.get(R.string.net_trips_event_harsh_acceleration)
    "DELAY_DETECTED" -> Words.get(R.string.net_trips_event_delay_detected)
    "ARRIVED" -> Words.get(R.string.net_trips_event_arrived)
    "UNLOADING_STARTED" -> Words.get(R.string.net_trips_event_unloading_started)
    "COMPLETED" -> Words.get(R.string.net_trips_event_completed)
    "CANCELLED" -> Words.get(R.string.net_trips_event_cancelled)
    "EMERGENCY" -> Words.get(R.string.net_trips_event_emergency)
    "NOTE" -> Words.get(R.string.net_trips_event_note)
    "NAVIGATION_HANDOFF" -> Words.get(R.string.net_trips_event_navigation_handoff)
    "ALTERNATE_ROUTE" -> Words.get(R.string.net_trips_event_alternate_route)
    "STOP_REACHED" -> Words.get(R.string.net_trips_event_stop_reached)
    "STOP_LEFT" -> Words.get(R.string.net_trips_event_stop_left)
    else -> wordOf(type)
}
