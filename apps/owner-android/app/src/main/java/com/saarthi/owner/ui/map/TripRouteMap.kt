package com.saarthi.owner.ui.map

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card

/** The words the key gives each trail tone: the web trail legend's. */
val TRAIL_LABELS: Map<TrailTone, String>
    get() = mapOf(
        TrailTone.ON_ROUTE to Words.get(R.string.market_map_trail_on_route),
        TrailTone.OFF_ROUTE to Words.get(R.string.market_map_trail_off_route),
        TrailTone.ALTERNATE to Words.get(R.string.market_map_trail_other_road),
        TrailTone.NO_TRIP to Words.get(R.string.market_map_trail_no_trip),
    )

/**
 * A trip's road in a card: the planned [route], the road already driven over
 * it as a [trail], the pickup and the drop, and the [vehicle] while it is
 * still on the job. A key under the map names only what is drawn, and
 * [content] carries whatever the screen says about the journey beneath it.
 *
 * One component for both sides that follow a trip — the customer's order and
 * a vehicle's trip — so a path reads the same wherever it is opened. The map
 * frames everything once when the shapes first arrive, and again on the
 * button, never on a refresh.
 */
@Composable
fun TripRouteMap(
    route: List<Pair<Double, Double>>,
    trail: List<TrailRun>,
    pickup: Pair<Double, Double>?,
    drop: Pair<Double, Double>?,
    vehicle: MapVehicle?,
    modifier: Modifier = Modifier,
    routeLabel: String = stringResource(R.string.market_map_planned_route),
    trailLabels: Map<TrailTone, String> = TRAIL_LABELS,
    mapHeight: Dp = 240.dp,
    /** Where the vehicle stands on [route], so the road behind it is dimmed. */
    routeCoveredTo: Pair<Double, Double>? = null,
    /** Opens the same map over the whole screen. */
    onExpand: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit = {},
) {
    var frame by remember { mutableIntStateOf(0) }
    val pins = remember(pickup, drop) {
        listOfNotNull(
            pickup?.let { (lat, lng) -> MapPin("pickup", lat, lng, PinKind.PICKUP) },
            drop?.let { (lat, lng) -> MapPin("drop", lat, lng, PinKind.DROP) },
        )
    }
    val tones = remember(trail) { tonesOf(trail) }

    // Frame once each time a shape first appears: the order's two ends come
    // before the trip's route, and the route before its driven path.
    LaunchedEffect(pins.size, route.size >= 2, tones.isNotEmpty(), vehicle != null) { frame++ }

    Column(modifier.fillMaxWidth().card(radius = 24.dp)) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(mapHeight)
                .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)),
        ) {
            VehicleMap(
                vehicles = listOfNotNull(vehicle),
                selectedId = vehicle?.id,
                onSelect = {},
                route = route,
                routeCoveredTo = routeCoveredTo,
                trail = trail,
                pins = pins,
                frameAllRequest = frame,
                modifier = Modifier.fillMaxWidth().height(mapHeight),
            )
            Row(Modifier.align(Alignment.TopEnd).padding(10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (pins.isNotEmpty() || route.isNotEmpty() || vehicle != null) {
                    CircleButton(Lucide.crosshair, stringResource(R.string.market_map_show_whole_route), onClick = { frame++ }, size = 40.dp, iconSize = 16.dp)
                }
                onExpand?.let { CircleButton(Lucide.maximize, stringResource(R.string.market_map_open_full_screen), onClick = it, size = 40.dp, iconSize = 16.dp) }
            }
        }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            MapKey(route, routeLabel, tones, trailLabels, pickup != null, drop != null)
            content()
        }
    }
}

/**
 * What the map draws, named in its colours — only what is drawn, so the key
 * never lists a line the person cannot find.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun MapKey(
    route: List<Pair<Double, Double>>,
    routeLabel: String,
    tones: List<TrailTone>,
    trailLabels: Map<TrailTone, String>,
    hasPickup: Boolean,
    hasDrop: Boolean,
    pickupLabel: String = stringResource(R.string.market_map_pickup),
    dropLabel: String = stringResource(R.string.market_map_drop),
) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (route.size >= 2) LineKey(routeLabel, Color(OverlayInk.ROUTE))
        tones.forEach { tone -> LineKey(trailLabels[tone] ?: TRAIL_LABELS.getValue(tone), Color(OverlayInk.tone(tone))) }
        if (hasPickup) DotKey(pickupLabel, fill = Color(OverlayInk.ORIGIN), ring = Color.White)
        if (hasDrop) DotKey(dropLabel, fill = Color(OverlayInk.DESTINATION), ring = Color.White)
    }
}

/** The tones a trail actually draws, in the order the key lists them. */
internal fun tonesOf(trail: List<TrailRun>): List<TrailTone> =
    trail.filter { it.points.size >= 2 }.map { it.tone }.distinct()

/** A short line, not a dot: it stands for a line on the map. */
@Composable
private fun LineKey(label: String, ink: Color) {
    val c = Saarthi.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.width(16.dp).height(4.dp).clip(CircleShape).background(ink))
        Text(label, style = SType.caption, color = c.muted)
    }
}

@Composable
private fun DotKey(label: String, fill: Color, ring: Color) {
    val c = Saarthi.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(fill).border(2.5.dp, ring, CircleShape))
        Text(label, style = SType.caption, color = c.muted)
    }
}
