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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.formatPlate
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
    val word = tripStatusWord(status)
    return when (status) {
        "ASSIGNED" -> StatusLook(word, c.primaryWash, c.primary)
        "LOADING", "DELAYED", "SUSPENDED", "UNLOADING" -> StatusLook(word, c.warningBg, c.warning)
        "STARTED", "IN_TRANSIT", "ARRIVED" -> StatusLook(word, c.successBg, c.success)
        "EMERGENCY", "CANCELLED" -> StatusLook(word, c.dangerBg, c.danger)
        else -> StatusLook(word, c.sunken, c.muted)
    }
}

/** A trip's status in a word, for places that are not drawing a pill. */
fun tripStatusWord(status: String): String = when (status) {
    "DRAFT" -> Words.get(R.string.net_trips_status_draft)
    "ASSIGNED" -> Words.get(R.string.net_trips_status_assigned)
    "LOADING" -> Words.get(R.string.net_trips_status_loading)
    "STARTED", "IN_TRANSIT" -> Words.get(R.string.net_trips_status_on_the_way)
    "DELAYED" -> Words.get(R.string.net_trips_status_delayed)
    "SUSPENDED" -> Words.get(R.string.net_trips_status_paused)
    "EMERGENCY" -> Words.get(R.string.net_trips_status_emergency)
    "ARRIVED" -> Words.get(R.string.net_trips_status_arrived)
    "UNLOADING" -> Words.get(R.string.net_trips_status_unloading)
    "COMPLETED" -> Words.get(R.string.net_trips_status_completed)
    "CANCELLED" -> Words.get(R.string.net_trips_status_cancelled)
    else -> status.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
}

/** The first part of an address, for a line with no room for the rest. */
internal fun placeOf(address: String?): String? = address?.substringBefore(',')?.trim()?.ifBlank { null }

/** "Kalyan → Pune", or whichever end is known. */
internal fun TripsApi.Trip.betweenPlaces(): String =
    listOfNotNull(placeOf(originAddress), placeOf(destinationAddress)).distinct().joinToString(" → ").ifBlank { reference }

/**
 * One trip in a list: where between, when, how far, how it ended — and, in the
 * fleet's list where trips of every vehicle sit together, which vehicle and who drove.
 */
@Composable
fun TripRow(trip: TripsApi.Trip, onOpen: () -> Unit, modifier: Modifier = Modifier, showVehicle: Boolean = false) {
    val c = Saarthi.colors
    val look = tripStatusLook(trip.status)
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .pressable(scale = 0.98f, label = stringResource(R.string.net_trips_open_trip, trip.reference), onClick = onOpen)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(if (trip.adHoc) Lucide.wrench else Lucide.route, well = c.primarySoft, ink = c.primary, size = 40.dp, radius = 12.dp, iconSize = 18.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(trip.betweenPlaces(), style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (showVehicle) {
                listOfNotNull(trip.truck?.registrationNumber?.ifBlank { null }?.let(::formatPlate), trip.driver?.name?.ifBlank { null })
                    .joinToString(" · ")
                    .takeIf { it.isNotEmpty() }
                    ?.let { Text(it, style = SType.smallStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
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
            .pressable(scale = 0.99f, label = stringResource(R.string.net_trips_open_trips), onClick = onOpen)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(Lucide.route, well = c.primarySoft, ink = c.primary, size = 40.dp, radius = 12.dp, iconSize = 18.dp)
        Column(Modifier.weight(1f)) {
            Eyebrow(stringResource(R.string.net_trips_trips))
            Text(stringResource(R.string.net_trips_every_trip_path), style = SType.rowTitle, color = c.fg)
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}
