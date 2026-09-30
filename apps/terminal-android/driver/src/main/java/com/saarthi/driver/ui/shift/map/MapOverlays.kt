package com.saarthi.driver.ui.shift.map

import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.BrandMark
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.LiveDot
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.MapInk
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SosButton
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.shift.Link
import java.util.Locale
import kotlin.math.roundToInt

/** The frosted-dark panel every overlay on the map sits on. */
private val PanelFill = Color(0xEB161618)
private val PanelRing = Color(0x12FFFFFF)
private val ButtonFill = Color(0x14FFFFFF)

private fun Modifier.mapPanel(radius: Dp, fill: Color = PanelFill, lifted: Boolean = false): Modifier {
    val shape = RoundedCornerShape(radius)
    return this
        .then(if (lifted) Modifier.shadow(14.dp, shape, spotColor = Color.Black.copy(alpha = 0.7f)) else Modifier)
        .clip(shape)
        .background(fill)
        .border(1.dp, PanelRing, shape)
}

/** Darkens the top and foot of the map so the panels over it read, and melts into the page below. */
@Composable
fun BoxScope.MapScrim(ground: Color, top: Float = 0.28f, bottom: Float = 0.8f, footAlpha: Float = 1f) {
    Box(
        Modifier
            .matchParentSize()
            .background(
                Brush.verticalGradient(
                    0f to ground.copy(alpha = 0.85f),
                    top to Color.Transparent,
                    bottom to Color.Transparent,
                    1f to ground.copy(alpha = footAlpha),
                ),
            ),
    )
}

/** The plate, and whether the fleet can see it — with a breathing dot while live. */
@Composable
fun PlateLine(plate: String, link: Link, vehicleType: String?, plateSize: Int = 15) {
    Column {
        Text(plate, style = SType.plate(plateSize.sp, 0.02.em), color = MapInk.fg, maxLines = 1)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            LiveDot(
                when (link) {
                    Link.LIVE -> MapInk.success
                    Link.OFFLINE -> MapInk.warning
                    Link.CONNECTING -> MapInk.subtle
                },
                size = 7.dp,
                breathing = link == Link.LIVE,
            )
            val vehicle = vehicleWord(vehicleType)
            Text(
                stringResource(
                    when (link) {
                        Link.LIVE -> R.string.map_link_live
                        Link.OFFLINE -> R.string.map_link_offline
                        Link.CONNECTING -> R.string.map_link_connecting
                    },
                    vehicle,
                ),
                style = SType.caption,
                color = MapInk.muted,
                maxLines = 1,
            )
        }
    }
}

/** The Map tab's sticky bar: back, the mark, the plate and SOS. */
@Composable
fun MapTopBar(
    plate: String,
    link: Link,
    vehicleType: String?,
    onBack: () -> Unit,
    onSos: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .height(60.dp)
            .mapPanel(20.dp, lifted = true)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        CircleButton(
            Lucide.chevronLeft,
            stringResource(R.string.map_back),
            onBack,
            background = ButtonFill,
            ink = MapInk.fg,
            elevated = false,
        )
        BrandMark(height = 32.dp, plated = true)
        Box(Modifier.weight(1f)) { PlateLine(plate, link, vehicleType) }
        SosButton(onSos)
    }
}

/**
 * The journey, on the map: the next turn while guiding, or the route and its
 * Start button while the driver is still deciding.
 */
