package com.saarthi.driver.ui.shift.assistant

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.center
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import com.saarthi.core.domain.AssistantState
import com.saarthi.driver.ui.design.Brand
import com.saarthi.driver.ui.design.DarkPalette
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.LightPalette
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.rememberLoop

/**
 * Saarthi, as the design draws it: three soft shapes over one another, each
 * slowly changing its outline and turning.
 *
 * The outer one quickens while Saarthi listens and quickens again while it
 * thinks — the only layer the design speeds up — and swells a little with the
 * driver's voice. Its motion is accumulated frame by frame rather than looped,
 * so a change of pace never makes the shape jump. Still under reduced motion.
 */
@Composable
internal fun SaarthiBlob(state: AssistantState, amplitude: Float, modifier: Modifier = Modifier) {
    val clock = rememberBlobClock(state)
    val swell by animateFloatAsState(
        if (state == AssistantState.LISTENING && !Saarthi.reducedMotion) amplitude.coerceIn(0f, 1f) else 0f,
        tween(150),
        label = "blob-swell",
    )
    Box(
        modifier
            .size(150.dp)
            .graphicsLayer {
                val scale = 1f + 0.06f * swell
                scaleX = scale
                scaleY = scale
            },
    ) {
        // Blurred as the design blurs it; Android draws the blur from 12 on, a crisp edge before.
        Spacer(
            Modifier
                .matchParentSize()
                .blur(10.dp, BlurredEdgeTreatment.Unbounded)
                .drawWithCache {
                    val path = Path()
                    val radii = FloatArray(8)
                    val brush = Brush.sweepGradient(OuterColors, size.center)
                    onDrawBehind { drawLayer(path, radii, inset = 0f, clock.outerMorph, clock.outerSpin, brush) }
                },
        )
        Spacer(
            Modifier
                .matchParentSize()
                .drawWithCache {
                    val path = Path()
                    val radii = FloatArray(8)
                    val middle = Brush.sweepGradient(MiddleColors, size.center)
                    val innerInset = 26.dp.toPx()
                    val innerSide = size.width - innerInset * 2
                    val inner = Brush.radialGradient(
                        0f to Color.White,
                        0.3f to Color.White.copy(alpha = 0.3f),
                        0.7f to DarkPalette.primary.copy(alpha = 0.2f),
                        center = Offset(innerInset + innerSide * 0.35f, innerInset + innerSide * 0.3f),
                        radius = innerSide * FARTHEST_CORNER,
                    )
                    onDrawBehind {
                        // The middle layer runs backwards, outline and turn alike.
                        val middlePhase = clock.seconds / MIDDLE_MORPH_S % 1f
                        val middleTurn = clock.seconds / MIDDLE_SPIN_S % 1f
                        drawLayer(path, radii, 10.dp.toPx(), 1f - middlePhase, -middleTurn, middle, alpha = 0.8f)
                        drawLayer(
                            path,
                            radii,
                            innerInset,
                            clock.seconds / INNER_MORPH_S % 1f,
                            clock.seconds / INNER_SPIN_S % 1f,
                            inner,
                            alpha = 0.9f,
                        )
                    }
                },
        )
    }
}

/** Five bars rising and falling in turn, reaching higher the louder the driver speaks. */
@Composable
internal fun ListeningBars(amplitude: Float, modifier: Modifier = Modifier) {
    val phase by rememberLoop(1_000, label = "assistant-eq", rest = 0.5f)
    val level by animateFloatAsState(0.35f + 0.65f * amplitude.coerceIn(0f, 1f), tween(150), label = "assistant-eq-level")
    Canvas(modifier.size(width = 45.dp, height = 36.dp)) {
        val bar = 5.dp.toPx()
        val gap = 5.dp.toPx()
        val low = 8.dp.toPx()
        val high = 34.dp.toPx()
        repeat(BARS) { index ->
            val wave = bounce(phase - index * 0.1f)
            val height = low + (high - low) * wave * level
            drawRoundRect(
                Color.White,
                topLeft = Offset(index * (bar + gap), (size.height - height) / 2f),
                size = Size(bar, height),
                cornerRadius = CornerRadius(bar / 2f),
            )
        }
    }
}

/** Three dots hopping in turn while Saarthi works on an answer. */
@Composable
internal fun ThinkingDots(modifier: Modifier = Modifier) {
    val dot = Saarthi.colors.muted
    val phase by rememberLoop(1_200, label = "assistant-dots", rest = 0.5f)
    Canvas(modifier.size(width = 42.dp, height = 20.dp)) {
        val radius = 4.dp.toPx()
        val step = 14.dp.toPx()
        val lift = 6.dp.toPx()
        repeat(DOTS) { index ->
            val hop = bounce(phase - index * 0.125f)
            drawCircle(
                dot.copy(alpha = 0.4f + 0.6f * hop),
                radius,
                Offset(step * index + step / 2f, size.height - radius - lift * hop),
            )
        }
    }
}

