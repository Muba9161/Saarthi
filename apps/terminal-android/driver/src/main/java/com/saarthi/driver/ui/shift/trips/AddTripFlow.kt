package com.saarthi.driver.ui.shift.trips

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.core.network.PlaceMatchDto
import com.saarthi.core.network.TripPlaceDto
import com.saarthi.core.ui.TerminalMap
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.InlineSpinner
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.NotesField
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.SaarthiField
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.bottomRule
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.shift.flow.FlowPanel
import com.saarthi.driver.ui.shift.flow.FlowTopBar
import com.saarthi.driver.ui.shift.map.HumsafarMapLook
import com.saarthi.driver.ui.shift.map.mapStyleUrl
import java.util.Locale

/**
 * Add a trip from the cab: from where the driver is (always — see
 * [TripPlannerViewModel]), to where they are going, the road between them on a
 * map, an optional note for the fleet — then Add.
 *
 * The same trip the fleet creates on the web. When the fleet's own trip holds
 * the vehicle the new one is queued behind it, and the screen says so before
 * the driver adds it rather than after.
 */
@Composable
fun AddTripFlow(
    visible: Boolean,
    cockpit: TerminalViewModel,
    onClose: () -> Unit,
    onCreated: (queued: Boolean) -> Unit,
) {
    FlowPanel(visible, onBack = onClose) {
        AddTripContent(cockpit, onClose, onCreated)
    }
}

@Composable
private fun ColumnScope.AddTripContent(
    cockpit: TerminalViewModel,
    onClose: () -> Unit,
    onCreated: (queued: Boolean) -> Unit,
) {
    val planner: TripPlannerViewModel = viewModel()
    val state by cockpit.uiState.collectAsState()
    val dispatch by cockpit.dispatch.collectAsState()
    val ui by planner.ui.collectAsState()
    val hereName = stringResource(R.string.add_trip_here)
    val here = state.telemetry.position

    // Each opening starts a fresh plan from where the vehicle is, then keeps its start there.
    LaunchedEffect(Unit) { planner.begin(here, hereName) }
    LaunchedEffect(here) { planner.followHere(here, hereName) }

    val fleetFirst = dispatch?.let { !it.driverCreated } == true

    Column(
        Modifier
            .weight(1f)
            .padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        FlowTopBar(
            title = stringResource(R.string.add_trip_title),
            plate = state.registration,
            onBack = { if (!ui.saving) onClose() },
        )
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(stringResource(R.string.add_trip_lead), style = SType.lead, color = Saarthi.colors.muted)
            if (fleetFirst) NoticeCard(stringResource(R.string.add_trip_queue_note), NoticeTone.INFO, icon = Lucide.info)

            Ends(ui, onChangeDestination = planner::changeDestination)

            if (ui.choosingDestination) {
                PlaceSearch(ui, onQuery = planner::setQuery, onChoose = planner::choose)
            } else {
                RoutePreview(ui, cockpit, onRetryRoute = planner::planRoute)
                NotesField(
                    value = ui.notes,
                    onValueChange = planner::setNotes,
                    label = stringResource(R.string.add_trip_notes),
                    placeholder = stringResource(R.string.fuel_optional),
                )
            }
            ui.saveFailure?.let { NoticeCard(it, NoticeTone.DANGER) }
        }
        SaarthiButton(
            stringResource(if (fleetFirst) R.string.add_trip_queue else R.string.add_trip_create),
            onClick = {
                planner.create { queued ->
                    cockpit.loadTrips()
                    cockpit.loadDispatch()
                    onCreated(queued)
                }
            },
            modifier = Modifier.padding(bottom = 16.dp),
            enabled = ui.ready && !ui.choosingDestination,
            busy = ui.saving,
            busyText = stringResource(R.string.add_trip_creating),
            leading = Lucide.plus,
        )
    }
}

/**
 * From and To. Only the destination can be changed: the start is where the
 * vehicle is, so it reads as a fact rather than a choice.
 */
@Composable
private fun Ends(ui: TripPlannerViewModel.Ui, onChangeDestination: () -> Unit) {
    val c = Saarthi.colors
    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 20.dp),
    ) {
        EndRow(
            label = stringResource(R.string.add_trip_from),
            place = ui.from,
            empty = stringResource(R.string.add_trip_locating),
            icon = Lucide.crosshair,
            ink = c.primary,
            active = false,
            divider = true,
            locating = ui.from == null,
        )
        EndRow(
            label = stringResource(R.string.add_trip_to),
            place = ui.to,
            empty = stringResource(R.string.add_trip_pick_destination),
            icon = Lucide.flag,
            ink = c.accent,
            active = ui.choosingDestination,
            divider = false,
            onEdit = onChangeDestination,
        )
    }
}

