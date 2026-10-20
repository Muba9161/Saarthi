package com.saarthi.owner.ui.sharing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.ui.trips.tripStatusWord
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.network.ServicingApi
import com.saarthi.owner.network.SharingApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.km
import com.saarthi.owner.ui.common.prettyDate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.Hint
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
import com.saarthi.owner.ui.fleet.MotionFigures
import com.saarthi.owner.ui.fleet.TrackingPanel
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.tracking.FollowCard
import com.saarthi.owner.ui.tracking.FollowScreen
import com.saarthi.owner.ui.tracking.ReadingsCard
import com.saarthi.owner.ui.tracking.rememberFollowed
import com.saarthi.owner.ui.tracking.sharedFollowSource
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The web refreshes a shared vehicle every 15 seconds; so does this. */
private const val REFRESH_MS = 15_000L

/**
 * A vehicle somebody shared with this account: where it is, who is driving,
 * and the trips, fill-ups and servicing logged against it, with a way to add
 * each, its papers to look at, and a way to stop using it. Only what the
 * server's shared view carries is shown; finance stays with the owner.
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
    val followed = rememberFollowed("shared-${initial.shareId}", remember(initial.shareId) { sharedFollowSource(app, initial.shareId) })

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

    DetailScreen(
        eyebrow = if (vehicle.ownerName.isNotBlank()) stringResource(R.string.people_shared_by, vehicle.ownerName) else stringResource(R.string.people_shared_with_you),
        title = formatPlate(vehicle.registrationNumber),
    ) {
        if (gone) {
            NoticeCard(stringResource(R.string.people_shared_gone), NoticeTone.INFO, Modifier.rise())
            return@DetailScreen
        }
        // Drawn as the owner's page draws it: the panel, the figures, then the map with the path it covered.
        val openLive = { navigator.push("shared-live-${vehicle.shareId}") { SharedLiveScreen(app, vehicle.shareId) } }
        val asOwner = vehicle.asVehicle()
        TrackingPanel(asOwner, onLiveView = openLive, modifier = Modifier.rise())
        MotionFigures(asOwner, Modifier.rise(stagger(1)))
        Summary(vehicle, Modifier.rise(stagger(1)))
        FollowCard(followed, onExpand = openLive, modifier = Modifier.rise(stagger(1)))
        followed?.readings?.let { ReadingsCard(it, Modifier.rise(stagger(1))) }
        SharedPapersCard(onOpen = { navigator.push("shared-papers-${vehicle.shareId}") { SharedPapersScreen(app, vehicle) } }, modifier = Modifier.rise(stagger(1)))
        SegmentedControl(
            options = listOf(
                stringResource(R.string.people_shared_tab_trips),
                stringResource(R.string.people_shared_tab_fuel),
                stringResource(R.string.people_shared_tab_maintenance),
            ),
            selected = tab,
            onSelect = { tab = it },
            modifier = Modifier.rise(stagger(2)),
        )
        val kind = LogKind.entries[tab]
        SaarthiButton(stringResource(kind.action), onClick = { adding = kind }, tone = ButtonTone.SECONDARY, leading = Lucide.plus, height = 48.dp)
        Logs(app, vehicle.shareId, kind, reload)
        problem?.let { NoticeCard(it, NoticeTone.DANGER) }
        LinkButton(
            stringResource(R.string.people_shared_stop_using),
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
            Text(stringResource(R.string.people_shared_stop_title), style = SType.sheetTitle, color = c.fg)
            Text(
                if (vehicle.ownerName.isNotBlank()) {
                    stringResource(R.string.people_shared_stop_body, vehicle.ownerName)
                } else {
                    stringResource(R.string.people_shared_stop_body_owner)
                },
                style = SType.body,
                color = c.muted,
            )
            SaarthiButton(
                stringResource(R.string.people_shared_stop_confirm),
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
                listOfNotNull(vehicle.typeLabel.ifBlank { null }, vehicle.makeAndModel).joinToString(" · ").ifBlank { stringResource(R.string.people_vehicle) },
                style = SType.bodyStrong,
                color = c.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            StatusPill(VehiclesApi.statusWord(vehicle.status), background = c.sunken, ink = c.muted, dot = false)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Fact(stringResource(R.string.people_shared_driver), vehicle.currentDriverName ?: stringResource(R.string.people_shared_no_driver), Modifier.weight(1.3f))
            Fact(
                stringResource(if (vehicle.passengerCapacity != null) R.string.fleet_card_seats else R.string.fleet_card_payload),
                vehicle.passengerCapacity?.toString() ?: vehicle.capacityTons?.let { stringResource(R.string.fleet_tonnes, "%.0f".format(it)) } ?: "—",
                Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun Fact(label: String, value: String, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Eyebrow(label, maxLines = 1)
        Text(value, style = SType.smallStrong, color = Saarthi.colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** The shared vehicle over the whole screen, followed on its own while it is open. */
@Composable
private fun SharedLiveScreen(app: OwnerApp, shareId: String) {
    FollowScreen(rememberFollowed("shared-full-$shareId", remember(shareId) { sharedFollowSource(app, shareId) }))
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
                        LogKind.TRIP -> stringResource(R.string.people_shared_no_trips)
                        LogKind.FUEL -> stringResource(R.string.people_shared_no_fuel)
                        LogKind.SERVICE -> stringResource(R.string.people_shared_no_service)
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
    trailing = (actualDistanceKm ?: plannedDistanceKm)?.let { Words.get(R.string.common_distance_km, "%.0f".format(it)) },
    badge = tripStatusWord(status),
)

private fun SharingApi.Fuel.line() = LogLine(
    title = Words.get(R.string.people_shared_fuel_line, "%.1f".format(quantityLitres), rupees(pricePerUnit)),
    detail = listOfNotNull(stationName, km(odometerKm), prettyDate(recordedAt)).joinToString(" · ").ifBlank { null },
    trailing = rupees(totalCost),
    badge = null,
)

private fun SharingApi.Maintenance.line() = LogLine(
    title = title,
    detail = listOfNotNull(
        ServicingApi.typeWord(type),
        serviceProvider,
        prettyDate(completedAt ?: scheduledAt ?: createdAt),
    ).joinToString(" · ").ifBlank { null },
    trailing = cost?.let { rupees(it) },
    badge = ServicingApi.statusWord(status),
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
