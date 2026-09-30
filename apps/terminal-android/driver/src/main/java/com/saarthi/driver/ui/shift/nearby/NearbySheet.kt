package com.saarthi.driver.ui.shift.nearby

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.saarthi.core.network.NearbyPlaceDto
import com.saarthi.core.network.PlaceMatchDto
import com.saarthi.core.telemetry.Metric
import com.saarthi.core.ui.MapPin
import com.saarthi.core.ui.TerminalMap
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.AlwaysDark
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.MapInk
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.shift.map.HumsafarMapLook
import com.saarthi.driver.ui.shift.map.MapCredits
import kotlinx.coroutines.flow.first

/**
 * Nearby services, map first: numbered pins over the live map, the kinds of
 * place in a row of tiles, and the best one featured with its Navigate button.
 *
 * Navigating draws the route and hands back to the Map tab — the route is
 * previewed there, and nothing starts until the driver presses Start.
 */
@Composable
fun NearbySheet(
    visible: Boolean,
    cockpit: TerminalViewModel,
    initialCategory: String?,
    onClose: () -> Unit,
    onRouted: (String) -> Unit,
) {
    val close = {
        cockpit.clearSearch()
        onClose()
    }
    BackHandler(enabled = visible, onBack = close)
    AnimatedVisibility(visible, enter = fadeIn(tween(300)), exit = fadeOut(tween(250))) {
        AlwaysDark { NearbyScreen(cockpit, initialCategory, close, onRouted) }
    }
}

@Composable
private fun NearbyScreen(
    cockpit: TerminalViewModel,
    initialCategory: String?,
    onClose: () -> Unit,
    onRouted: (String) -> Unit,
) {
    val state by cockpit.uiState.collectAsState()
    val places by cockpit.places.collectAsState()
    val roadDistances by cockpit.roadDistances.collectAsState()
    val query by cockpit.searchQuery.collectAsState()
    val matches by cockpit.searchResults.collectAsState()
    val searching by cockpit.searching.collectAsState()
    val searchFailure by cockpit.searchFailure.collectAsState()

    var kind by rememberSaveable { mutableStateOf(ServiceKind.from(initialCategory)) }
    var loaded by remember { mutableStateOf<ServiceKind?>(null) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    var picked by remember(kind) { mutableStateOf<Int?>(null) }
    var routing by remember { mutableStateOf<String?>(null) }
    var routeFailed by remember { mutableStateOf(false) }
    var frame by remember { mutableIntStateOf(0) }

    /*
     * One kind at a time. The request is over when the busy flag it raised
     * comes down; a list the cockpit did not replace means it failed, so the
     * previous kind's places are never shown under this kind's name.
     */
    LaunchedEffect(kind, attempt) {
        loaded = null
        failed = false
        val before = cockpit.places.value
        cockpit.findServices(kind.key)
        var started = false
        cockpit.busy.first { busy ->
            if (busy) started = true
            started && !busy
        }
        failed = cockpit.places.value === before
        loaded = kind
    }

    val position = state.telemetry.position
    val heading = state.telemetry.value(Metric.HEADING)?.takeIf { state.moving }
    val searchingMode = query.isNotBlank()
    val shown = if (loaded == kind && !failed) places else emptyList()
    val rows = remember(shown, position?.latitude, position?.longitude, heading) { nearbyRows(shown, position, heading) }
    val featured = picked ?: rows.bestIndex()

    val pins = if (searchingMode) {
        matches.mapIndexed { i, match -> MapPin(match.latitude, match.longitude, "${i + 1}") }
    } else {
        rows.mapIndexed { i, row ->
            MapPin(row.place.latitude, row.place.longitude, "${i + 1}", selected = i == featured, emphasised = row.side != Side.BEHIND)
        }
    }
    LaunchedEffect(pins.map { it.latitude to it.longitude }, position != null) { frame++ }

    val go: (String, (onDone: (Boolean) -> Unit) -> Unit) -> Unit = { name, route ->
        routeFailed = false
        routing = name
        route { ok ->
            routing = null
            if (ok) onRouted(name) else routeFailed = true
        }
    }
    val navigatePlace: (NearbyPlaceDto) -> Unit = { place -> go(place.name) { done -> cockpit.navigateTo(place, done) } }
    val navigateMatch: (PlaceMatchDto) -> Unit = { match -> go(match.name) { done -> cockpit.navigateToMatch(match, done) } }

    val sheetTop = SHEET_TOP
    val density = LocalDensity.current
    val coveredPx = with(density) { (MAP_HEIGHT - sheetTop).roundToPx() }
    // The status bar and the search row float over the top of the map.
    val searchPx = WindowInsets.statusBars.getTop(density) + with(density) { SEARCH_ROW.roundToPx() }

    Box(
        Modifier
            .fillMaxSize()
            .background(MapInk.ground),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(MAP_HEIGHT),
        ) {
            TerminalMap(
                position = position,
                headingDegrees = state.telemetry.value(Metric.HEADING),
                driving = false,
                followVehicle = false,
                vehicleType = state.server?.vehicle?.vehicleType,
                look = HumsafarMapLook,
                pins = pins,
                onPinTapped = { index -> if (!searchingMode) picked = index },
                framePinsRequest = frame,
                framePinsTopPx = searchPx,
                framePinsBottomPx = coveredPx,
                modifier = Modifier.fillMaxSize(),
            )
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(150.dp)
                    .background(Brush.verticalGradient(listOf(MapInk.ground.copy(alpha = 0.9f), Color.Transparent))),
            )
            MapCredits(
                Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 16.dp, bottom = MAP_HEIGHT - sheetTop + 8.dp),
            )
        }

        SearchRow(
            query = query,
            onQuery = cockpit::setSearchQuery,
            onSearch = cockpit::searchPlaces,
            onClear = cockpit::clearSearch,
            onClose = onClose,
            modifier = Modifier
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(start = 16.dp, end = 16.dp, top = 4.dp)
                .rise(100, distance = (-14).dp),
        )

        NearbyPanel(
            kind = kind,
            onKind = { if (it != kind) kind = it },
            loading = loaded != kind,
            failed = failed,
            onRetry = { attempt++ },
            hasPosition = position != null,
            roadDistances = roadDistances,
            rows = rows,
            featured = featured,
            onPick = { picked = it },
            search = if (searchingMode) SearchState(query, matches, searching, searchFailure) else null,
            routing = routing,
            routeFailed = routeFailed,
            onNavigatePlace = navigatePlace,
            onNavigateMatch = navigateMatch,
            modifier = Modifier.padding(top = sheetTop),
        )
    }
}