/** One end of the trip; pressable, with "Change", only when [onEdit] is given. */
@Composable
private fun EndRow(
    label: String,
    place: TripPlaceDto?,
    empty: String,
    icon: String,
    ink: androidx.compose.ui.graphics.Color,
    active: Boolean,
    divider: Boolean,
    locating: Boolean = false,
    onEdit: (() -> Unit)? = null,
) {
    val c = Saarthi.colors
    val change = stringResource(R.string.add_trip_change)
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 64.dp)
            .bottomRule(c.border, show = divider)
            .then(
                if (onEdit != null) {
                    Modifier.pressable(scale = 0.99f, label = "$label: ${place?.name ?: empty}. $change", onClick = onEdit)
                } else {
                    Modifier
                },
            )
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconWell(icon, well = if (active) c.primarySoft else c.sunken, ink = ink, size = 36.dp, radius = 12.dp, iconSize = 16.dp)
        Column(Modifier.weight(1f)) {
            Text(label, style = SType.caption, color = c.muted)
            Text(
                place?.name ?: empty,
                style = SType.bodyStrong,
                color = if (place == null) c.subtle else c.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            place?.address?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = SType.caption, color = c.subtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        when {
            locating -> InlineSpinner(c.primary, size = 16.dp)
            onEdit != null && !active -> Text(change, style = SType.smallStrong, color = c.primary)
        }
    }
}

/** The search box for the destination, and what it found. */
@Composable
private fun PlaceSearch(
    ui: TripPlannerViewModel.Ui,
    onQuery: (String) -> Unit,
    onChoose: (PlaceMatchDto) -> Unit,
) {
    val c = Saarthi.colors
    SaarthiField(
        value = ui.query,
        onValueChange = onQuery,
        placeholder = stringResource(R.string.add_trip_search_to),
        leading = Lucide.search,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
    )
    when {
        ui.searching -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            InlineSpinner(c.primary, size = 16.dp)
            Text(stringResource(R.string.nearby_searching), style = SType.small, color = c.muted)
        }
        ui.searchFailure != null -> NoticeCard(ui.searchFailure, NoticeTone.WARNING)
        ui.query.trim().length >= 2 && ui.matches.isEmpty() ->
            Text(stringResource(R.string.nearby_search_none), style = SType.small, color = c.muted)
        else -> Column(Modifier.fillMaxWidth().card(radius = 20.dp)) {
            ui.matches.forEachIndexed { index, match ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 60.dp)
                        .bottomRule(c.border, show = index < ui.matches.lastIndex)
                        .pressable(scale = 0.99f, label = match.name) { onChoose(match) }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    LineIcon(Lucide.mapPin, size = 18.dp, color = c.muted)
                    Column(Modifier.weight(1f)) {
                        Text(match.name, style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        match.address?.takeIf { it.isNotBlank() }?.let {
                            Text(it, style = SType.caption, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    match.straightLineKm?.let { km ->
                        Text(
                            "${String.format(Locale.getDefault(), "%.1f", km)} ${stringResource(R.string.unit_km)}",
                            style = SType.small,
                            color = c.muted,
                        )
                    }
                }
            }
        }
    }
}

/** The road between the two ends, on a small map, with how far and how long. */
@Composable
private fun RoutePreview(ui: TripPlannerViewModel.Ui, cockpit: TerminalViewModel, onRetryRoute: () -> Unit) {
    val c = Saarthi.colors
    val state by cockpit.uiState.collectAsState()
    val route = ui.route
    val geometry = remember(route) { route?.geometry?.map { it.latitude to it.longitude } ?: emptyList() }
    var frame by remember { mutableIntStateOf(0) }
    LaunchedEffect(route) { if (route != null) frame++ }

    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 20.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(190.dp)
                .clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp))
                .background(c.sunken),
        ) {
            TerminalMap(
                position = state.telemetry.position,
                headingDegrees = null,
                followVehicle = false,
                previewingRoute = true,
                routeGeometry = geometry,
                destination = ui.to?.let { it.latitude to it.longitude },
                frameRouteRequest = frame,
                vehicleType = state.server?.vehicle?.vehicleType,
                look = HumsafarMapLook,
                styleUrl = mapStyleUrl(),
                modifier = Modifier.fillMaxWidth().height(190.dp),
            )
        }
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            when {
                ui.routing -> {
                    InlineSpinner(c.primary, size = 16.dp)
                    Text(stringResource(R.string.add_trip_routing), style = SType.small, color = c.muted)
                }
                route != null -> {
                    LineIcon(Lucide.route, size = 18.dp, color = c.primary)
                    Text(
                        "${String.format(Locale.getDefault(), "%.0f", route.distanceKm)} ${stringResource(R.string.unit_km)} · " +
                            stringResource(R.string.nearby_by_road, route.durationMinutes),
                        style = SType.bodyStrong,
                        color = c.fg,
                    )
                }
                ui.routeFailed -> Text(stringResource(R.string.add_trip_route_failed), style = SType.small, color = c.muted)
            }
        }
    }
    if (ui.routeFailed) LinkButton(stringResource(R.string.action_try_again), onRetryRoute, color = c.primary)
}
