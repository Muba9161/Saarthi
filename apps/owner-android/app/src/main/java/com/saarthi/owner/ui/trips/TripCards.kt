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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.ui.common.PlateChip
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
        driven != null -> add(Fact("Driven", km(driven)!!, km(trip.plannedDistanceKm)?.let { "of $it planned" }))
        trip.plannedDistanceKm != null -> add(Fact("Distance", km(trip.plannedDistanceKm)!!, "planned"))
    }
    when {
        trip.actualDurationMin != null -> add(Fact("On the road", minutesSpan(trip.actualDurationMin)!!, minutesSpan(trip.plannedDurationMin)?.let { "$it planned" }))
        trip.plannedDurationMin != null -> add(Fact("Run time", minutesSpan(trip.plannedDurationMin)!!, "planned"))
    }
    clockOf(trip.actualStartAt)?.let { add(Fact("Started", it)) }
        ?: clockOf(trip.plannedStartAt)?.let { add(Fact("Starts", it, "planned")) }
    when {
        trip.actualArrivalAt != null -> add(Fact("Arrived", clockOf(trip.actualArrivalAt)!!))
        trip.underway && trip.etaAt != null -> add(Fact("Arriving", clockOf(trip.etaAt)!!, "estimated"))
        trip.plannedArrivalAt != null -> add(Fact("Arrival", clockOf(trip.plannedArrivalAt)!!, "planned"))
    }
    if (trip.late && !trip.closed) add(Fact("Running late", minutesSpan(trip.delayMinutes)!!))
    if (trip.underway) add(Fact("Progress", "${trip.progressPercent.coerceIn(0, 100)}%", "of the planned distance"))
}

/** What the trip earned against what it cost beyond fuel. */
@Composable
fun TripMoneyCard(trip: TripsApi.Trip, modifier: Modifier = Modifier) {
    val price = trip.price
    val expenses = trip.expenses
    TripSection("Money", modifier) {
        Facts(
            listOfNotNull(
                Fact("Trip value", price?.let(::rupees) ?: "Not set"),
                // Null is "not logged", never "nothing spent".
                Fact("Expenses", expenses?.let(::rupees) ?: "None recorded", "beyond fuel"),
                if (price != null && expenses != null) Fact("Net", rupees(price - expenses)) else null,
            ),
        )
    }
}

/** How the vehicle was driven, written when the trip closed. Null-safe: shown only when there is something. */
@Composable
fun TripDrivingCard(trip: TripsApi.Trip, modifier: Modifier = Modifier) {
    val odometer = trip.endOdometerKm ?: trip.startOdometerKm
    val facts = listOfNotNull(
        trip.topSpeedKph?.let { Fact("Top speed", "${it.toInt()} km/h") },
        trip.averageSpeedKph?.let { Fact("Average speed", "${it.toInt()} km/h", "while moving") },
        Fact("Harsh braking", trip.harshBrakingCount.toString()),
        Fact("Harsh starts", trip.harshAccelerationCount.toString()),
        odometer?.let {
            val run = trip.startOdometerKm?.let { start -> trip.endOdometerKm?.let { end -> (end - start).coerceAtLeast(0.0) } }
            Fact("Odometer", km(it)!!, run?.let { added -> "+${km(added)} this trip" })
        },
    )
    TripSection("Driving", modifier) { Facts(facts) }
}

/** Whether a trip has any driving record worth a card. */
val TripsApi.Trip.hasDrivingRecord: Boolean
    get() = topSpeedKph != null || averageSpeedKph != null || harshBrakingCount > 0 || harshAccelerationCount > 0

/** The vehicle, its driver and the order it carried. */
@Composable
fun TripCrewCard(trip: TripsApi.Trip, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val context = LocalContext.current
    TripSection("On this trip", modifier) {
        trip.truck?.let { truck -> VehicleLine(truck) }
        trip.driver?.takeIf { it.name.isNotBlank() }?.let { driver ->
            DriverLine(driver.name, driver.overallScore, onCall = driver.phone?.let { phone -> { context.dial(phone) } })
        }
        trip.order?.let { order ->
            Column {
                Eyebrow("Order")
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
            Eyebrow("Driver")
            Text(name, style = SType.rowTitle, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            score?.let { Text("Score $it of 100", style = SType.caption, color = c.muted) }
        }
        onCall?.let { CircleButton(Lucide.phone, "Call $name", it, size = 44.dp) }
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
                truck.truckType?.takeIf { it.isNotBlank() && it != "OTHER" }?.let(::wordOf),
                truck.capacityTons?.takeIf { it > 0 }?.let { "${if (it % 1.0 == 0.0) it.toInt() else it} t" },
            ).takeIf { it.isNotEmpty() }?.let { Text(it.joinToString(" · "), style = SType.caption, color = c.muted) }
        }
    }
}

/** The planned stops in order, with when the vehicle reached each. */
@Composable
fun TripStopsCard(stops: List<TripsApi.Stop>, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    TripSection("Stops", modifier) {
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
                    Text(stop.name.ifBlank { stop.address ?: wordOf(stop.type) }, style = SType.bodyStrong, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(
                        listOfNotNull(
                            wordOf(stop.type),
                            clockOf(stop.actualArrival)?.let { "arrived $it" }
                                ?: clockOf(stop.reachedAt)?.let { "reached by GPS $it" }
                                ?: clockOf(stop.plannedArrival)?.let { "planned $it" },
                            clockOf(stop.leftAt)?.let { "left $it" },
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
    TripSection("Timeline", modifier) {
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
                    Text(event.description?.ifBlank { null } ?: wordOf(event.type), style = SType.body, color = c.fg)
                    Text(listOfNotNull(wordOf(event.type), clockOf(event.createdAt)).joinToString(" · "), style = SType.caption, color = c.muted)
                }
            }
        }
        if (events.size > shown.size) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
            Text("Showing the latest ${shown.size} of ${events.size} events.", style = SType.caption, color = c.subtle)
        }
    }
}

private const val EVENTS_SHOWN = 40