@Composable
fun NavCard(
    navigation: TerminalViewModel.NavigationUi,
    guidanceMuted: Boolean,
    onToggleGuidance: () -> Unit,
    onStart: () -> Unit,
    onStop: (() -> Unit)?,
    modifier: Modifier = Modifier,
    large: Boolean = false,
) {
    val route = navigation.route ?: return
    val step = navigation.step
    val (well, icon) = when {
        navigation.previewing -> MapInk.primary to Lucide.route
        navigation.arrived -> MapInk.success to Lucide.flag
        navigation.rerouting || navigation.rerouteFailed || navigation.offRoute -> MapInk.warning to Lucide.refresh
        else -> MapInk.primary to maneuverIcon(step)
    }
    val title = when {
        navigation.previewing -> stringResource(R.string.nav_route_ready)
        navigation.arrived -> stringResource(R.string.nav_arrived)
        navigation.rerouting -> stringResource(R.string.nav_rerouting)
        navigation.rerouteFailed -> stringResource(R.string.nav_reroute_failed)
        navigation.offRoute -> stringResource(R.string.nav_off_route)
        else -> step?.instruction ?: stringResource(R.string.nav_on_route)
    }
    val destination = route.destination.name
    val subtitle = when {
        navigation.previewing -> stringResource(
            R.string.nav_route_summary,
            String.format(Locale.getDefault(), "%.1f", route.distanceKm),
            route.durationMinutes,
            destination,
        )
        step != null && navigation.guiding && !navigation.arrived ->
            stringResource(R.string.nav_next, distanceToTurn(navigation.stepMetres), destination)
        route.summary.isNotBlank() -> stringResource(R.string.nav_via, destination, route.summary)
        else -> destination
    }

    Row(
        modifier
            .fillMaxWidth()
            .mapPanel(if (large) 22.dp else 20.dp, lifted = large)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconWell(
            icon,
            well = well,
            ink = MapInk.onPrimary,
            size = if (large) 56.dp else 52.dp,
            radius = if (large) 16.dp else 14.dp,
            iconSize = if (large) 28.dp else 26.dp,
            stroke = 2.2f,
        )
        Column(Modifier.weight(1f)) {
            Text(
                title,
                style = (if (large) SType.section else SType.headerTitle).copy(letterSpacing = (-0.02).em),
                color = MapInk.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(subtitle, style = SType.small, color = MapInk.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (navigation.previewing) {
            Box(
                Modifier
                    .height(44.dp)
                    .clip(CircleShape)
                    .background(MapInk.primary)
                    .pressable(label = stringResource(R.string.nav_start), onClick = onStart)
                    .padding(horizontal = 16.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(stringResource(R.string.nav_start), style = SType.buttonSmall, color = MapInk.onPrimary)
            }
        } else {
            CircleButton(
                if (guidanceMuted) Lucide.volumeOff else Lucide.volume,
                stringResource(if (guidanceMuted) R.string.nav_unmute else R.string.nav_mute),
                onToggleGuidance,
                background = if (guidanceMuted) Color(0x40DF494E) else ButtonFill,
                ink = MapInk.fg,
                elevated = false,
                stroke = 2f,
            )
        }
        if (onStop != null) {
            CircleButton(
                Lucide.close,
                stringResource(R.string.nav_stop),
                onStop,
                background = ButtonFill,
                ink = MapInk.fg,
                elevated = false,
                stroke = 2f,
            )
        }
    }
}

/** The speed, big enough to read at a glance, counting smoothly between fixes. */
@Composable
fun SpeedBubble(speedKph: Double?, modifier: Modifier = Modifier) {
    val shown by animateIntAsState((speedKph ?: 0.0).roundToInt(), tween(600), label = "speed")
    Column(
        modifier
            .width(92.dp)
            .mapPanel(22.dp, fill = Color(0xE60E0E10))
            .padding(vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            if (speedKph == null) "—" else shown.toString(),
            style = SType.hero.copy(fontSize = 38.sp, lineHeight = 38.sp, letterSpacing = (-0.04).em),
            color = MapInk.fg,
        )
        Text(stringResource(R.string.unit_kmh), style = SType.micro, color = MapInk.muted, modifier = Modifier.padding(top = 4.dp))
    }
}

/** A round button floating on the map. */
@Composable
fun MapFab(
    path: String,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = MapInk.fg,
    iconSize: Dp = 20.dp,
    fill: String? = null,
) {
    CircleButton(
        path,
        description,
        onClick,
        modifier,
        size = 52.dp,
        iconSize = iconSize,
        background = PanelFill,
        ink = tint,
        elevated = false,
        stroke = 2f,
        ring = PanelRing,
        fill = fill,
    )
}

/** The map's credits, which OpenStreetMap's licence requires on screen. */
@Composable
fun MapCredits(modifier: Modifier = Modifier) {
    Text(
        stringResource(R.string.map_credits),
        style = SType.micro.copy(fontSize = 10.sp),
        color = Color.White.copy(alpha = 0.5f),
        modifier = modifier,
    )
}
