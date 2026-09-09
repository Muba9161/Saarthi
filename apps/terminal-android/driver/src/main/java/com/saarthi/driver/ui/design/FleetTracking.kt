package com.saarthi.driver.ui.design

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.KeyboardDoubleArrowRight
import androidx.compose.material.icons.rounded.LocalShipping
import androidx.compose.material.icons.rounded.LocationOn
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.res.stringResource
import com.saarthi.driver.R
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.core.ui.LocalReducedMotion

/**
 * The parts that make this a haulage app rather than a form.
 *
 * A registration number, a route, a place a vehicle is and a place it is going.
 * These are the four things a driver actually looks for, and each one has a
 * single component here so that it looks and reads the same on every screen it
 * appears on.
 */

/**
 * A code, set so it cannot be misread.
 *
 * Registration numbers, tracking references, pairing codes. Monospaced and
 * widely tracked, because the failure this prevents is specific and expensive:
 * a driver reading `RIG0OO1` as `RIG0001` and walking to the wrong vehicle.
 *
 * The accessibility label spells the code out character by character, so a
 * screen reader does not pronounce it as a word.
 */
@Composable
fun TrackingCode(
    code: String,
    modifier: Modifier = Modifier,
    tint: Color = Chalk,
    size: androidx.compose.ui.unit.TextUnit = 28.sp,
) {
    Text(
        text = code,
        modifier = modifier.semantics {
            contentDescription = code.map { it }.joinToString(" ")
        },
        fontFamily = FleetMono,
        fontWeight = FontWeight.Bold,
        fontSize = size,
        letterSpacing = 1.sp,
        color = tint,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * A route, drawn rather than mapped.
 *
 * Used where a real map would cost a tile download and tell the driver nothing
 * they do not already know — the summary card on the home screen, the waiting
 * screen. It is deliberately abstract: a line with a lit node on it, which
 * reads as "a journey, in progress" without pretending to be geography it does
 * not have.
 *
 * The line draws itself in once, left to right, which is the direction of
 * travel. Under reduced motion it is simply there.
 */
@Composable
fun RouteSpark(
    modifier: Modifier = Modifier,
    tint: Color = Ember,
    nodeAt: Float = 0.62f,
    active: Boolean = true,
) {
    val reducedMotion = LocalReducedMotion.current
    var started by remember { mutableStateOf(reducedMotion) }
    LaunchedEffect(Unit) { started = true }

    val drawn by animateFloatAsState(
        targetValue = if (started) 1f else 0f,
        animationSpec = FleetMotion.enter(stillOr(1_100)),
        label = "route-draw",
    )
    val breath by rememberBreath(2_200, restingAt = 0.7f)

    Canvas(modifier.clearAndSetSemantics { }) {
        val w = size.width
        val h = size.height

        // The faint street grid underneath. Abstract, low contrast, and never
        // straight for long — a perfect grid reads as graph paper rather than
        // as a place.
        val lane = Hairline.copy(alpha = 0.5f)
        drawLine(lane, Offset(0f, h * 0.22f), Offset(w, h * 0.30f), strokeWidth = 1f)
        drawLine(lane, Offset(0f, h * 0.74f), Offset(w, h * 0.66f), strokeWidth = 1f)
        drawLine(lane, Offset(w * 0.24f, 0f), Offset(w * 0.30f, h), strokeWidth = 1f)
        drawLine(lane, Offset(w * 0.78f, 0f), Offset(w * 0.70f, h), strokeWidth = 1f)

        // The route itself: one continuous curve across the card.
        val route = Path().apply {
            moveTo(w * 0.02f, h * 0.86f)
            cubicTo(w * 0.26f, h * 0.86f, w * 0.24f, h * 0.42f, w * 0.48f, h * 0.44f)
            cubicTo(w * 0.72f, h * 0.46f, w * 0.66f, h * 0.12f, w * 0.98f, h * 0.14f)
        }

        val measure = PathMeasure().apply { setPath(route, false) }
        val length = measure.length
        val visible = Path()
        measure.getSegment(0f, length * drawn, visible, true)

        // A soft wide pass under a hard narrow one: the cheap way to a glow
        // that survives on an OLED panel without a blur pass.
        drawPath(
            visible,
            color = tint.copy(alpha = 0.18f),
            style = Stroke(width = 12f, cap = StrokeCap.Round),
        )
        drawPath(
            visible,
            color = tint,
            style = Stroke(width = 4f, cap = StrokeCap.Round),
        )

        // Where the vehicle is. Only drawn once the line has reached it, so the
        // marker never sits ahead of its own route.
        if (drawn >= nodeAt) {
            val at = measure.getPosition(length * nodeAt)
            val halo = if (active) 16f + breath * 8f else 14f
            drawCircle(tint.copy(alpha = 0.22f), radius = halo, center = at)
            drawCircle(Obsidian, radius = 8f, center = at)
            drawCircle(tint, radius = 5f, center = at)
        }
    }
}

/**
 * A dark basemap, for a screen that needs the *feeling* of a map.
 *
 * Not a substitute for the real one — the cockpit runs MapLibre and always
 * will. This is what sits behind a waiting or approval screen, where showing a
 * live map would imply a trip that has not started.
 */
@Composable
fun MapBackdrop(
    modifier: Modifier = Modifier,
    routeTint: Color = Ember,
) {
    Canvas(modifier.clearAndSetSemantics { }) {
        val w = size.width
        val h = size.height

        drawRect(
            Brush.verticalGradient(listOf(Color(0xFF141518), Color(0xFF0C0D10))),
            size = Size(w, h),
        )

        val major = Color(0xFF23262C)
        val minor = Color(0xFF191B1F)

        // Minor streets: a loose grid, off-axis so it does not read as a table.
        for (i in 1..7) {
            val y = h * (i / 8f)
            drawLine(minor, Offset(0f, y + w * 0.01f), Offset(w, y - w * 0.01f), strokeWidth = 1.5f)
        }
        for (i in 1..5) {
            val x = w * (i / 6f)
            drawLine(minor, Offset(x - h * 0.01f, 0f), Offset(x + h * 0.01f, h), strokeWidth = 1.5f)
        }

        // Two arterial roads, wider and lighter, to give the eye somewhere to
        // rest — a uniform grid at one weight is visual noise.
        drawLine(major, Offset(0f, h * 0.38f), Offset(w, h * 0.30f), strokeWidth = 5f)
        drawLine(major, Offset(w * 0.62f, 0f), Offset(w * 0.54f, h), strokeWidth = 5f)

        val route = Path().apply {
            moveTo(w * 0.08f, h * 0.92f)
            cubicTo(w * 0.36f, h * 0.86f, w * 0.30f, h * 0.50f, w * 0.56f, h * 0.46f)
            cubicTo(w * 0.84f, h * 0.42f, w * 0.74f, h * 0.16f, w * 0.94f, h * 0.08f)
        }
        drawPath(route, routeTint.copy(alpha = 0.22f), style = Stroke(width = 16f, cap = StrokeCap.Round))
        drawPath(route, routeTint, style = Stroke(width = 5f, cap = StrokeCap.Round))
    }
}

/**
 * The vehicle, on a map.
 *
 * A ring that breathes around a solid orange disc. The ring is the only thing
 * that moves, and it is what separates "this is where the vehicle is" from
 * "this is where the vehicle was when the screen loaded".
 */
@Composable
fun TruckMarker(
    modifier: Modifier = Modifier,
    size: Dp = 64.dp,
    icon: ImageVector = Icons.Rounded.LocalShipping,
    live: Boolean = true,
) {
    val breath by rememberBreath(2_000, restingAt = 0.5f)
    val ring = if (live) 0.25f + breath * 0.35f else 0.3f

    Box(
        modifier.size(size),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val r = this.size.minDimension / 2f
            drawCircle(Ember.copy(alpha = ring * 0.35f), radius = r)
            drawCircle(
                Ember.copy(alpha = ring),
                radius = r * 0.82f,
                style = Stroke(width = 3f),
            )
        }
        Box(
            Modifier
                .size(size * 0.62f)
                .clip(CircleShape)
                .background(EmberGradient),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon,
                contentDescription = "Vehicle position",
                tint = Color.White,
                modifier = Modifier.size(size * 0.32f),
            )
        }
    }
}

