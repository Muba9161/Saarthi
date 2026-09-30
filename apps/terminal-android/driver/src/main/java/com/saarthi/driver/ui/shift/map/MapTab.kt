package com.saarthi.driver.ui.shift.map

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.core.data.OfflineMaps
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.AlwaysDark
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.MapInk
import com.saarthi.driver.ui.design.popIn
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger
import com.saarthi.driver.ui.shift.link
import com.saarthi.driver.ui.shift.tabBarClearance

/** What the Map tab can ask the shell to do. */
class MapActions(
    val back: () -> Unit,
    val sos: () -> Unit,
    val fullScreen: () -> Unit,
    val controls: ControlActions,
    val shift: ShiftCardActions,
)

/**
 * The live view: the map with the journey on it, then the instruments, the
 * controls, the offline map and the shift — dark whatever the appearance
 * setting, as the design paints it, so the screen never flashes white at night.
 */
@Composable
fun MapTab(
    cockpit: TerminalViewModel,
    offline: OfflineMaps,
    showInstruments: Boolean,
    fallbackPlate: String?,
    actions: MapActions,
) {
    val state by cockpit.uiState.collectAsState()
    val navigation by cockpit.navigation.collectAsState()
    val guidanceOn by cockpit.voiceGuidance.collectAsState()
    val offlineStatus by offline.status.collectAsState()
    val camera = rememberMapCamera(navigation)
    LaunchedEffect(Unit) { offline.refresh() }

    val statusTop = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val position = state.telemetry.position
    val route = navigation.route

    AlwaysDark {
        Box(
            Modifier
                .fillMaxSize()
                .background(MapInk.canvas),
        ) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState()),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(MAP_HEIGHT)
                        .background(MapInk.ground),
                ) {
                    LiveMap(state, navigation, camera, Modifier.matchParentSize())
                    MapScrim(MapInk.canvas)
                    NavCard(
                        navigation = navigation,
                        guidanceMuted = !guidanceOn,
                        onToggleGuidance = { cockpit.setVoiceGuidance(!guidanceOn) },
                        onStart = cockpit::startNavigation,
                        onStop = cockpit::clearRoute,
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .padding(start = 16.dp, end = 16.dp, top = statusTop + TOP_BAR_HEIGHT + 16.dp)
                            .rise(120, distance = (-16).dp),
                    )
                    SpeedBubble(
                        state.speedKph,
                        Modifier
                            .align(Alignment.BottomStart)
                            .padding(start = 16.dp, bottom = 44.dp)
                            .popIn(300, 0.6f),
                    )
                    Column(
                        Modifier
                            .align(Alignment.BottomEnd)
                            .padding(end = 16.dp, bottom = 44.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        MapFab(Lucide.maximize, stringResource(R.string.map_full), actions.fullScreen, Modifier.popIn(350, 0.6f))
                        MapFab(
                            Lucide.crosshair,
                            stringResource(R.string.map_recentre),
                            camera::recentre,
                            Modifier.popIn(400, 0.6f),
                            tint = MapInk.primary,
                            iconSize = 22.dp,
                            fill = Lucide.crosshairDot,
                        )
                    }
                    MapCredits(
                        Modifier
                            .align(Alignment.BottomEnd)
                            .padding(end = 78.dp, bottom = 50.dp),
                    )
                }

                Column(
                    Modifier.padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = tabBarClearance()),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    if (showInstruments) {
                        InstrumentsSection(state.telemetry, Modifier.rise(stagger(1)))
                    } else {
                        InstrumentsHiddenNote(Modifier.rise(stagger(1)))
                    }
                    ControlsSection(state.moving, actions.controls, Modifier.rise(stagger(2)))
                    OfflineMapCard(
                        status = offlineStatus,
                        hasPosition = position != null,
                        hasRoute = route != null,
                        onSaveHere = { position?.let { offline.saveAround(it.latitude, it.longitude) } },
                        onSaveRoute = { route?.let { r -> offline.saveAlong(r.geometry.map { it.latitude to it.longitude }) } },
                        onDelete = offline::delete,
                        modifier = Modifier.rise(stagger(3)),
                    )
                    ShiftCard(
                        state.state,
                        actions.shift,
                        Modifier
                            .padding(top = 4.dp)
                            .rise(stagger(4)),
                    )
                }
            }

            MapTopBar(
                plate = state.registration ?: fallbackPlate.orEmpty(),
                link = state.link,
                vehicleType = state.server?.vehicle?.vehicleType,
                onBack = actions.back,
                onSos = actions.sos,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .padding(start = 16.dp, end = 16.dp, top = 4.dp)
                    .rise(distance = (-16).dp),
            )
        }
    }
}

/** The map's share of the screen, as the design sizes it. */
private val MAP_HEIGHT = 560.dp

/** The sticky bar's height plus the gap above it. */
private val TOP_BAR_HEIGHT = 64.dp
