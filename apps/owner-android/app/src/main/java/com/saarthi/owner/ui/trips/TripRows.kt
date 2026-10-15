package com.saarthi.owner.ui.trips

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.km
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.orders.StatusLook

/** A trip's status as a word and its colours. */
@Composable
fun tripStatusLook(status: String): StatusLook {
    val c = Saarthi.colors
    return when (status) {
        "DRAFT" -> StatusLook("Draft", c.sunken, c.muted)
        "ASSIGNED" -> StatusLook("Assigned", c.primaryWash, c.primary)
        "LOADING" -> StatusLook("Loading", c.warningBg, c.warning)
        "STARTED", "IN_TRANSIT" -> StatusLook("On the way", c.successBg, c.success)
        "DELAYED" -> StatusLook("Delayed", c.warningBg, c.warning)
        "SUSPENDED" -> StatusLook("Paused", c.warningBg, c.warning)
        "EMERGENCY" -> StatusLook("Emergency", c.dangerBg, c.danger)
        "ARRIVED" -> StatusLook("Arrived", c.successBg, c.success)
        "UNLOADING" -> StatusLook("Unloading", c.warningBg, c.warning)
        "COMPLETED" -> StatusLook("Completed", c.sunken, c.muted)
        "CANCELLED" -> StatusLook("Cancelled", c.dangerBg, c.danger)
        else -> StatusLook(status.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }, c.sunken, c.muted)
    }
}

/** The first part of an address, for a line with no room for the rest. */
internal fun placeOf(address: String?): String? = address?.substringBefore(',')?.trim()?.ifBlank { null }

/** "Kalyan → Pune", or whichever end is known. */
internal fun TripsApi.Trip.betweenPlaces(): String =
    listOfNotNull(placeOf(originAddress), placeOf(destinationAddress)).distinct().joinToString(" → ").ifBlank { reference }

/** One trip in a vehicle's list: where between, when, how far, how it ended. */
@Composable
fun TripRow(trip: TripsApi.Trip, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val look = tripStatusLook(trip.status)
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .pressable(scale = 0.98f, label = "Open trip ${trip.reference}", onClick = onOpen)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(if (trip.adHoc) Lucide.wrench else Lucide.route, well = c.primarySoft, ink = c.primary, size = 40.dp, radius = 12.dp, iconSize = 18.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(trip.betweenPlaces(), style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(
                    trip.reference.ifBlank { null },
                    clockOf(trip.actualStartAt ?: trip.plannedStartAt ?: trip.createdAt),
                    km(trip.actualDistanceKm?.takeIf { it > 0 } ?: trip.plannedDistanceKm),
                ).joinToString(" · "),
                style = SType.caption,
                color = c.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            StatusPill(look.word, background = look.ground, ink = look.ink, dot = false, modifier = Modifier.padding(top = 2.dp))
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}

/** The way from a vehicle to every trip it has run. */
@Composable
fun VehicleTripsCard(onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .pressable(scale = 0.99f, label = "Open trips", onClick = onOpen)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(Lucide.route, well = c.primarySoft, ink = c.primary, size = 40.dp, radius = 12.dp, iconSize = 18.dp)
        Column(Modifier.weight(1f)) {
            Eyebrow("Trips")
            Text("Every trip, with its path on the map", style = SType.rowTitle, color = c.fg)
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}
