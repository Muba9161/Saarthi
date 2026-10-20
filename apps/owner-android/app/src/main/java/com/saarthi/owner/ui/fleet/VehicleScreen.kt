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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.SharingApi
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.costs.CostAccess
import com.saarthi.owner.ui.costs.RunningCostsCard
import com.saarthi.owner.ui.costs.RunningCostsScreen
import com.saarthi.owner.ui.common.FigureRow
import com.saarthi.owner.ui.common.FigureTile
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.ago
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.dial
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.isNow
import com.saarthi.owner.ui.common.km
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.shortCount
import com.saarthi.owner.ui.common.rememberPhoto
import com.saarthi.owner.ui.common.vehiclePhotoOf
import com.saarthi.owner.ui.design.Brand
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
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
import com.saarthi.owner.ui.sharing.SharingScreen
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.trips.VehicleTripsCard
import com.saarthi.owner.ui.trips.NewTripScreen
import com.saarthi.owner.ui.trips.TripScreen
import com.saarthi.owner.ui.trips.VehicleTripsScreen
import com.saarthi.owner.ui.tracking.Readings
import com.saarthi.owner.ui.tracking.ReadingsCard
import com.saarthi.owner.ui.tracking.attempt
import com.saarthi.owner.ui.tracking.readings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
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
    val scope = rememberCoroutineScope()
    var reload by remember { mutableIntStateOf(0) }
    var assigning by remember { mutableStateOf(false) }
    var driverBusy by remember { mutableStateOf(false) }
    var driverNotice by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }

    // The papers' standing, from the wallet so register dates count as much as
    // scans. Null until read; the card falls back to the upload counts until then.
    var papers by remember { mutableStateOf<PapersStanding?>(null) }
    // What it measured last; none without a reading the plan shows.
    var readings by remember { mutableStateOf<Readings?>(null) }

    LaunchedEffect(initial.id, reload) {
        while (true) {
            runCatching { app.vehicles.get(initial.id) }.getOrNull()?.let { vehicle = it }
            trip = vehicle.currentTripId?.let { id -> runCatching { app.trips.get(id) }.getOrNull() }
            readings = attempt { app.vehicles.reading(initial.id) }?.readings()?.takeIf { it.any }
            delay(REFRESH_MS)
        }
    }
    LaunchedEffect(initial.id) {
        papers = runCatching { app.papers.wallet(initial.id).standing() }.getOrNull()
    }

    val phone = trip?.driver?.phone
    val driverName = vehicle.currentDriver?.name?.ifBlank { null } ?: trip?.driver?.name?.ifBlank { null }
    val openMap = {
        navigator.push("vehicle-map-${vehicle.id}") { VehicleLiveScreen(app, vehicle.id) }
    }

    DetailScreen(
        eyebrow = listOfNotNull(
            vehicle.categoryLabel?.ifBlank { null } ?: vehicle.typeLabel.ifBlank { null },
            vehicle.capacityTons?.let { stringResource(R.string.fleet_tonnes, it.toInt().toString()) },
            driverName,
        ).joinToString(" · "),
        title = stringResource(R.string.fleet_vehicle_title),
        footer = {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                if (phone != null) {
                    CircleButton(Lucide.phone, stringResource(R.string.fleet_vehicle_call, driverName.orEmpty()), { context.dial(phone) }, size = 56.dp, iconSize = 20.dp)
                }
                SaarthiButton(stringResource(R.string.fleet_vehicle_follow_map), onClick = openMap, leading = Lucide.map, modifier = Modifier.weight(1f))
            }
        },
    ) {
        TrackingPanel(vehicle, onLiveView = openMap, modifier = Modifier.rise())

        MotionFigures(vehicle, Modifier.rise(stagger(1)))
        readings?.let { ReadingsCard(it, Modifier.rise(stagger(1))) }

        trip?.let { current ->
            TripCard(
                current,
                Modifier
                    .rise(stagger(2))
                    .pressable(scale = 0.98f, label = stringResource(R.string.fleet_vehicle_open_trip)) { navigator.push("trip-${current.id}") { TripScreen(app, current) } },
            )
        }

        VehicleTripsCard(
            onOpen = { navigator.push("vehicle-trips-${vehicle.id}") { VehicleTripsScreen(app, vehicle) } },
            modifier = Modifier.rise(stagger(3)),
        )

        if (account.can(TripsApi.CAN_MANAGE) && vehicle.freeForWork) {
            SaarthiButton(
                stringResource(R.string.fleet_vehicle_new_trip),
                onClick = {
                    navigator.push("new-trip-${vehicle.id}") {
                        NewTripScreen(app, account, vehicle) { created ->
                            reload++
                            navigator.replace("trip-${created.id}") { TripScreen(app, created) }
                        }
                    }
                },
                tone = ButtonTone.SECONDARY,
                leading = Lucide.plus,
                modifier = Modifier.rise(stagger(3)),
            )
        }

        PapersCard(
            vehicle.documentHealth,
            papers,
            onOpen = { navigator.push("vehicle-papers-${vehicle.id}") { VehiclePapersScreen(app, vehicle) } },
            modifier = Modifier.rise(stagger(3)),
        )

        RunningCostsCard(
            remember(account) { CostAccess(account) },
            onOpen = { navigator.push("costs-${vehicle.id}") { RunningCostsScreen(app, account, vehicle) } },
            modifier = Modifier.rise(stagger(3)),
        )

        // Personal and Business plans share; the server checks both the plan and the right to edit vehicles.
        if (account.can(SharingApi.CAN_SHARE) && account.hasFeature(SharingApi.FEATURE)) {
            SharingCard(
                onOpen = { navigator.push("sharing-${vehicle.id}") { SharingScreen(app, vehicle) } },
                modifier = Modifier.rise(stagger(3)),
            )
        }

        DriverCard(
            driverName = vehicle.currentDriver?.name?.ifBlank { null },
            canAssign = account.can(VehiclesApi.CAN_ASSIGN_DRIVER),
            busy = driverBusy,
            onAssign = { assigning = true },
            onRemove = {
                driverBusy = true
                driverNotice = null
                scope.launch {
                    driverNotice = try {
                        app.vehicles.unassignDriver(vehicle.id)
                        reload++
                        Words.get(R.string.fleet_vehicle_driver_removed) to NoticeTone.SUCCESS
                    } catch (failure: Exception) {
                        if (failure is CancellationException) throw failure
                        failure.readable() to NoticeTone.DANGER
                    } finally {
                        driverBusy = false
                    }
                }
            },
            modifier = Modifier.rise(stagger(4)),
        )
        driverNotice?.let { (text, tone) -> NoticeCard(text, tone) }
    }

    // Beside the page, not in it, so it rises over the whole screen.
    AssignDriverSheet(
        app,
        account,
        vehicle,
        visible = assigning,
        onDismiss = { assigning = false },
        onAssigned = { who ->
            assigning = false
            // "You" is the sheet's word for the owner themself; an empty name, a driver it could not name.
            driverNotice = when {
                who == "You" -> Words.get(R.string.fleet_vehicle_assigned_you)
                who.isEmpty() -> Words.get(R.string.fleet_vehicle_assigned_driver)
                else -> Words.get(R.string.fleet_vehicle_assigned_named, who)
            } to NoticeTone.SUCCESS
            reload++
        },
    )
}

