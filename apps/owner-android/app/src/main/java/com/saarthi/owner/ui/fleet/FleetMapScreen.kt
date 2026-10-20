package com.saarthi.owner.ui.fleet

import androidx.annotation.StringRes
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.ago
import com.saarthi.owner.ui.common.isNow
import com.saarthi.owner.ui.common.rememberPhoto
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.common.vehiclePhotoOf
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Ease
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.LiveDot
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.map.MarkerState
import com.saarthi.owner.ui.map.OverlayInk
import com.saarthi.owner.ui.tracking.mapMarker
import com.saarthi.owner.ui.map.VehicleMap
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.delay

private const val REFRESH_MS = 15_000L

/** The chips over the map. */
private enum class MapFilter(@StringRes val label: Int) {
    ALL(R.string.fleet_map_filter_all),
    MOVING(R.string.fleet_map_filter_moving),
    IDLE(R.string.fleet_map_filter_idle),
    OFFLINE(R.string.fleet_map_filter_offline),
}

/**
 * The live map — every vehicle the business runs, where it last reported.
 *
 * Search by plate or driver, filter by what they are doing, tap one for its
 * card, and open it from there. The design's Fleet · Live map.
 */
@Composable
fun FleetMapScreen(app: OwnerApp, account: SessionStore.Account, onBack: (() -> Unit)? = null) {
    val model = viewModel { FleetListModel(app.vehicles, app.drivers, account) }
    val state by model.state.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf(MapFilter.ALL) }
    var query by rememberSaveable { mutableStateOf("") }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    var frameAll by remember { mutableIntStateOf(0) }
    var focus by remember { mutableIntStateOf(0) }
    val navigator = LocalNavigator.current
    val c = Saarthi.colors

    LaunchedEffect(Unit) {
        while (true) {
            delay(REFRESH_MS)
            model.refresh(silent = true)
        }
    }

    val lists = (state as? Loadable.Ready)?.value
    val all = lists?.vehicles.orEmpty().filter { it.lastLocation?.latitude != null && it.lastLocation.longitude != null }
    val counts = all.groupingBy { it.motion().toFilter() }.eachCount()
    val shown = all.filter { vehicle ->
        (filter == MapFilter.ALL || vehicle.motion().toFilter() == filter) &&
            (query.isBlank() || vehicle.matches(query))
    }
    // Frame the fleet once, as soon as there is a fleet to frame.
    LaunchedEffect(all.isNotEmpty()) { if (all.isNotEmpty()) frameAll++ }

    val selected = shown.firstOrNull { it.id == selectedId }
    val density = LocalDensity.current
    val bottomPx = with(density) { (tabBarClearance() + 220.dp).roundToPx() }
    val topPx = with(density) { 150.dp.roundToPx() }

    Box(Modifier.fillMaxSize()) {
        VehicleMap(
            vehicles = shown.mapNotNull { it.mapMarker() },
            selectedId = selected?.id,
            onSelect = { id ->
                selectedId = id
                if (id != null) focus++
            },
            frameAllRequest = frameAll,
            focusRequest = focus,
            topPaddingPx = topPx,
            bottomPaddingPx = bottomPx,
            modifier = Modifier.fillMaxSize(),
        )

        Column(
            Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(top = 10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                Modifier.padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                // Opened as a page rather than a tab: the way back.
                onBack?.let { CircleButton(Lucide.chevronLeft, stringResource(R.string.fleet_map_back), it, size = 52.dp, iconSize = 20.dp) }
                SearchPill(
                    query,
                    { query = it },
                    onSearch = {
                        // One match flies to it; several are framed together.
                        val only = shown.singleOrNull()
                        if (only != null) {
                            selectedId = only.id
                            focus++
                        } else {
                            selectedId = null
                            frameAll++
                        }
                    },
                    modifier = Modifier.weight(1f),
                )
                CircleButton(
                    Lucide.crosshair,
                    stringResource(R.string.fleet_map_show_all),
                    onClick = {
                        selectedId = null
                        frameAll++
                    },
                    size = 52.dp,
                    iconSize = 20.dp,
                )
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                MapFilter.entries.forEach { option ->
                    val count = if (option == MapFilter.ALL) all.size else counts[option] ?: 0
                    FilterPill(option, count, selected = filter == option) { filter = option }
                }
            }
        }

        // Loaded, and nothing has a position: say so, rather than leave an empty map to puzzle over.
        if (lists != null && all.isEmpty()) {
            NoticeCard(
                stringResource(if (lists.vehicles.isEmpty()) R.string.fleet_map_no_vehicles else R.string.fleet_map_no_positions),
                NoticeTone.INFO,
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(start = 16.dp, end = 16.dp, bottom = tabBarClearance() + 8.dp),
                icon = Lucide.mapPin,
            )
        }

        AnimatedVisibility(
            visible = selected != null,
            enter = slideInVertically(tween(450, easing = Ease.out)) { it / 2 } + fadeIn(tween(300)),
            exit = slideOutVertically(tween(250)) { it / 2 } + fadeOut(tween(200)),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(start = 12.dp, end = 12.dp, bottom = tabBarClearance() - 14.dp),
        ) {
            var last by remember { mutableStateOf(selected) }
            if (selected != null) last = selected
            last?.let { vehicle ->
                VehicleCard(
                    vehicle,
                    onOpen = { navigator.push("vehicle-${vehicle.id}") { VehicleScreen(app, account, vehicle) } },
                    onClose = { selectedId = null },
                )
            }
        }
    }
}