/** Up and back down over one period, eased at both ends — the design's 0% / 50% / 100% keyframes. */
private fun bounce(phase: Float): Float {
    val local = (phase % 1f + 1f) % 1f
    return Ease.inOut.transform(if (local < 0.5f) local * 2f else (1f - local) * 2f)
}

/** Seconds on screen, and the outer layer's outline and turn, advanced a frame at a time. */
private class BlobClock {
    var seconds by mutableFloatStateOf(0f)
        private set
    var outerMorph by mutableFloatStateOf(0f)
        private set
    var outerSpin by mutableFloatStateOf(0f)
        private set

    fun advance(dt: Float, state: AssistantState) {
        val (morphS, spinS) = when (state) {
            AssistantState.LISTENING -> 2.2f to 6f
            AssistantState.THINKING -> 1.4f to 2.4f
            else -> 7f to 12f
        }
        seconds += dt
        outerMorph = (outerMorph + dt / morphS) % 1f
        outerSpin = (outerSpin + dt / spinS) % 1f
    }
}

@Composable
private fun rememberBlobClock(state: AssistantState): BlobClock {
    val clock = remember { BlobClock() }
    val current by rememberUpdatedState(state)
    val reduced = Saarthi.reducedMotion
    LaunchedEffect(reduced) {
        if (reduced) return@LaunchedEffect
        var last = withFrameNanos { it }
        while (true) {
            withFrameNanos { now ->
                clock.advance((now - last) / 1_000_000_000f, current)
                last = now
            }
        }
    }
    return clock
}

/** One layer: its outline at [morph] through the keyframes, turned [turns] of a circle. */
private fun DrawScope.drawLayer(
    path: Path,
    radii: FloatArray,
    inset: Float,
    morph: Float,
    turns: Float,
    brush: Brush,
    alpha: Float = 1f,
) {
    morphRadii(morph, radii)
    path.blobOutline(inset, size.width - inset * 2, size.height - inset * 2, radii)
    rotate(turns * 360f) { drawPath(path, brush, alpha = alpha) }
}

/**
 * The design's `asmorph` keyframes — CSS `border-radius: a b c d / e f g h`,
 * as fractions of the side: horizontal radii clockwise from top-left, then
 * vertical radii in the same order.
 */
private val Keyframes = arrayOf(
    floatArrayOf(0.42f, 0.58f, 0.63f, 0.37f, 0.41f, 0.44f, 0.56f, 0.59f),
    floatArrayOf(0.61f, 0.39f, 0.45f, 0.55f, 0.60f, 0.38f, 0.62f, 0.40f),
    floatArrayOf(0.36f, 0.64f, 0.52f, 0.48f, 0.44f, 0.62f, 0.38f, 0.56f),
)

private fun morphRadii(progress: Float, out: FloatArray) {
    val position = progress.coerceIn(0f, 1f) * Keyframes.size
    val index = position.toInt() % Keyframes.size
    val t = Ease.inOut.transform(position - position.toInt())
    val from = Keyframes[index]
    val to = Keyframes[(index + 1) % Keyframes.size]
    for (k in out.indices) out[k] = from[k] + (to[k] - from[k]) * t
}

/** Four elliptical corners meeting edge to edge, as the browser draws those radii. */
private fun Path.blobOutline(inset: Float, w: Float, h: Float, r: FloatArray) {
    val tlx = r[0] * w
    val trx = r[1] * w
    val brx = r[2] * w
    val blx = r[3] * w
    val tly = r[4] * h
    val tRy = r[5] * h
    val bry = r[6] * h
    val bly = r[7] * h
    val left = inset
    val top = inset
    val right = inset + w
    val bottom = inset + h
    reset()
    moveTo(left + tlx, top)
    lineTo(right - trx, top)
    cubicTo(right - trx + trx * K, top, right, top + tRy - tRy * K, right, top + tRy)
    lineTo(right, bottom - bry)
    cubicTo(right, bottom - bry + bry * K, right - brx + brx * K, bottom, right - brx, bottom)
    lineTo(left + blx, bottom)
    cubicTo(left + blx - blx * K, bottom, left, bottom - bly + bly * K, left, bottom - bly)
    lineTo(left, top + tly)
    cubicTo(left, top + tly - tly * K, left + tlx - tlx * K, top, left + tlx, top)
    close()
}

/** The cubic that best follows a quarter ellipse. */
private const val K = 0.5523f

/** `radial-gradient(circle at 35% 30%)` reaches its farthest corner at this multiple of the side. */
private const val FARTHEST_CORNER = 0.955f

private const val MIDDLE_MORPH_S = 9f
private const val MIDDLE_SPIN_S = 16f
private const val INNER_MORPH_S = 5f
private const val INNER_SPIN_S = 10f
private const val BARS = 5
private const val DOTS = 3

private val OuterColors = listOf(LightPalette.primary, DarkPalette.primary, Brand.saffron, Brand.green, LightPalette.primary)
private val MiddleColors = listOf(DarkPalette.primary, Brand.saffron, Color(0xFF86ABF2), DarkPalette.primary)
