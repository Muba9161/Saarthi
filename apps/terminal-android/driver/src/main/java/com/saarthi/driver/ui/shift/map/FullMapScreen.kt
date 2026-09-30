package com.saarthi.driver.ui.shift.map

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.AlwaysDark
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.MapInk
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.rememberLoop
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.shift.link
import kotlin.math.roundToInt

/**
 * The map, edge to edge: the turn at the top, speed and the plate at the foot,
 * and SOS within a thumb's reach. Everything else waits on the Map tab.
 */
@Composable
fun FullMapScreen(
    cockpit: TerminalViewModel,
    fallbackPlate: String?,
    onClose: () -> Unit,
    onSos: () -> Unit,
) {
    BackHandler(onBack = onClose)
    val state by cockpit.uiState.collectAsState()
    val navigation by cockpit.navigation.collectAsState()
    val guidanceOn by cockpit.voiceGuidance.collectAsState()
    val camera = rememberMapCamera(navigation)

    AlwaysDark {
        Box(
            Modifier
                .fillMaxSize()
                .background(MapInk.ground),
        ) {
            LiveMap(state, navigation, camera, Modifier.matchParentSize())
            MapScrim(MapInk.ground, top = 0.22f, bottom = 0.78f, footAlpha = 0.85f)

            NavCard(
                navigation = navigation,
                guidanceMuted = !guidanceOn,
                onToggleGuidance = { cockpit.setVoiceGuidance(!guidanceOn) },
                onStart = cockpit::startNavigation,
                onStop = null,
                large = true,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .padding(start = 16.dp, end = 16.dp, top = 4.dp)
                    .rise(100, distance = (-16).dp),
            )

            Column(
                Modifier
                    .align(Alignment.BottomEnd)
                    .windowInsetsPadding(WindowInsets.navigationBars)
                    .padding(end = 16.dp, bottom = 116.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                MapFab(
                    Lucide.crosshair,
                    stringResource(R.string.map_recentre),
                    camera::recentre,
                    Modifier.rise(150),
                    tint = MapInk.primary,
                    iconSize = 22.dp,
                    fill = Lucide.crosshairDot,
                )
                RoundSos(onSos, Modifier.rise(150))
            }
            MapCredits(
                Modifier
                    .align(Alignment.BottomStart)
                    .windowInsetsPadding(WindowInsets.navigationBars)
                    .padding(start = 20.dp, bottom = 108.dp),
            )

            FootBar(
                speedKph = state.speedKph,
                plate = state.registration ?: fallbackPlate.orEmpty(),
                state = state,
                onClose = onClose,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .windowInsetsPadding(WindowInsets.navigationBars)
                    .padding(start = 16.dp, end = 16.dp, bottom = 24.dp)
                    .rise(150),
            )
        }
    }
}

/** Speed, the plate and the way back out. */
@Composable
private fun FootBar(
    speedKph: Double?,
    plate: String,
    state: TerminalViewModel.UiState,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(24.dp)
    val shown by animateIntAsState((speedKph ?: 0.0).roundToInt(), tween(600), label = "full-speed")
    Row(
        modifier
            .fillMaxWidth()
            .height(72.dp)
            .shadow(16.dp, shape, spotColor = Color.Black.copy(alpha = 0.8f))
            .clip(shape)
            .background(Color(0xF0161618))
            .border(1.dp, Color(0x14FFFFFF), shape)
            .padding(start = 18.dp, end = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                if (speedKph == null) "—" else shown.toString(),
                style = SType.hero.copy(fontSize = 30.sp, lineHeight = 30.sp, letterSpacing = (-0.04).em),
                color = MapInk.fg,
            )
            Text(stringResource(R.string.unit_kmh), style = SType.caption, color = MapInk.muted)
        }
        Box(
            Modifier
                .width(1.dp)
                .height(32.dp)
                .background(Color(0x1AFFFFFF)),
        )
        Box(Modifier.weight(1f)) {
            PlateLine(plate, state.link, state.server?.vehicle?.vehicleType, plateSize = 14)
        }
        CircleButton(
            Lucide.minimize,
            stringResource(R.string.map_full_leave),
            onClose,
            size = 52.dp,
            iconSize = 20.dp,
            background = MapInk.sunken,
            ink = MapInk.fg,
            elevated = false,
            stroke = 2f,
            shape = RoundedCornerShape(18.dp),
        )
    }
}

/** The round SOS on the full map, glowing gently so it is found without looking. */
@Composable
private fun RoundSos(onClick: () -> Unit, modifier: Modifier = Modifier) {
    val glow by rememberLoop(1_300, reverse = true, rest = 0f, label = "full-sos")
    val label = stringResource(R.string.sos_raise)
    Box(
        modifier
            .size(60.dp)
            .shadow((8 + 8 * glow).dp, CircleShape, spotColor = MapInk.danger, ambientColor = MapInk.danger)
            .clip(CircleShape)
            .background(MapInk.danger)
            .pressable(scale = 0.94f, label = label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(stringResource(R.string.sos), style = SType.buttonSmall.copy(letterSpacing = 0.06.em), color = Color.White)
    }
}
