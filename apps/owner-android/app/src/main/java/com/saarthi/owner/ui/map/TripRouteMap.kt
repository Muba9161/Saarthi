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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card

/** The words the key gives each trail tone: the web trail legend's. */
val TRAIL_LABELS: Map<TrailTone, String> = mapOf(
    TrailTone.ON_ROUTE to "On route",
    TrailTone.OFF_ROUTE to "Off route",
    TrailTone.ALTERNATE to "Other road",
    TrailTone.NO_TRIP to "No trip",
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
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TripRouteMap(
    route: List<Pair<Double, Double>>,
    trail: List<TrailRun>,
    pickup: Pair<Double, Double>?,
    drop: Pair<Double, Double>?,
    vehicle: MapVehicle?,
    modifier: Modifier = Modifier,
    routeLabel: String = "Planned route",
    trailLabels: Map<TrailTone, String> = TRAIL_LABELS,
    mapHeight: Dp = 240.dp,
    content: @Composable ColumnScope.() -> Unit = {},
) {
    var frame by remember { mutableIntStateOf(0) }
    val pins = remember(pickup, drop) {
        listOfNotNull(
            pickup?.let { (lat, lng) -> MapPin("pickup", lat, lng, PinKind.PICKUP) },
            drop?.let { (lat, lng) -> MapPin("drop", lat, lng, PinKind.DROP) },
        )
    }
    val tones = remember(trail) { trail.filter { it.points.size >= 2 }.map { it.tone }.distinct() }

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
                trail = trail,
                pins = pins,
                frameAllRequest = frame,
                modifier = Modifier.fillMaxWidth().height(mapHeight),
            )
            if (pins.isNotEmpty() || route.isNotEmpty() || vehicle != null) {
                CircleButton(
                    Lucide.maximize,
                    "Show the whole route",
                    onClick = { frame++ },
                    size = 40.dp,
                    iconSize = 16.dp,
                    modifier = Modifier.align(Alignment.TopEnd).padding(10.dp),
                )
            }
        }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (route.size >= 2) LineKey(routeLabel, Color(OverlayInk.ROUTE))
                tones.forEach { tone -> LineKey(trailLabels[tone] ?: TRAIL_LABELS.getValue(tone), Color(OverlayInk.tone(tone))) }
                if (pickup != null) DotKey("Pickup", fill = Color.White, ring = Color(OverlayInk.ROUTE))
                if (drop != null) DotKey("Drop", fill = Color(OverlayInk.DROP), ring = Color.White)
            }
            content()
        }
    }
}

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
