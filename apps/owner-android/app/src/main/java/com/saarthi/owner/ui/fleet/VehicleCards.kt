package com.saarthi.owner.ui.fleet

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.R
import com.saarthi.owner.network.PreferencesApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.rememberPhoto
import com.saarthi.owner.ui.common.vehiclePhotoOf
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable

/*
 * The Vehicles list's second layout: one card per vehicle with its picture and
 * the figures the web's card view shows (seats or payload, odometer, driver,
 * papers). The choice between rows and cards is the person's, saved on the
 * server for the surface "fleet.vehicles" so it follows them from the web.
 */

/**
 * The layout, held for the session so switching tabs does not ask the server
 * again or flash the other layout. Null until the saved choice is read.
 */
internal object VehicleLayout {
    val mode = mutableStateOf<String?>(null)
}

/** Rows or cards, as two small icon buttons. */
@Composable
internal fun LayoutToggle(cards: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Row(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(c.segment)
            .padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        listOf(false to Lucide.list, true to Lucide.layoutGrid).forEach { (isCards, icon) ->
            val on = isCards == cards
            Box(
                Modifier
                    .size(34.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(if (on) c.segmentOn else c.segment)
                    .pressable(scale = 0.94f, label = stringResource(if (isCards) R.string.fleet_card_show_cards else R.string.fleet_card_show_list)) { onChange(isCards) },
                contentAlignment = Alignment.Center,
            ) {
                LineIcon(icon, size = 16.dp, color = if (on) c.fg else c.muted)
            }
        }
    }
}

/** One vehicle as a card: its picture, plate, where it stands, and the figures under it; [note] as under a row. */
@Composable
internal fun VehicleCard(vehicle: VehiclesApi.Vehicle, onOpen: () -> Unit, note: String? = null) {
    val c = Saarthi.colors
    val photo = vehiclePhotoOf(vehicle.artType)
    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 24.dp)
            .pressable(scale = 0.98f, label = stringResource(R.string.fleet_open_named, vehicle.registrationNumber), onClick = onOpen),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(132.dp)
                .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
                .background(c.sunken),
            contentAlignment = Alignment.Center,
        ) {
            val bitmap = photo?.let { rememberPhoto(it) }
            if (bitmap != null) {
                Image(bitmap, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.padding(horizontal = 32.dp, vertical = 14.dp))
            } else {
                LineIcon(Lucide.car, size = 36.dp, color = c.muted)
            }
            Box(Modifier.align(Alignment.TopEnd).padding(12.dp)) { MotionPill(vehicle) }
        }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PlateChip(vehicle.registrationNumber, size = 13.sp)
                Text(
                    listOfNotNull(vehicle.manufacturer, vehicle.model).joinToString(" ").ifBlank { vehicle.categoryLabel ?: vehicle.typeLabel },
                    style = SType.bodyStrong,
                    color = c.fg,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            }
            note?.let { Text(it, style = SType.small, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Fact(
                    stringResource(if (vehicle.passengerCapacity != null) R.string.fleet_card_seats else R.string.fleet_card_payload),
                    vehicle.passengerCapacity?.toString() ?: vehicle.capacityTons?.let { stringResource(R.string.fleet_tonnes, "%.0f".format(it)) } ?: "—",
                    Modifier.weight(1f),
                )
                Fact(stringResource(R.string.fleet_card_odometer), vehicle.odometerKm?.let { stringResource(R.string.fleet_card_km, "%,d".format(it.toLong())) } ?: "—", Modifier.weight(1f))
                Fact(stringResource(R.string.fleet_card_driver), vehicle.currentDriver?.name?.ifBlank { null } ?: stringResource(R.string.fleet_card_none), Modifier.weight(1.2f))
            }
            PapersHealth(vehicle.documentHealth)
        }
    }
}

@Composable
private fun Fact(label: String, value: String, modifier: Modifier) {
    val c = Saarthi.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Eyebrow(label, maxLines = 1)
        Text(value, style = SType.smallStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** The papers in one tag, as the web's document-health column says it. */
@Composable
private fun PapersHealth(health: VehiclesApi.DocumentHealth) {
    val c = Saarthi.colors
    val (text, ground, ink) = when {
        health.expired > 0 -> Triple(pluralStringResource(R.plurals.fleet_papers_expired, health.expired, health.expired), c.dangerBg, c.danger)
        health.expiringSoon > 0 -> Triple(pluralStringResource(R.plurals.fleet_card_papers_expiring, health.expiringSoon, health.expiringSoon), c.warningBg, c.warning)
        health.total > 0 -> Triple(stringResource(R.string.fleet_card_papers_valid), c.successBg, c.success)
        else -> Triple(stringResource(R.string.fleet_card_no_papers), c.sunken, c.muted)
    }
    StatusPill(text, background = ground, ink = ink, dot = false)
}

/** Whether a saved layout means cards; rows when nothing was chosen. */
internal fun String?.isCards(): Boolean = this == PreferencesApi.CARDS
