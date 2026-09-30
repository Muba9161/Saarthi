package com.saarthi.driver.ui.shift.home

import androidx.annotation.StringRes
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.core.domain.DrivingHours
import com.saarthi.core.domain.PumpPrice
import com.saarthi.core.domain.TerminalState
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Brand
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.SaarthiCard
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SlideToAct
import com.saarthi.driver.ui.design.StatusPill
import com.saarthi.driver.ui.design.brandGradient
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.rememberLoop
import com.saarthi.driver.ui.shift.driverWord
import com.saarthi.driver.ui.shift.humanised
import kotlin.math.roundToInt

/** The route the tracking card draws, on the design's 350 × 230 grid. */
private fun trackingRoute(w: Float, h: Float): Path {
    val sx = w / 350f
    val sy = h / 230f
    return Path().apply {
        moveTo(-10f * sx, 206f * sy)
        cubicTo(80f * sx, 206f * sy, 92f * sx, 130f * sy, 172f * sx, 134f * sy)
        cubicTo(252f * sx, 138f * sy, 244f * sx, 68f * sy, 360f * sx, 64f * sy)
    }
}

/**
 * "Current tracking" — the vehicle as the headline, on the brand panel.
 *
 * A drawn route with a marker travelling along it and the plate large enough to
 * check against the truck from a step away. The whole card opens the map.
 */
@Composable
internal fun TrackingCard(
    plate: String,
    state: TerminalState,
    live: Boolean,
    onOpenMap: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val reduced = Saarthi.reducedMotion
    val shape = RoundedCornerShape(28.dp)
    val drawn = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) { if (!reduced) drawn.animateTo(1f, tween(1_600, 200, Ease.out)) }
    val travel = remember { Animatable(0.5f) }
    LaunchedEffect(reduced) {
        if (reduced) return@LaunchedEffect
        kotlinx.coroutines.delay(1_200)
        while (true) {
            travel.snapTo(0.04f)
            travel.animateTo(0.96f, tween(9_000, easing = LinearEasing))
        }
    }
    val halo by rememberLoop(2_000, Ease.out, rest = 0f, label = "tracking-halo")
    val nudge by rememberLoop(900, Ease.standard, reverse = true, rest = 0f, label = "open-map-nudge")

    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .height(230.dp)
            .shadow(20.dp, shape, spotColor = Color(0xBF021D40), ambientColor = Color.Transparent)
            .brandGradient(shape)
            .pressable(scale = 0.97f, onClick = onOpenMap),
    ) {
        val density = LocalDensity.current
        val w = with(density) { maxWidth.toPx() }
        val h = with(density) { maxHeight.toPx() }
        val route = remember(w, h) { trackingRoute(w, h) }
        val measure = remember(route) { PathMeasure().apply { setPath(route, false) } }

        Canvas(Modifier.fillMaxSize()) {
            val sx = size.width / 350f
            val sy = size.height / 230f
            val grid = Color.White.copy(alpha = 0.07f)
            drawLine(grid, Offset(0f, 64f * sy), Offset(size.width, 52f * sy), 1.dp.toPx())
            drawLine(grid, Offset(0f, 176f * sy), Offset(size.width, 156f * sy), 1.dp.toPx())
            drawLine(grid, Offset(120f * sx, 0f), Offset(150f * sx, size.height), 1.dp.toPx())
            drawLine(grid, Offset(286f * sx, 0f), Offset(258f * sx, size.height), 1.dp.toPx())
            val partial = Path()
            measure.getSegment(0f, measure.length * drawn.value, partial, true)
            drawPath(partial, Color.White.copy(alpha = 0.16f), style = Stroke(14.dp.toPx(), cap = StrokeCap.Round))
            drawPath(partial, Color.White.copy(alpha = 0.9f), style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round))
            val end = Offset(336f * sx, 65f * sy)
            drawCircle(Brand.saffron, 6.dp.toPx(), end)
            drawCircle(Color.White, 2.5.dp.toPx(), end)
        }

        // The marker, riding the route.
        val at = measure.getPosition(measure.length * travel.value)
        val markerPx = with(density) { 34.dp.toPx() }
        Box(
            Modifier
                .offset { IntOffset((at.x - markerPx / 2).roundToInt(), (at.y - markerPx / 2).roundToInt()) }
                .size(34.dp),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier
                    .size(34.dp)
                    .graphicsLayer {
                        val scale = 0.6f + 1.4f * halo
                        scaleX = scale
                        scaleY = scale
                        alpha = 0.8f * (1f - halo)
                    }
                    .clip(CircleShape)
                    .background(Color.White.copy(alpha = 0.35f)),
            )
            Box(
                Modifier
                    .size(28.dp)
                    .clip(CircleShape)
                    .background(Color.White),
                contentAlignment = Alignment.Center,
            ) {
                LineIcon(Lucide.truck, size = 16.dp, color = Brand.navy, stroke = 2.2f)
            }
        }

        Column(
            Modifier
                .fillMaxSize()
                .padding(22.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Eyebrow(stringResource(R.string.home_current_tracking), Modifier.weight(1f), color = Color.White.copy(alpha = 0.72f))
                StatusPill(
                    state.driverWord(),
                    background = Color.White.copy(alpha = 0.14f),
                    ink = Color.White,
                    dotColor = if (state.checklistOutstanding) Color(0xFFF2952C) else Brand.live,
                    ring = Color.White.copy(alpha = 0.18f),
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    plate,
                    style = SType.plate(34.sp, 0.03.em).copy(
                        shadow = Shadow(Color(0x99021D40), Offset(0f, 4f), 28f),
                    ),
                    color = Color.White,
                    maxLines = 1,
                )
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                    Text(
                        stringResource(if (live) R.string.reporting_live_short else R.string.reporting_not_yet),
                        style = SType.small,
                        color = Color.White.copy(alpha = 0.78f),
                        modifier = Modifier.weight(1f),
                    )
                    Row(
                        Modifier
                            .height(40.dp)
                            .clip(CircleShape)
                            .background(Color.White)
                            .padding(horizontal = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(stringResource(R.string.home_open_map), style = SType.smallStrong, color = Brand.navy)
                        LineIcon(
                            Lucide.arrowRight,
                            size = 16.dp,
                            color = Brand.navy,
                            stroke = 2.2f,
                            modifier = Modifier.offset(x = (6f * nudge).dp),
                        )
                    }
                }
            }
        }
    }
}

