package com.saarthi.owner.ui.sharing

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.network.SharingApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.prettyDate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SegmentedControl
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.map.MapVehicle
import com.saarthi.owner.ui.map.MarkerState
import com.saarthi.owner.ui.map.VehicleMap
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant

/** The web refreshes a shared vehicle every 15 seconds; so does this. */
private const val REFRESH_MS = 15_000L

/**
 * A vehicle somebody shared with this account: where it is, who is driving,
 * and the trips, fill-ups and servicing logged against it, with a way to add
 * each and a way to stop using it. Only what the server's shared view carries
 * is shown; costs, finance and papers stay with the owner.
 */
@Composable
fun SharedVehicleScreen(app: OwnerApp, initial: SharingApi.SharedVehicle, onLeft: () -> Unit) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var vehicle by remember { mutableStateOf(initial) }
    // The owner stopped sharing, the plan lapsed, or the vehicle left the road: all read as a 404.
    var gone by remember { mutableStateOf(false) }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var reload by remember { mutableIntStateOf(0) }
    var adding by remember { mutableStateOf<LogKind?>(null) }
    var leaving by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(initial.shareId) {
        while (true) {
            try {
                app.sharing.vehicle(initial.shareId)?.let { vehicle = it }
            } catch (failure: OwnerApi.Failure.Refused) {
                if (failure.status == 404) gone = true
            } catch (_: OwnerApi.Failure.Offline) {
                // Keep what is on screen; the next pass tries again.
            }
            delay(REFRESH_MS)
        }
    }

    DetailScreen(eyebrow = "Shared by ${vehicle.ownerName}".takeIf { vehicle.ownerName.isNotBlank() } ?: "Shared with you", title = formatPlate(vehicle.registrationNumber)) {
        if (gone) {
            NoticeCard("This vehicle is no longer shared with you.", NoticeTone.INFO, Modifier.rise())
            return@DetailScreen
        }
        Summary(vehicle, Modifier.rise())
        Where(vehicle, Modifier.rise(stagger(1)))
        SegmentedControl(
            options = listOf("Trips", "Fuel", "Maintenance"),
            selected = tab,
            onSelect = { tab = it },
            modifier = Modifier.rise(stagger(2)),
        )
        val kind = LogKind.entries[tab]
        SaarthiButton(kind.action, onClick = { adding = kind }, tone = ButtonTone.SECONDARY, leading = Lucide.plus, height = 48.dp)
        Logs(app, vehicle.shareId, kind, reload)
        problem?.let { NoticeCard(it, NoticeTone.DANGER) }
        LinkButton(
            "Stop using this vehicle",
            onClick = { leaving = true },
            color = c.danger,
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 8.dp),
        )
    }

    SharedLogSheet(
        app = app,
        shareId = vehicle.shareId,
        kind = adding,
        onDismiss = { adding = null },
        onSaved = {
            adding = null
            reload++
        },
    )

    BottomSheet(visible = leaving, onDismiss = { leaving = false }) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Stop using this vehicle?", style = SType.sheetTitle, color = c.fg)
            Text(
                "It leaves your Shared with me list. What you logged stays with the vehicle, and ${vehicle.ownerName.ifBlank { "the owner" }} can share it with you again.",
                style = SType.body,
                color = c.muted,
            )
            SaarthiButton(
                "Stop using it",
                onClick = {
                    leaving = false
                    scope.launch {
                        try {
                            app.sharing.end(vehicle.shareId)
                            onLeft()
                            navigator.pop()
                        } catch (failure: Exception) {
                            problem = failure.readable()
                        }
                    }
                },
                tone = ButtonTone.DANGER_OUTLINE,
            )
        }
    }
}

@Composable
private fun Summary(vehicle: SharingApi.SharedVehicle, modifier: Modifier) {
    val c = Saarthi.colors
    Column(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                listOfNotNull(vehicle.typeLabel.ifBlank { null }, vehicle.makeAndModel).joinToString(" · ").ifBlank { "Vehicle" },
                style = SType.bodyStrong,
                color = c.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            StatusPill(vehicle.status.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }, background = c.sunken, ink = c.muted, dot = false)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Fact("Driver", vehicle.currentDriverName ?: "No driver assigned", Modifier.weight(1.3f))
            Fact("Odometer", "%,d km".format(vehicle.odometerKm.toLong()), Modifier.weight(1f))
        }
        Text(vehicle.seenLine(), style = SType.caption, color = c.subtle)
    }
}

