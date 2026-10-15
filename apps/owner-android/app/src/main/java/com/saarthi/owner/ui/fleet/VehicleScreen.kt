package com.saarthi.owner.ui.fleet

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.ago
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.dial
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.km
import com.saarthi.owner.ui.common.plural
import com.saarthi.owner.ui.common.shortCount
import com.saarthi.owner.ui.common.rememberPhoto
import com.saarthi.owner.ui.common.vehiclePhotoOf
import com.saarthi.owner.ui.design.Brand
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SaarthiCard
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.brandGradient
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.papers.PapersStanding
import com.saarthi.owner.ui.papers.VehiclePapersScreen
import com.saarthi.owner.ui.papers.standing
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.trips.VehicleTripsCard
import com.saarthi.owner.ui.trips.VehicleTripsScreen
import kotlinx.coroutines.delay

private const val REFRESH_MS = 15_000L

/**
 * One vehicle — the design's Fleet · Vehicle: where it is, how fast, the trip
 * it is on, who is driving, and the way to follow it on the map.
 */
@Composable
fun VehicleScreen(app: OwnerApp, account: SessionStore.Account, initial: VehiclesApi.Vehicle) {
    var vehicle by remember { mutableStateOf(initial) }
    var trip by remember { mutableStateOf<TripsApi.Trip?>(null) }
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val c = Saarthi.colors

    // The papers' standing, from the wallet so register dates count as much as
    // scans. Null until read; the card falls back to the upload counts until then.
    var papers by remember { mutableStateOf<PapersStanding?>(null) }

    LaunchedEffect(initial.id) {
        while (true) {
            runCatching { app.vehicles.get(initial.id) }.getOrNull()?.let { vehicle = it }
            trip = vehicle.currentTripId?.let { id -> runCatching { app.trips.get(id) }.getOrNull() }
            delay(REFRESH_MS)
        }
    }
    LaunchedEffect(initial.id) {
        papers = runCatching { app.papers.wallet(initial.id).standing() }.getOrNull()
    }

    val phone = trip?.driver?.phone
    val driverName = vehicle.currentDriver?.name?.ifBlank { null } ?: trip?.driver?.name?.ifBlank { null }
    val openMap = {
        navigator.push("vehicle-map-${vehicle.id}") { VehicleLiveScreen(app, vehicle, trip) }
    }

    DetailScreen(
        eyebrow = listOfNotNull(
            vehicle.categoryLabel?.ifBlank { null } ?: vehicle.typeLabel.ifBlank { null },
            vehicle.capacityTons?.let { "${it.toInt()} t" },
            driverName,
        ).joinToString(" · "),
        title = "Vehicle",
        footer = {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                if (phone != null) {
                    CircleButton(Lucide.phone, "Call $driverName", { context.dial(phone) }, size = 56.dp, iconSize = 20.dp)
                }
                SaarthiButton("Follow on map", onClick = openMap, leading = Lucide.map, modifier = Modifier.weight(1f))
            }
        },
    ) {
        TrackingPanel(vehicle, onLiveView = openMap, modifier = Modifier.rise())

        Row(Modifier.fillMaxWidth().rise(stagger(1)), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            val moving = vehicle.motion() == VehiclesApi.Motion.MOVING
            Figure("Speed", if (moving) "${(vehicle.lastLocation?.speedKph ?: 0.0).toInt()}" else "0", "km/h", Modifier.weight(1f))
            val seen = vehicle.lastLocation?.recordedAt?.let { ago(it) }
            Figure("Seen", seen ?: "—", if (seen == null || seen == "now") "" else "ago", Modifier.weight(1f))
            Figure("Odometer", vehicle.odometerKm?.let(::shortCount) ?: "—", "km", Modifier.weight(1f))
        }

        trip?.let { TripCard(it, Modifier.rise(stagger(2))) }

        VehicleTripsCard(
            onOpen = { navigator.push("vehicle-trips-${vehicle.id}") { VehicleTripsScreen(app, vehicle) } },
            modifier = Modifier.rise(stagger(3)),
        )

        PapersCard(
            vehicle.documentHealth,
            papers,
            onOpen = { navigator.push("vehicle-papers-${vehicle.id}") { VehiclePapersScreen(app, vehicle) } },
            modifier = Modifier.rise(stagger(3)),
        )

        if (driverName != null) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .rise(stagger(4))
                    .card(radius = 22.dp)
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                com.saarthi.owner.ui.design.Avatar(driverName, size = 44.dp, background = c.primarySoft, ink = c.primary)
                Column(Modifier.weight(1f)) {
                    Eyebrow("Driving")
                    Text(driverName, style = SType.rowTitle, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

/** The brand panel: the plate as the headline, what it is doing, and the way to the map. */
@Composable
private fun TrackingPanel(vehicle: VehiclesApi.Vehicle, onLiveView: () -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(28.dp)
    val photo = vehiclePhotoOf(vehicle.artType)
    val (word, dot) = when (vehicle.motion()) {
        VehiclesApi.Motion.MOVING -> (if (vehicle.currentTripId != null) "In transit" else "Moving") to Brand.live
        VehiclesApi.Motion.IDLE -> "Stopped" to Color(0xFFF2952C)
        VehiclesApi.Motion.OFFLINE -> "Not reporting" to Color(0xFF9F9FA8)
        VehiclesApi.Motion.SERVICE -> "In service" to Color(0xFFF2952C)
    }
    Box(
        modifier
            .fillMaxWidth()
            .height(214.dp)
            .shadow(20.dp, shape, spotColor = Color(0xBF021D40), ambientColor = Color.Transparent)
            .brandGradient(shape),
    ) {
        val bitmap = photo?.let { rememberPhoto(it) }
        if (bitmap != null) {
            Image(
                bitmap,
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 4.dp, bottom = 6.dp)
                    .width(170.dp)
                    .height(90.dp),
            )
        }
        Column(Modifier.fillMaxSize().padding(22.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Eyebrow("Current tracking", Modifier.weight(1f), color = Color.White.copy(alpha = 0.72f))
                StatusPill(
                    word,
                    background = Color.White.copy(alpha = 0.14f),
                    ink = Color.White,
                    dotColor = dot,
                    live = vehicle.motion() == VehiclesApi.Motion.MOVING,
                    ring = Color.White.copy(alpha = 0.18f),
                )
            }
            Text(
                formatPlate(vehicle.registrationNumber),
                style = SType.plate(32.sp, 0.03.em),
                color = Color.White,
                maxLines = 1,
            )
            Row(
                Modifier
                    .height(44.dp)
                    .clip(CircleShape)
                    .background(Color.White)
                    .pressable(onClick = onLiveView)
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                LineIcon(Lucide.map, size = 18.dp, color = Brand.navy)
                Text("Live view", style = SType.bodyStrong, color = Brand.navy)
            }
        }
    }
}

@Composable
private fun Figure(label: String, value: String, unit: String, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(
        modifier
            .card(radius = 18.dp)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Eyebrow(label, maxLines = 1)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(value, style = SType.headerTitle.copy(fontSize = 18.sp), color = c.fg, maxLines = 1)
            if (unit.isNotEmpty()) Text(unit, style = SType.caption, color = c.muted, modifier = Modifier.padding(bottom = 2.dp))
        }
    }
}

/** The trip the vehicle is on: from, to, when, and how far along. */
@Composable
private fun TripCard(trip: TripsApi.Trip, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    SaarthiCard(modifier = modifier.fillMaxWidth(), padding = androidx.compose.foundation.layout.PaddingValues(18.dp), spacing = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Current trip", style = SType.cardTitle, color = c.fg, modifier = Modifier.weight(1f))
            StatusPill(
                if (trip.late) "${trip.delayMinutes} min late" else "On time",
                background = if (trip.late) c.warningBg else c.successBg,
                ink = if (trip.late) c.warning else c.success,
                dot = false,
            )
        }
        RouteStops(
            from = trip.originAddress,
            fromNote = clockOf(trip.actualStartAt)?.let { "Left $it" },
            to = trip.destinationAddress,
            toNote = trip.remainingKm?.let { "${km(it)} to go" },
            eta = clockOf(trip.etaAt ?: trip.plannedArrivalAt),
        )
        Box(
            Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(CircleShape)
                .background(c.track),
        ) {
            Box(
                Modifier
                    .fillMaxWidth(trip.progressPercent.coerceIn(0, 100) / 100f)
                    .height(6.dp)
                    .clip(CircleShape)
                    .background(c.primary),
            )
        }
    }
}