private fun VehiclesApi.Motion.toFilter(): MapFilter = when (this) {
    VehiclesApi.Motion.MOVING -> MapFilter.MOVING
    VehiclesApi.Motion.IDLE, VehiclesApi.Motion.SERVICE -> MapFilter.IDLE
    VehiclesApi.Motion.OFFLINE -> MapFilter.OFFLINE
}

private fun VehiclesApi.Vehicle.matches(query: String): Boolean {
    val needle = query.trim().lowercase().replace(" ", "")
    return registrationNumber.lowercase().replace(" ", "").contains(needle) ||
        currentDriver?.name?.lowercase()?.replace(" ", "")?.contains(needle) == true
}

@Composable
private fun SearchPill(value: String, onChange: (String) -> Unit, onSearch: () -> Unit, modifier: Modifier) {
    val c = Saarthi.colors
    val focusManager = LocalFocusManager.current
    Row(
        modifier
            .height(52.dp)
            .card(radius = 26.dp, color = c.elevated)
            .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        LineIcon(Lucide.search, size = 18.dp, color = c.muted)
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) Text(stringResource(R.string.fleet_map_search_hint), style = SType.body, color = c.subtle, maxLines = 1)
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                textStyle = SType.body.copy(color = c.fg),
                cursorBrush = SolidColor(c.primary),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = {
                    focusManager.clearFocus()
                    onSearch()
                }),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (value.isNotEmpty()) {
            val clear = stringResource(R.string.fleet_map_clear_search)
            LineIcon(
                Lucide.close,
                size = 16.dp,
                color = c.muted,
                description = clear,
                modifier = Modifier.pressable(label = clear) { onChange("") },
            )
        }
    }
}

@Composable
private fun FilterPill(option: MapFilter, count: Int, selected: Boolean, onClick: () -> Unit) {
    val c = Saarthi.colors
    val dot = when (option) {
        MapFilter.ALL -> null
        // The colours the discs of each kind are drawn in, so the filter reads as a key.
        MapFilter.MOVING -> Color(OverlayInk.vehicle(MarkerState.MOVING, null))
        MapFilter.IDLE -> Color(OverlayInk.vehicle(MarkerState.IDLE, null))
        MapFilter.OFFLINE -> Color(OverlayInk.vehicle(MarkerState.OFFLINE, null))
    }
    Row(
        Modifier
            .height(38.dp)
            .clip(CircleShape)
            .background(if (selected) c.fg else c.elevated)
            .border(1.dp, if (selected) c.fg else c.border, CircleShape)
            .pressable(onClick = onClick)
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        dot?.let { LiveDot(it, size = 7.dp, breathing = option == MapFilter.MOVING) }
        Text(stringResource(option.label), style = SType.chip, color = if (selected) c.canvas else c.fg)
        Text(count.toString(), style = SType.chip, color = if (selected) c.canvas.copy(alpha = 0.7f) else c.muted)
    }
}

/** The picked vehicle's card, over the foot of the map. */
@Composable
private fun VehicleCard(vehicle: VehiclesApi.Vehicle, onOpen: () -> Unit, onClose: () -> Unit) {
    val c = Saarthi.colors
    val photo = vehiclePhotoOf(vehicle.artType)
    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 28.dp, color = c.elevated)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(
                Modifier
                    .size(width = 84.dp, height = 52.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(c.sunken),
                contentAlignment = Alignment.Center,
            ) {
                val bitmap = photo?.let { rememberPhoto(it) }
                if (bitmap != null) {
                    Image(bitmap, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.padding(4.dp))
                } else {
                    LineIcon(Lucide.truck, size = 24.dp, color = c.muted)
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                PlateChip(vehicle.registrationNumber, size = 12.sp)
                MotionPill(vehicle)
                Text(
                    listOfNotNull(
                        vehicle.categoryLabel?.ifBlank { null } ?: vehicle.typeLabel.ifBlank { null },
                        vehicle.currentDriver?.name?.ifBlank { null },
                        vehicle.lastLocation?.recordedAt?.let { at ->
                            if (isNow(at)) stringResource(R.string.fleet_map_reporting_now) else stringResource(R.string.fleet_map_seen_ago, ago(at))
                        },
                    ).joinToString(" · "),
                    style = SType.small,
                    color = c.muted,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            CircleButton(Lucide.close, stringResource(R.string.fleet_map_close), onClose, size = 36.dp, iconSize = 14.dp, elevated = false, background = c.sunken)
        }
        SaarthiButton(stringResource(R.string.fleet_map_open_vehicle), onClick = onOpen, height = 52.dp, trailing = Lucide.arrowRight)
    }
}