/** The way from a vehicle to who it is shared with. */
@Composable
private fun SharingCard(onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .pressable(scale = 0.99f, label = stringResource(R.string.fleet_vehicle_open_sharing), onClick = onOpen)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(Lucide.users, well = c.successSoft, ink = c.success, size = 40.dp, radius = 12.dp, iconSize = 18.dp)
        Column(Modifier.weight(1f)) {
            Eyebrow(stringResource(R.string.fleet_vehicle_sharing))
            Text(stringResource(R.string.fleet_vehicle_share_up_to, SharingApi.MAX_SHARES), style = SType.rowTitle, color = c.fg)
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}

/** How fast it is going, when it last reported, and how far it has run — the owner's and a shared person's alike. */
@Composable
internal fun MotionFigures(vehicle: VehiclesApi.Vehicle, modifier: Modifier = Modifier) {
    FigureRow(modifier) {
        val moving = vehicle.motion() == VehiclesApi.Motion.MOVING
        FigureTile(stringResource(R.string.fleet_vehicle_speed), if (moving) "${(vehicle.lastLocation?.speedKph ?: 0.0).toInt()}" else "0", stringResource(R.string.fleet_vehicle_kmh), Modifier.weight(1f))
        val seenAt = vehicle.lastLocation?.recordedAt
        val seen = seenAt?.let { ago(it) }
        FigureTile(stringResource(R.string.fleet_vehicle_seen), seen ?: "—", if (seen == null || isNow(seenAt)) "" else stringResource(R.string.fleet_vehicle_ago), Modifier.weight(1f))
        FigureTile(stringResource(R.string.fleet_vehicle_odometer), vehicle.odometerKm?.let(::odometerShort) ?: "—", stringResource(R.string.fleet_vehicle_km), Modifier.weight(1f))
    }
}

/** An odometer that fits a third of the screen: "84.5k", "290k", "9,820". */
private fun odometerShort(km: Double): String =
    if (km in 10_000.0..<100_000.0) Words.get(R.string.ui_count_thousands, "%.1f".format(km / 1_000).removeSuffix(".0")) else shortCount(km)

/** The brand panel: the plate as the headline, what it is doing, and the way to the map. */
@Composable
internal fun TrackingPanel(vehicle: VehiclesApi.Vehicle, onLiveView: () -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(28.dp)
    val photo = vehiclePhotoOf(vehicle.artType)
    val (word, dot) = when (vehicle.motion()) {
        VehiclesApi.Motion.MOVING -> stringResource(if (vehicle.currentTripId != null) R.string.fleet_vehicle_in_transit else R.string.fleet_vehicle_moving) to Brand.live
        VehiclesApi.Motion.IDLE -> stringResource(R.string.fleet_vehicle_stopped) to Color(0xFFF2952C)
        VehiclesApi.Motion.OFFLINE -> stringResource(R.string.fleet_vehicle_not_reporting) to Color(0xFF9F9FA8)
        VehiclesApi.Motion.SERVICE -> stringResource(R.string.fleet_vehicle_in_service) to Color(0xFFF2952C)
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
                Eyebrow(stringResource(R.string.fleet_vehicle_current_tracking), Modifier.weight(1f), color = Color.White.copy(alpha = 0.72f))
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
                Text(stringResource(R.string.fleet_vehicle_live_view), style = SType.bodyStrong, color = Brand.navy)
            }
        }
    }
}