/** A from → to pair with the route markers the design draws beside them. */
@Composable
fun RouteStops(from: String, fromNote: String?, to: String, toNote: String?, eta: String? = null) {
    val c = Saarthi.colors
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.padding(top = 5.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier
                    .size(12.dp)
                    .clip(CircleShape)
                    .background(c.primary)
                    .padding(3.dp)
                    .clip(CircleShape)
                    .background(c.card),
            )
            Box(
                Modifier
                    .padding(vertical = 4.dp)
                    .width(2.dp)
                    .height(34.dp)
                    .background(c.border),
            )
            Box(
                Modifier
                    .size(12.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(c.accent),
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Column {
                Text(from.ifBlank { "Start" }, style = SType.rowTitle, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                fromNote?.let { Text(it, style = SType.caption, color = c.muted) }
            }
            Row(verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f)) {
                    Text(to.ifBlank { "Destination" }, style = SType.rowTitle, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    toNote?.let { Text(it, style = SType.caption, color = c.muted) }
                }
                // A clock reads large; once it carries a date ("31 Aug, 18:12") it
                // steps down and stays narrow, so the address keeps its width.
                eta?.let {
                    val withDate = it.length > 5
                    Text(
                        it,
                        style = if (withDate) SType.bodyStrong else SType.headerTitle.copy(fontSize = 22.sp),
                        color = c.fg,
                        textAlign = TextAlign.End,
                        modifier = Modifier.widthIn(max = 112.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun PapersCard(
    health: VehiclesApi.DocumentHealth,
    standing: PapersStanding?,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    val look = when {
        standing != null -> when {
            standing.expired > 0 -> PapersLook(Lucide.alertTriangle, c.dangerSoft, c.danger, "${plural(standing.expired, "paper")} expired or turned down")
            standing.attention > 0 -> PapersLook(Lucide.fileText, c.warningSoft, c.warning, "${plural(standing.attention, "paper")} due soon")
            standing.onFile > 0 -> PapersLook(Lucide.check, c.successSoft, c.success, "${plural(standing.onFile, "paper")} on file, all in order")
            else -> PapersLook(Lucide.fileText, c.sunken, c.muted, "No papers on file yet")
        }
        health.expired > 0 -> PapersLook(Lucide.alertTriangle, c.dangerSoft, c.danger, "${plural(health.expired, "paper")} expired")
        health.expiringSoon > 0 -> PapersLook(Lucide.fileText, c.warningSoft, c.warning, "${plural(health.expiringSoon, "paper")} due soon")
        health.total > 0 -> PapersLook(Lucide.check, c.successSoft, c.success, "All ${health.total} papers valid")
        else -> PapersLook(Lucide.fileText, c.sunken, c.muted, "No papers on file yet")
    }
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .pressable(scale = 0.99f, label = "Open papers", onClick = onOpen)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(look.icon, well = look.well, ink = look.ink, size = 40.dp, radius = 12.dp, iconSize = 18.dp)
        Column(Modifier.weight(1f)) {
            Eyebrow("Papers")
            Text(look.line, style = SType.rowTitle, color = c.fg)
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}

private data class PapersLook(val icon: String, val well: Color, val ink: Color, val line: String)
