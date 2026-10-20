package com.saarthi.owner.ui.tracking

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.R
import com.saarthi.owner.ui.common.FigureRow
import com.saarthi.owner.ui.common.FigureTile
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.ago
import com.saarthi.owner.ui.common.isNow
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.map.MapKey
import com.saarthi.owner.ui.map.MapPin
import com.saarthi.owner.ui.map.MarkerState
import com.saarthi.owner.ui.map.OverlayInk
import com.saarthi.owner.ui.map.PinKind
import com.saarthi.owner.ui.map.TRAIL_LABELS
import com.saarthi.owner.ui.map.VehicleMap
import com.saarthi.owner.ui.map.tonesOf
import com.saarthi.owner.ui.shell.LocalNavigator

private val CARD_MAP_HEIGHT: Dp = 220.dp

/**
 * The followed vehicle in a card: its disc, its trip's planned road (dimmed
 * where it has passed) and ends, and the road it has covered in the trail's
 * colours, with a key naming what is drawn. Frames everything when the shapes
 * first arrive and again on the button; the other button opens it full screen.
 */
@Composable
fun FollowCard(followed: Followed?, onExpand: () -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    if (followed == null || followed.empty) {
        Box(
            modifier.fillMaxWidth().height(CARD_MAP_HEIGHT).clip(RoundedCornerShape(22.dp)).background(c.sunken),
            contentAlignment = Alignment.Center,
        ) {
            if (followed != null) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    LineIcon(Lucide.mapPin, size = 24.dp, color = c.muted)
                    Text(stringResource(R.string.market_follow_no_position), style = SType.small, color = c.muted)
                }
            }
        }
        return
    }
    var frame by remember { mutableIntStateOf(0) }
    LaunchedEffect(followed.marker != null, followed.trail.isNotEmpty(), followed.trip != null) { frame++ }

    Column(modifier.fillMaxWidth().card(radius = 22.dp)) {
        Box(Modifier.fillMaxWidth().height(CARD_MAP_HEIGHT).clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp))) {
            FollowMap(followed, frameAllRequest = frame, modifier = Modifier.fillMaxSize())
            Row(Modifier.align(Alignment.TopEnd).padding(10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CircleButton(Lucide.crosshair, stringResource(R.string.market_follow_show_whole_road), onClick = { frame++ }, size = 40.dp, iconSize = 16.dp)
                CircleButton(Lucide.maximize, stringResource(R.string.market_map_open_full_screen), onClick = onExpand, size = 40.dp, iconSize = 16.dp)
            }
        }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            FollowKey(followed)
            Text(followed.statusLine(), style = SType.caption, color = c.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

/**
 * The followed vehicle over the whole screen: framed whole when it opens, then
 * kept on the vehicle as it moves, with its trip, key and readings at the foot.
 */
@Composable
fun FollowScreen(followed: Followed?) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    var frame by remember { mutableIntStateOf(0) }
    var focus by remember { mutableIntStateOf(0) }
    var framed by remember { mutableStateOf(false) }
    val marker = followed?.marker
    LaunchedEffect(followed != null) {
        if (followed != null && !framed) {
            framed = true
            frame++
        }
    }
    // A new position: back to the vehicle — but not before the whole road has been shown once.
    LaunchedEffect(marker?.latitude, marker?.longitude) { if (framed && marker != null) focus++ }
    val bottomPx = with(LocalDensity.current) { 230.dp.roundToPx() }

    Box(Modifier.fillMaxSize().background(c.canvas)) {
        if (followed != null) {
            FollowMap(followed, frameAllRequest = frame, focusRequest = focus, bottomPaddingPx = bottomPx, modifier = Modifier.fillMaxSize())
        }
        Row(
            Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircleButton(Lucide.chevronLeft, stringResource(R.string.action_back), navigator::pop, size = 48.dp)
            Spacer(Modifier.weight(1f))
            CircleButton(Lucide.crosshair, stringResource(R.string.market_follow_show_whole_road), onClick = { frame++ }, size = 48.dp)
        }
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.navigationBars)
                .padding(16.dp)
                .card(radius = 24.dp, color = c.elevated)
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (followed == null) {
                Text(stringResource(R.string.market_follow_finding), style = SType.body, color = c.muted)
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PlateChip(followed.plate, size = 12.sp)
                    followed.marker?.let { MotionPill(it.state, Color(OverlayInk.vehicle(it.state, it.status))) }
                }
                Text(followed.statusLine(), style = SType.body, color = c.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                FollowKey(followed)
                followed.readings?.let { Text(it.inLine(), style = SType.smallStrong, color = c.fg) }
            }
        }
    }
}