/** Close, and the search field — floating over the top of the map. */
@Composable
private fun SearchRow(
    query: String,
    onQuery: (String) -> Unit,
    onSearch: () -> Unit,
    onClear: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier,
) {
    val fill = Color(0xF0161618)
    val ring = Color(0x14FFFFFF)
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        CircleButton(
            Lucide.close,
            stringResource(R.string.action_close),
            onClose,
            size = 48.dp,
            background = fill,
            ink = MapInk.fg,
            elevated = false,
            ring = ring,
            modifier = Modifier.shadow(12.dp, CircleShape, spotColor = Color.Black.copy(alpha = 0.7f)),
        )
        Row(
            Modifier
                .weight(1f)
                .height(48.dp)
                .shadow(12.dp, CircleShape, spotColor = Color.Black.copy(alpha = 0.7f))
                .clip(CircleShape)
                .background(fill)
                .border(1.dp, ring, CircleShape)
                .padding(start = 16.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            LineIcon(Lucide.search, size = 18.dp, color = MapInk.muted)
            Box(Modifier.weight(1f)) {
                if (query.isEmpty()) {
                    Text(stringResource(R.string.nearby_search), style = SType.lead, color = MapInk.subtle, maxLines = 1)
                }
                BasicTextField(
                    value = query,
                    onValueChange = onQuery,
                    singleLine = true,
                    textStyle = SType.lead.copy(color = MapInk.fg),
                    cursorBrush = SolidColor(MapInk.primary),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { onSearch() }),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (query.isNotEmpty()) {
                CircleButton(
                    Lucide.close,
                    stringResource(R.string.action_close),
                    onClear,
                    size = 36.dp,
                    iconSize = 14.dp,
                    background = Color(0x14FFFFFF),
                    ink = MapInk.fg,
                    elevated = false,
                )
            }
        }
    }
}

/** How much of the screen the map takes, and where the sheet starts over it — the design's proportions. */
private val MAP_HEIGHT = 560.dp
private val SHEET_TOP = 318.dp
private val SEARCH_ROW = 56.dp