/** The trip the vehicle is on: from, to, when, and how far along. */
@Composable
private fun TripCard(trip: TripsApi.Trip, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    SaarthiCard(modifier = modifier.fillMaxWidth(), padding = androidx.compose.foundation.layout.PaddingValues(18.dp), spacing = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.fleet_vehicle_current_trip), style = SType.cardTitle, color = c.fg, modifier = Modifier.weight(1f))
            StatusPill(
                if (trip.late) stringResource(R.string.fleet_vehicle_min_late, trip.delayMinutes) else stringResource(R.string.fleet_vehicle_on_time),
                background = if (trip.late) c.warningBg else c.successBg,
                ink = if (trip.late) c.warning else c.success,
                dot = false,
            )
        }
        RouteStops(
            from = trip.originAddress,
            fromNote = clockOf(trip.actualStartAt)?.let { stringResource(R.string.fleet_vehicle_left_at, it) },
            to = trip.destinationAddress,
            toNote = trip.remainingKm?.let { km(it) }?.let { stringResource(R.string.fleet_vehicle_to_go, it) },
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
                Text(from.ifBlank { stringResource(R.string.fleet_route_start) }, style = SType.rowTitle, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                fromNote?.let { Text(it, style = SType.caption, color = c.muted) }
            }
            Row(verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f)) {
                    Text(to.ifBlank { stringResource(R.string.fleet_route_destination) }, style = SType.rowTitle, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
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
            standing.expired > 0 -> PapersLook(Lucide.alertTriangle, c.dangerSoft, c.danger, pluralStringResource(R.plurals.fleet_vehicle_papers_expired_or_declined, standing.expired, standing.expired))
            standing.attention > 0 -> PapersLook(Lucide.fileText, c.warningSoft, c.warning, pluralStringResource(R.plurals.fleet_vehicle_papers_due_soon, standing.attention, standing.attention))
            standing.onFile > 0 -> PapersLook(Lucide.check, c.successSoft, c.success, pluralStringResource(R.plurals.fleet_vehicle_papers_in_order, standing.onFile, standing.onFile))
            else -> PapersLook(Lucide.fileText, c.sunken, c.muted, stringResource(R.string.fleet_vehicle_no_papers))
        }
        health.expired > 0 -> PapersLook(Lucide.alertTriangle, c.dangerSoft, c.danger, pluralStringResource(R.plurals.fleet_papers_expired, health.expired, health.expired))
        health.expiringSoon > 0 -> PapersLook(Lucide.fileText, c.warningSoft, c.warning, pluralStringResource(R.plurals.fleet_vehicle_papers_due_soon, health.expiringSoon, health.expiringSoon))
        health.total > 0 -> PapersLook(Lucide.check, c.successSoft, c.success, pluralStringResource(R.plurals.fleet_vehicle_all_papers_valid, health.total, health.total))
        else -> PapersLook(Lucide.fileText, c.sunken, c.muted, stringResource(R.string.fleet_vehicle_no_papers))
    }
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .pressable(scale = 0.99f, label = stringResource(R.string.fleet_vehicle_open_papers), onClick = onOpen)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(look.icon, well = look.well, ink = look.ink, size = 40.dp, radius = 12.dp, iconSize = 18.dp)
        Column(Modifier.weight(1f)) {
            Eyebrow(stringResource(R.string.fleet_vehicle_papers))
            Text(look.line, style = SType.rowTitle, color = c.fg)
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}

private data class PapersLook(val icon: String, val well: Color, val ink: Color, val line: String)