/**
 * What the vehicle measured last, figure by figure — only those it measured,
 * so an engine without a sender shows nothing rather than a made-up zero.
 */
@Composable
fun ReadingsCard(readings: Readings, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val tiles = readings.tiles()
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Eyebrow(stringResource(R.string.market_follow_readings), Modifier.weight(1f))
            Text(
                if (isNow(readings.recordedAt)) stringResource(R.string.market_follow_measured_now) else stringResource(R.string.market_follow_measured_ago, ago(readings.recordedAt)),
                style = SType.caption,
                color = c.subtle,
            )
        }
        tiles.chunked(3).forEach { row ->
            FigureRow {
                row.forEach { (label, value, unit) -> FigureTile(label, value, unit, Modifier.weight(1f)) }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun FollowMap(
    followed: Followed,
    frameAllRequest: Int,
    modifier: Modifier,
    focusRequest: Int = 0,
    bottomPaddingPx: Int = 0,
) {
    val trip = followed.trip
    val marker = followed.marker
    val pins = remember(trip) {
        listOfNotNull(
            trip?.pickup?.let { (lat, lng) -> MapPin("pickup", lat, lng, PinKind.PICKUP) },
            trip?.drop?.let { (lat, lng) -> MapPin("drop", lat, lng, PinKind.DROP) },
        )
    }
    VehicleMap(
        vehicles = listOfNotNull(marker),
        selectedId = marker?.id,
        onSelect = {},
        route = trip?.route.orEmpty(),
        routeCoveredTo = marker?.let { it.latitude to it.longitude }?.takeIf { trip != null },
        trail = followed.trail,
        pins = pins,
        frameAllRequest = frameAllRequest,
        focusRequest = focusRequest,
        bottomPaddingPx = bottomPaddingPx,
        modifier = modifier,
    )
}

@Composable
private fun FollowKey(followed: Followed) {
    val trip = followed.trip
    MapKey(
        route = trip?.route.orEmpty(),
        routeLabel = stringResource(R.string.market_map_planned_route),
        tones = tonesOf(followed.trail),
        trailLabels = TRAIL_LABELS,
        hasPickup = trip?.pickup != null,
        hasDrop = trip?.drop != null,
        pickupLabel = stringResource(R.string.market_follow_start),
        dropLabel = stringResource(R.string.market_follow_destination),
    )
}

@Composable
private fun MotionPill(state: MarkerState, dot: Color) {
    val c = Saarthi.colors
    val word = when (state) {
        MarkerState.MOVING -> stringResource(R.string.market_follow_moving)
        MarkerState.IDLE -> stringResource(R.string.market_follow_stopped)
        MarkerState.OFFLINE -> stringResource(R.string.market_follow_not_reporting)
        MarkerState.ALERT -> stringResource(R.string.market_follow_alert)
    }
    StatusPill(word, background = c.sunken, ink = c.fg, dotColor = dot, live = state == MarkerState.MOVING)
}

/** The trip it is on, or when it was last heard from. */
private fun Followed.statusLine(): String {
    trip?.let { trip ->
        return listOfNotNull(trip.destination.ifBlank { null }?.let { Words.get(R.string.market_follow_to, it) }, trip.reference.ifBlank { null }).joinToString(" · ")
    }
    val seen = seenAt ?: return Words.get(R.string.market_follow_never_reported)
    return if (isNow(seen)) Words.get(R.string.market_follow_reporting_now) else Words.get(R.string.market_follow_last_seen, ago(seen))
}

/** Each measured figure as label, value and unit. */
private fun Readings.tiles(): List<Triple<String, String, String>> = listOfNotNull(
    speedKph?.let { Triple(Words.get(R.string.market_follow_speed), "%d".format(it.toInt()), Words.get(R.string.market_follow_unit_kph)) },
    rpm?.let { Triple(Words.get(R.string.market_follow_engine), "%,d".format(it.toInt()), Words.get(R.string.market_follow_unit_rpm)) },
    engineLoad?.let { Triple(Words.get(R.string.market_follow_load), "%d".format(it.toInt()), "%") },
    coolantTemperature?.let { Triple(Words.get(R.string.market_follow_coolant), "%d".format(it.toInt()), "°C") },
    fuelLevel?.let { Triple(Words.get(R.string.market_follow_fuel), "%d".format(it.toInt()), "%") },
    batteryVoltage?.let { Triple(Words.get(R.string.market_follow_battery), "%.1f".format(it), "V") },
)

/** The same figures on one line, for the foot of the full-screen map. */
private fun Readings.inLine(): String = tiles().joinToString(" · ") { (_, value, unit) -> if (unit == "%") "$value%" else "$value $unit" }