/**
 * A place, with its icon and its label.
 *
 * The smallest unit of "where". Used on both grounds — dark cards and orange
 * ones — so the tints are parameters rather than being read from the scheme.
 */
@Composable
fun PlaceLine(
    place: String,
    modifier: Modifier = Modifier,
    icon: ImageVector = Icons.Rounded.LocationOn,
    tint: Color = Chalk,
) {
    Row(
        modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(15.dp))
        Text(
            place,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = tint,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** One stop on a [RouteTimeline]. */
data class RouteStop(
    val label: String,
    val place: String,
    val tint: Color,
    val detail: String? = null,
)

/**
 * The stops of a journey, down the page.
 *
 * A coloured dot per stop with a dashed run between them. Dashed rather than
 * solid on purpose: a solid rule between two addresses reads as a table border,
 * and this is a distance that has not been travelled yet.
 *
 * The dots differ in colour *and* in position and label, never in colour alone.
 */
@Composable
fun RouteTimeline(
    stops: List<RouteStop>,
    modifier: Modifier = Modifier,
    rowHeight: Dp = 64.dp,
) {
    Column(modifier.fillMaxWidth()) {
        stops.forEachIndexed { index, stop ->
            val last = index == stops.lastIndex

            Row(Modifier.fillMaxWidth()) {
                // The rail: dot, then a dashed run down to the next dot.
                Canvas(
                    Modifier
                        .width(20.dp)
                        .height(if (last) 26.dp else rowHeight),
                ) {
                    val cx = size.width / 2f
                    val cy = 9.dp.toPx()

                    if (!last) {
                        drawLine(
                            color = Hairline,
                            start = Offset(cx, cy + 10.dp.toPx()),
                            end = Offset(cx, size.height),
                            strokeWidth = 2f,
                            pathEffect = PathEffect.dashPathEffect(
                                floatArrayOf(4.dp.toPx(), 5.dp.toPx()),
                                0f,
                            ),
                        )
                    }

                    drawCircle(stop.tint.copy(alpha = 0.22f), radius = 9.dp.toPx(), center = Offset(cx, cy))
                    drawCircle(stop.tint, radius = 4.5f.dp.toPx(), center = Offset(cx, cy))
                }

                Spacer(Modifier.width(FleetSpace.snug))

                Column(Modifier.weight(1f)) {
                    FieldLabel(stop.label)
                    Spacer(Modifier.height(3.dp))
                    Text(
                        stop.place,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = Chalk,
                    )
                    if (stop.detail != null) {
                        Text(
                            stop.detail,
                            style = MaterialTheme.typography.bodySmall,
                            color = Ash,
                        )
                    }
                }
            }
        }
    }
}

/**
 * The summary card: what is happening right now.
 *
 * The home screen's centrepiece. A drawn route behind, the code over it, and
 * the two facts a driver checks before anything else — where the vehicle is and
 * what state it is in.
 */
@Composable
fun CurrentTrackingCard(
    code: String,
    detailLabel: String,
    detailValue: String,
    statusLabel: String,
    modifier: Modifier = Modifier,
    statusTint: Color = LiveGreen,
    live: Boolean = true,
    onClick: (() -> Unit)? = null,
) {
    val shape = RoundedCornerShape(FleetRadius.card)

    Box(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Onyx)
            .border(1.dp, Hairline, shape)
            .let { if (onClick != null) it.pressable(onClick = onClick) else it },
    ) {
        RouteSpark(
            modifier = Modifier
                .fillMaxWidth()
                .height(150.dp)
                .align(Alignment.TopEnd),
            active = live,
        )

        /*
         * A scrim under the type, weighted towards the type.
         *
         * Two separate faults put the route's brightest stretch straight through
         * the registration, and on a real handset the vehicle marker landed on
         * the final digit.
         *
         * The first was `Modifier.fillMaxSize()`. This card sits in a scrolling
         * column, so it is measured with an unbounded height, and `fillMaxSize`
         * against an infinite constraint resolves to wrap-content - which for an
         * empty Box is nothing at all. The scrim was never painting.
         * `matchParentSize` is the Box-scoped modifier that takes the parent's
         * *resolved* size without joining in the measurement, which is what was
         * meant all along.
         *
         * The second was starting fully transparent, so even once it painted it
         * would not have covered the type. The route is decoration; the
         * registration is the one thing on this card a driver checks against the
         * truck in front of them, so it wins - with enough of the line surviving
         * at the top to keep the card feeling like a map rather than a panel.
         */
        Box(
            Modifier
                .matchParentSize()
                .background(
                    Brush.verticalGradient(
                        0f to Onyx.copy(alpha = 0.30f),
                        0.30f to Onyx.copy(alpha = 0.90f),
                        0.55f to Onyx.copy(alpha = 0.97f),
                        1f to Onyx,
                    ),
                ),
        )

        Column(Modifier.padding(FleetSpace.roomy)) {
            FieldLabel(stringResource(R.string.label_current_tracking))
            Spacer(Modifier.height(FleetSpace.tight))
            TrackingCode(code, size = 30.sp)

            Spacer(Modifier.height(FleetSpace.roomy))

            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Bottom,
            ) {
                Column(Modifier.weight(1f)) {
                    FieldLabel(detailLabel)
                    Spacer(Modifier.height(FleetSpace.hair))
                    PlaceLine(place = detailValue, tint = Chalk)
                }
                Column(horizontalAlignment = Alignment.End) {
                    FieldLabel(stringResource(R.string.label_status))
                    Spacer(Modifier.height(FleetSpace.hair))
                    StatusPill(statusLabel, tint = statusTint, live = live)
                }
            }
        }
    }
}
