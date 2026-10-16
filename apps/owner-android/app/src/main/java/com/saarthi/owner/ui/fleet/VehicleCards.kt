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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.network.PreferencesApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.plural
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
                    .pressable(scale = 0.94f, label = if (isCards) "Show as cards" else "Show as a list") { onChange(isCards) },
                contentAlignment = Alignment.Center,
            ) {
                LineIcon(icon, size = 16.dp, color = if (on) c.fg else c.muted)
            }
        }
    }
}

/** One vehicle as a card: its picture, plate, where it stands, and the figures under it. */
@Composable
internal fun VehicleCard(vehicle: VehiclesApi.Vehicle, onOpen: () -> Unit) {
    val c = Saarthi.colors
    val photo = vehiclePhotoOf(vehicle.artType)
    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 24.dp)
            .pressable(scale = 0.98f, label = "Open ${vehicle.registrationNumber}", onClick = onOpen),
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
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Fact(
                    if (vehicle.passengerCapacity != null) "Seats" else "Payload",
                    vehicle.passengerCapacity?.toString() ?: vehicle.capacityTons?.let { "%.0f t".format(it) } ?: "—",
                    Modifier.weight(1f),
                )
                Fact("Odometer", vehicle.odometerKm?.let { "%,d km".format(it.toLong()) } ?: "—", Modifier.weight(1f))
                Fact("Driver", vehicle.currentDriver?.name?.ifBlank { null } ?: "None", Modifier.weight(1.2f))
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
        health.expired > 0 -> Triple("${plural(health.expired, "paper")} expired", c.dangerBg, c.danger)
        health.expiringSoon > 0 -> Triple("${plural(health.expiringSoon, "paper")} expiring", c.warningBg, c.warning)
        health.total > 0 -> Triple("Papers valid", c.successBg, c.success)
        else -> Triple("No papers uploaded", c.sunken, c.muted)
    }
    StatusPill(text, background = ground, ink = ink, dot = false)
}

/** Whether a saved layout means cards; rows when nothing was chosen. */
internal fun String?.isCards(): Boolean = this == PreferencesApi.CARDS
