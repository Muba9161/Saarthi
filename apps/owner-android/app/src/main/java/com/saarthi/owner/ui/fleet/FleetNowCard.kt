package com.saarthi.owner.ui.fleet

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.ui.design.Brand
import com.saarthi.owner.ui.design.Ease
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.brandGradient
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.design.rememberLoop
import kotlin.math.roundToInt

/**
 * The road, on the driver app's 350 × 230 grid — kept to the right half, so
 * the fleet's numbers on the left never have a line running through them.
 */
private fun fleetRoute(w: Float, h: Float): Path {
    val sx = w / 350f
    val sy = h / 230f
    return Path().apply {
        moveTo(176f * sx, 244f * sy)
        cubicTo(220f * sx, 206f * sy, 214f * sx, 156f * sy, 262f * sx, 142f * sy)
        cubicTo(312f * sx, 128f * sy, 318f * sx, 98f * sy, 362f * sx, 94f * sy)
    }
}

/**
 * "Fleet right now" — the driver app's tracking card, for a whole fleet.
 *
 * The road draws itself in, a truck rides it with a halo pulsing out of it,
 * and the arrow on "Open map" nudges — the same brand panel a driver sees,
 * with the fleet's numbers as the headline. The whole card opens the map when
 * there is one to open.
 */
@Composable
fun FleetNowCard(home: FleetHome, modifier: Modifier = Modifier, onOpenMap: (() -> Unit)? = null) {
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
    val halo by rememberLoop(2_000, Ease.out, rest = 0f, label = "fleet-halo")
    val nudge by rememberLoop(900, Ease.standard, reverse = true, rest = 0f, label = "open-map-nudge")

    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .height(230.dp)
            .shadow(20.dp, shape, spotColor = Color(0xBF021D40), ambientColor = Color.Transparent)
            .brandGradient(shape)
            .then(if (onOpenMap != null) Modifier.pressable(scale = 0.97f, onClick = onOpenMap) else Modifier),
    ) {
        val density = LocalDensity.current
        val w = with(density) { maxWidth.toPx() }
        val h = with(density) { maxHeight.toPx() }
        val route = remember(w, h) { fleetRoute(w, h) }
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
            val end = Offset(340f * sx, 95f * sy)
            drawCircle(Brand.saffron, 6.dp.toPx(), end)
            drawCircle(Color.White, 2.5.dp.toPx(), end)
        }

        // A truck, riding the road.
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
                Eyebrow("Fleet right now", Modifier.weight(1f), color = Color.White.copy(alpha = 0.72f))
                StatusPill(
                    "${home.moving} moving",
                    background = Color.White.copy(alpha = 0.14f),
                    ink = Color.White,
                    dotColor = Brand.live,
                    live = home.moving > 0,
                    ring = Color.White.copy(alpha = 0.18f),
                )
            }
            Column(Modifier.fillMaxWidth(0.62f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(
                        home.onTrip.toString(),
                        style = SType.figure.copy(
                            fontSize = 52.sp,
                            lineHeight = 54.sp,
                            fontWeight = FontWeight.Bold,
                            shadow = Shadow(Color(0x99021D40), Offset(0f, 4f), 28f),
                        ),
                        color = Color.White,
                    )
                    Text(
                        " / ${home.total}",
                        style = SType.headerTitle.copy(fontSize = 22.sp),
                        color = Color.White.copy(alpha = 0.86f),
                        maxLines = 1,
                        modifier = Modifier.padding(bottom = 7.dp),
                    )
                }
                Text("on the road", style = SType.bodyStrong, color = Color.White)
                Text(
                    "${home.idle} idle · ${home.offline} offline",
                    style = SType.small,
                    color = Color.White.copy(alpha = 0.72f),
                )
                if (onOpenMap != null) {
                    Row(
                        Modifier
                            .padding(top = 6.dp)
                            .height(38.dp)
                            .clip(CircleShape)
                            .background(Color.White)
                            .padding(horizontal = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text("Open map", style = SType.smallStrong, color = Brand.navy)
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