/** FASTag, the fuel this vehicle takes, and hours today — three small cards. */
@Composable
internal fun StatTiles(
    cockpit: TerminalViewModel,
    fuelType: String?,
    hours: DrivingHours.State,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    val fastag by cockpit.fastag.collectAsState()
    val price by cockpit.fuelPrice.collectAsState()

    val tag = fastag
    val fastagValue = tag?.balanceRupees?.let { "₹%,.0f".format(it) } ?: "–"
    val fastagSub = when {
        tag == null -> stringResource(R.string.fastag_not_linked)
        tag.status != "ACTIVE" -> tag.status.humanised()
        tag.lowBalance -> stringResource(R.string.fastag_low)
        tag.balanceRupees == null -> stringResource(R.string.fastag_unknown)
        else -> tag.issuerBank ?: stringResource(R.string.status_live)
    }

    val fuels = PumpPrice.shownFor(fuelType)
    val fuel = fuels.firstOrNull()
    val rate = when (fuel) {
        PumpPrice.Fuel.DIESEL -> price?.diesel
        PumpPrice.Fuel.PETROL -> price?.petrol
        PumpPrice.Fuel.CNG -> price?.cng
        null -> null
    }
    val fuelLabel = stringResource(
        when (fuel) {
            PumpPrice.Fuel.DIESEL -> R.string.fuel_diesel
            PumpPrice.Fuel.PETROL -> R.string.fuel_petrol
            PumpPrice.Fuel.CNG -> R.string.fuel_cng
            null -> R.string.stat_fuel
        },
    )
    val fuelSub = when {
        fuel == null -> stringResource(R.string.rate_electric)
        price == null -> stringResource(R.string.rate_loading)
        rate == null -> stringResource(R.string.rate_none_here, price?.city.orEmpty())
        PumpPrice.unitOf(fuel) == PumpPrice.Unit.KILOGRAM -> stringResource(R.string.rate_per_kg, price?.city.orEmpty())
        else -> stringResource(R.string.rate_per_litre, price?.city.orEmpty())
    }

    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        StatTile(
            Lucide.creditCard, c.primarySoft, c.primary,
            stringResource(R.string.stat_fastag), fastagValue, fastagSub,
            valueColor = if (tag?.lowBalance == true) c.danger else c.fg,
            modifier = Modifier.weight(1f),
        )
        StatTile(
            Lucide.fuel, c.accentSoft, c.accent,
            fuelLabel, rate?.let { "₹%.2f".format(it) } ?: "–", fuelSub,
            modifier = Modifier.weight(1f),
        )
        StatTile(
            Lucide.timer, c.warningSoft, c.warning,
            stringResource(R.string.stat_today), DrivingHours.format(hours.todayMs), stringResource(R.string.stat_at_wheel),
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun StatTile(
    icon: String,
    well: Color,
    ink: Color,
    label: String,
    value: String,
    sub: String,
    modifier: Modifier = Modifier,
    valueColor: Color = Saarthi.colors.fg,
) {
    val c = Saarthi.colors
    Column(
        modifier
            .card()
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        IconWell(icon, well = well, ink = ink, size = 30.dp, radius = 10.dp, iconSize = 16.dp)
        Eyebrow(label, color = c.muted)
        Text(value, style = SType.headerTitle.copy(fontSize = 19.sp), color = valueColor, maxLines = 1)
        Text(sub, style = SType.caption, color = c.subtle, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * The job the fleet gave this vehicle.
 *
 * Where before how far; the route offered, never taken — pressing the button
 * draws it and stops; and a planned distance always says it is a plan.
 */
@Composable
internal fun DispatchSection(
    cockpit: TerminalViewModel,
    onRouted: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    val trip by cockpit.dispatch.collectAsState()
    val navigation by cockpit.navigation.collectAsState()
    val busy by cockpit.busy.collectAsState()
    val job = trip ?: return
    var problem by remember { mutableStateOf<String?>(null) }
    val noRoute = stringResource(R.string.dispatch_no_route)
    val planned = job.plannedDistanceKm

    Column(modifier, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(top = 10.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Text(stringResource(R.string.dispatch_title), style = SType.section, color = c.fg, modifier = Modifier.weight(1f))
            if (job.reference.isNotBlank()) {
                Text(job.reference, style = SType.mono(13.sp), color = c.muted)
            }
        }
        SaarthiCard(padding = androidx.compose.foundation.layout.PaddingValues(20.dp), spacing = 16.dp) {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                RouteMarkers(Modifier.padding(top = 4.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    if (job.originAddress.isNotBlank()) {
                        Column {
                            Eyebrow(stringResource(R.string.dispatch_from))
                            Text(job.originAddress, style = SType.rowTitle, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    Column {
                        Eyebrow(stringResource(R.string.dispatch_to))
                        Text(
                            job.destinationAddress.ifBlank { stringResource(R.string.dispatch_no_destination) },
                            style = SType.cardTitle.copy(fontSize = 17.sp, letterSpacing = (-0.01).em),
                            color = c.fg,
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                StatusPill(
                    stringResource(if (job.underway) R.string.trip_in_progress else R.string.trip_assigned),
                    background = if (job.underway) c.successBg else c.warningBg,
                    ink = if (job.underway) c.success else c.warning,
                    dot = false,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                FactBox(
                    stringResource(if (job.underway) R.string.dispatch_distance else R.string.dispatch_distance_planned),
                    (if (job.underway) job.actualDistanceKm else planned)?.let { "%,.0f km".format(it) } ?: "–",
                    Modifier.weight(1f),
                )
                FactBox(
                    stringResource(R.string.dispatch_stops),
                    job.stops.size.takeIf { it > 0 }?.toString() ?: "–",
                    Modifier.weight(1f),
                )
            }
            job.notes?.takeIf { it.isNotBlank() }?.let { note ->
                Text(
                    buildFleetNote(stringResource(R.string.dispatch_from_fleet), note, c.primary),
                    style = SType.body,
                    color = c.fg,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(c.primaryWash)
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                )
            }
            if (!job.assignedToSignedInDriver) {
                Text(stringResource(R.string.dispatch_other_driver), style = SType.small, color = c.warning)
            }
            problem?.let { Text(it, style = SType.small, color = c.warning) }
            // A route already on the map is the answer to this button.
            if (!navigation.active) {
                SaarthiButton(
                    stringResource(R.string.dispatch_show_way),
                    {
                        problem = null
                        cockpit.navigateToDispatch { worked -> if (worked) onRouted() else problem = noRoute }
                    },
                    busy = busy,
                    busyText = stringResource(R.string.dispatch_routing),
                    leading = Lucide.navigation,
                )
            }
        }
    }
}

private fun buildFleetNote(label: String, note: String, accent: Color) =
    androidx.compose.ui.text.buildAnnotatedString {
        pushStyle(
            androidx.compose.ui.text.SpanStyle(
                color = accent,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 0.08.em,
            ),
        )
        append(label.uppercase())
        append(" · ")
        pop()
        append(note)
    }

/** Origin ring, dashed line, destination square — the design's route rail. */
@Composable
private fun RouteMarkers(modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(modifier.width(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .size(12.dp)
                .clip(CircleShape)
                .background(c.card)
                .border(3.dp, c.primary, CircleShape),
        )
        Canvas(
            Modifier
                .padding(vertical = 6.dp)
                .width(2.dp)
                .heightIn(min = 42.dp)
                .height(52.dp),
        ) {
            drawLine(
                c.borderStrong,
                Offset(size.width / 2, 0f),
                Offset(size.width / 2, size.height),
                size.width,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 5.dp.toPx())),
            )
        }
        Box(
            Modifier
                .size(12.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(Brand.saffron),
        )
    }
}

@Composable
internal fun FactBox(label: String, value: String, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(c.sunken)
            .padding(12.dp),
    ) {
        Eyebrow(label)
        Text(value, style = SType.bodyStrong.copy(fontSize = 16.sp), color = c.fg, modifier = Modifier.padding(top = 2.dp))
    }
}

private class QuickAction(@StringRes val label: Int, val icon: String, val well: Color, val ink: Color, val go: () -> Unit)

/** Nearby, fuel slip, safety check, notices — four square tiles. */
@Composable
internal fun QuickActions(
    checkOutstanding: Boolean,
    actions: HomeActions,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    val items = listOf(
        QuickAction(R.string.home_action_nearby, Lucide.mapPin, c.primarySoft, c.primary, actions.openNearby),
        QuickAction(R.string.home_action_fuel, Lucide.receipt, c.accentSoft, c.accent, actions.openFuel),
        QuickAction(
            R.string.home_action_check,
            Lucide.shieldCheck,
            c.successSoft,
            c.success,
            if (checkOutstanding) actions.openCheck else actions.checkNotNeeded,
        ),
        QuickAction(R.string.home_action_notices, Lucide.bell, c.infoSoft, c.info, actions.openNotices),
    )
    // As tall as the longest label needs, and all four the same height.
    Row(modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        items.forEach { item ->
            Column(
                Modifier
                    .weight(1f)
                    .defaultMinSize(minHeight = 94.dp)
                    .fillMaxHeight()
                    .card()
                    .pressable(onClick = item.go)
                    .padding(horizontal = 4.dp, vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
            ) {
                IconWell(item.icon, well = item.well, ink = item.ink, size = 42.dp)
                Text(
                    stringResource(item.label),
                    style = SType.captionStrong.copy(lineHeight = 14.sp),
                    color = c.fg,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                )
            }
        }
    }
}

/**
 * The one thing to do next, and it takes a deliberate gesture when it moves
 * a truck: the safety check, "slide to start", or "slide to open the live view".
 */
@Composable
internal fun NextStepCard(state: TerminalState, actions: HomeActions, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    SaarthiCard(modifier, padding = androidx.compose.foundation.layout.PaddingValues(20.dp), spacing = 12.dp) {
        when {
            state.checklistOutstanding -> {
                StepTitle(Lucide.shield, c.warningSoft, c.warning, stringResource(R.string.before_drive_title))
                Text(stringResource(R.string.before_drive_body), style = SType.body, color = c.muted)
                Box(Modifier.shine(Color.White.copy(alpha = 0.22f))) {
                    SaarthiButton(stringResource(R.string.home_start_check), actions.openCheck)
                }
            }
            state == TerminalState.READY -> {
                StepTitle(Lucide.check, c.successSoft, c.success, stringResource(R.string.home_ready_title))
                Text(stringResource(R.string.home_ready_body), style = SType.body, color = c.muted)
                SlideToAct(stringResource(R.string.slide_start_trip), actions.startTrip)
            }
            state == TerminalState.TRIP_ACTIVE -> {
                StepTitle(Lucide.arrowRight, c.successSoft, c.success, stringResource(R.string.home_active_title))
                Text(stringResource(R.string.home_active_body), style = SType.body, color = c.muted)
                SlideToAct(stringResource(R.string.slide_open_live), actions.openMap)
            }
            else -> {
                Eyebrow(stringResource(R.string.home_next_step))
                Text(state.driverWord(), style = SType.cardTitle.copy(fontSize = 17.sp), color = c.fg)
                Text(
                    stringResource(
                        when {
                            state.waitingOnFleet -> R.string.next_step_awaiting
                            state.signedOnToVehicle -> R.string.next_step_blurb
                            else -> R.string.next_step_reconnect
                        },
                    ),
                    style = SType.body,
                    color = c.muted,
                )
            }
        }
    }
}

@Composable
private fun StepTitle(icon: String, well: Color, ink: Color, title: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        IconWell(icon, well = well, ink = ink, size = 32.dp, shape = CircleShape, iconSize = 16.dp, stroke = 2.4f)
        Text(title, style = SType.cardTitle.copy(fontSize = 17.sp), color = Saarthi.colors.fg)
    }
}

/** A light sweeping across a button every few seconds — the design's `.hm-shine`. */
@Composable
private fun Modifier.shine(color: Color): Modifier {
    val sweep by rememberLoop(2_800, Ease.standard, rest = -1f, label = "shine")
    return this
        .clip(RoundedCornerShape(16.dp))
        .drawWithContent {
            drawContent()
            // Across the first 60% of the cycle, then a rest before the next pass.
            val t = (sweep / 0.6f)
            if (sweep < 0f || t > 1f) return@drawWithContent
            val band = size.width * 0.4f
            val x = -band + (size.width * 1.2f + band) * t
            drawRect(Brush.horizontalGradient(listOf(Color.Transparent, color, Color.Transparent), startX = x, endX = x + band))
        }
}
