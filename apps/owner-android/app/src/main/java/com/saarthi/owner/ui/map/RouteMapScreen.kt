package com.saarthi.owner.ui.map

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.shell.LocalNavigator

/**
 * A trip's map over the whole screen, opened from its card: the same planned
 * road, ends, driven path and vehicle, with room to read them — framed whole
 * when it opens and again on the button, and the key at the foot.
 */
@Composable
fun RouteMapScreen(
    title: String,
    route: List<Pair<Double, Double>>,
    trail: List<TrailRun>,
    pickup: Pair<Double, Double>?,
    drop: Pair<Double, Double>?,
    vehicle: MapVehicle?,
    routeLabel: String = stringResource(R.string.market_map_planned_route),
    trailLabels: Map<TrailTone, String> = TRAIL_LABELS,
    routeCoveredTo: Pair<Double, Double>? = null,
) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    var frame by remember { mutableIntStateOf(1) }
    val pins = remember(pickup, drop) {
        listOfNotNull(
            pickup?.let { (lat, lng) -> MapPin("pickup", lat, lng, PinKind.PICKUP) },
            drop?.let { (lat, lng) -> MapPin("drop", lat, lng, PinKind.DROP) },
        )
    }
    val density = LocalDensity.current
    val topPx = with(density) { 90.dp.roundToPx() }
    val bottomPx = with(density) { 170.dp.roundToPx() }

    Box(Modifier.fillMaxSize().background(c.canvas)) {
        VehicleMap(
            vehicles = listOfNotNull(vehicle),
            selectedId = vehicle?.id,
            onSelect = {},
            route = route,
            routeCoveredTo = routeCoveredTo,
            trail = trail,
            pins = pins,
            frameAllRequest = frame,
            topPaddingPx = topPx,
            bottomPaddingPx = bottomPx,
            modifier = Modifier.fillMaxSize(),
        )
        Row(
            Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircleButton(Lucide.chevronLeft, stringResource(R.string.action_back), navigator::pop, size = 48.dp)
            Spacer(Modifier.weight(1f))
            CircleButton(Lucide.crosshair, stringResource(R.string.market_map_show_whole_route), onClick = { frame++ }, size = 48.dp)
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
            Text(title, style = SType.bodyStrong, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
            MapKey(route, routeLabel, tonesOf(trail), trailLabels, pickup != null, drop != null)
        }
    }
}