@Composable
private fun Fact(label: String, value: String, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Eyebrow(label, maxLines = 1)
        Text(value, style = SType.smallStrong, color = Saarthi.colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Where it is, on the map; a plain line when it has never reported. */
@Composable
private fun Where(vehicle: SharingApi.SharedVehicle, modifier: Modifier) {
    val c = Saarthi.colors
    val position = vehicle.lastLocation
    Box(
        modifier
            .fillMaxWidth()
            .height(200.dp)
            .clip(RoundedCornerShape(22.dp))
            .background(c.sunken),
        contentAlignment = Alignment.Center,
    ) {
        if (position == null) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                LineIcon(Lucide.mapPin, size = 24.dp, color = c.muted)
                Text("No position yet", style = SType.small, color = c.muted)
            }
        } else {
            val minutes = runCatching { Duration.between(Instant.parse(position.recordedAt), Instant.now()).toMinutes() }.getOrNull()
            val state = when {
                minutes == null || minutes > VehiclesApi.OFFLINE_AFTER_MINUTES -> MarkerState.OFFLINE
                (position.speedKph ?: 0.0) > VehiclesApi.MOVING_KPH -> MarkerState.MOVING
                else -> MarkerState.IDLE
            }
            var focus by remember { mutableIntStateOf(1) }
            LaunchedEffect(position.latitude, position.longitude) { focus++ }
            VehicleMap(
                vehicles = listOf(MapVehicle(vehicle.vehicleId, position.latitude, position.longitude, state, formatPlate(vehicle.registrationNumber))),
                selectedId = vehicle.vehicleId,
                onSelect = {},
                focusRequest = focus,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

/** The chosen log, newest first, read again whenever something is added. */
@Composable
private fun Logs(app: OwnerApp, shareId: String, kind: LogKind, reload: Int) {
    var attempt by remember { mutableIntStateOf(0) }
    var state by remember(kind) { mutableStateOf<Loadable<List<LogLine>>>(Loadable.Loading) }
    LaunchedEffect(shareId, kind, reload, attempt) {
        state = try {
            Loadable.Ready(
                when (kind) {
                    LogKind.TRIP -> app.sharing.trips(shareId).map { it.line() }
                    LogKind.FUEL -> app.sharing.fuel(shareId).map { it.line() }
                    LogKind.SERVICE -> app.sharing.maintenance(shareId).map { it.line() }
                },
            )
        } catch (failure: Exception) {
            Loadable.Failed(failure.readable())
        }
    }
    when (val shown = state) {
        Loadable.Loading -> SkeletonCards(count = 2)
        is Loadable.Failed -> FailedCard(shown.message, { attempt++ })
        is Loadable.Ready -> {
            if (shown.value.isEmpty()) {
                Hint(
                    when (kind) {
                        LogKind.TRIP -> "No trips logged yet."
                        LogKind.FUEL -> "No fill-ups logged yet."
                        LogKind.SERVICE -> "No servicing logged yet."
                    },
                )
            }
            shown.value.forEach { LogRow(it) }
        }
    }
}

/** One logged entry, in the same three lines whatever kind it is. */
private data class LogLine(val title: String, val detail: String?, val trailing: String?, val badge: String?)

private fun SharingApi.Trip.line() = LogLine(
    title = "$origin → $destination",
    detail = listOfNotNull(reference.ifBlank { null }, prettyDate(startedAt ?: plannedStartAt ?: createdAt)).joinToString(" · ").ifBlank { null },
    trailing = (actualDistanceKm ?: plannedDistanceKm)?.let { "%.0f km".format(it) },
    badge = status.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() },
)

private fun SharingApi.Fuel.line() = LogLine(
    title = "%.1f L at %s/L".format(quantityLitres, rupees(pricePerUnit)),
    detail = listOfNotNull(stationName, odometerKm?.let { "%,d km".format(it.toLong()) }, prettyDate(recordedAt)).joinToString(" · ").ifBlank { null },
    trailing = rupees(totalCost),
    badge = null,
)

private fun SharingApi.Maintenance.line() = LogLine(
    title = title,
    detail = listOfNotNull(
        SharingApi.MAINTENANCE_TYPES.firstOrNull { it.first == type }?.second,
        serviceProvider,
        prettyDate(completedAt ?: scheduledAt ?: createdAt),
    ).joinToString(" · ").ifBlank { null },
    trailing = cost?.let { rupees(it) },
    badge = status.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() },
)

@Composable
private fun LogRow(line: LogLine) {
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 18.dp)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(line.title, style = SType.bodyStrong, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
            line.detail?.let { Text(it, style = SType.caption, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            line.badge?.let { StatusPill(it, background = c.sunken, ink = c.muted, dot = false) }
        }
        line.trailing?.let { Text(it, style = SType.bodyStrong, color = c.fg) }
    }
}
