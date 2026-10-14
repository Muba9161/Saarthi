package com.saarthi.owner.ui.assistant

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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.saarthi.owner.ui.design.Brand
import com.saarthi.owner.ui.design.DarkPalette
import com.saarthi.owner.ui.design.Ease
import com.saarthi.owner.ui.design.LightPalette
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.rememberLoop
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random
import kotlinx.coroutines.delay

/** Where a spoken question is: waiting, being heard, being answered, being read out. */
enum class VoiceState { IDLE, LISTENING, THINKING, SPEAKING }

/**
 * Saarthi, as the design draws it: three soft shapes over one another, each
 * slowly turning — and alive: their outlines ripple all the time, like
 * something breathing, never settling back into a circle.
 *
 * The shapes answer to a voice. While Saarthi listens, the person's own
 * loudness swells the outer one and stirs the ripples; while it speaks, a
 * speech-like rhythm does the same, so the blob seems to talk. Thinking
 * quickens it. Motion is accumulated frame by frame rather than looped, so a
 * change of pace never makes the shape jump. Still under reduced motion.
 */
@Composable
fun SaarthiBlob(state: VoiceState, amplitude: Float, modifier: Modifier = Modifier, diameter: Dp = 150.dp) {
    val reduced = Saarthi.reducedMotion
    val speech = rememberSpeechRhythm(active = state == VoiceState.SPEAKING && !reduced)
    val target = when {
        reduced -> 0f
        state == VoiceState.LISTENING -> amplitude
        state == VoiceState.SPEAKING -> speech
        else -> 0f
    }.coerceIn(0f, 1f)
    val voice by animateFloatAsState(target, tween(110), label = "blob-voice")
    val clock = rememberBlobClock(state, voice)
    Box(
        modifier
            .size(diameter)
            .graphicsLayer {
                val scale = 1f + 0.08f * voice
                scaleX = scale
                scaleY = scale
            },
    ) {
        // Blurred as the design blurs it; Android draws the blur from 12 on, a crisp edge before.
        Spacer(
            Modifier
                .matchParentSize()
                .blur(diameter * BLUR_SHARE, BlurredEdgeTreatment.Unbounded)
                .drawWithCache {
                    val path = Path()
                    val brush = Brush.sweepGradient(OuterColors, size.center)
                    onDrawBehind {
                        drawLayer(path, inset = 0f, clock.outerPhase, clock.outerTurn, clock.outerDepth, seed = 0f, brush)
                    }
                },
        )
        Spacer(
            Modifier
                .matchParentSize()
                .drawWithCache {
                    val path = Path()
                    val middle = Brush.sweepGradient(MiddleColors, size.center)
                    val innerInset = size.width * INNER_INSET_SHARE
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
                        drawLayer(path, size.width * MIDDLE_INSET_SHARE, -clock.middlePhase, -clock.middleTurn, clock.middleDepth, seed = 1.7f, middle, alpha = 0.8f)
                        drawLayer(path, innerInset, clock.innerPhase, clock.innerTurn, clock.innerDepth, seed = 3.1f, inner, alpha = 0.9f)
                    }
                },
        )
    }
}

/** Five bars rising and falling in turn, reaching higher the louder the driver speaks. */
@Composable
fun ListeningBars(amplitude: Float, modifier: Modifier = Modifier) {
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
fun ThinkingDots(modifier: Modifier = Modifier) {
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

/**
 * How far along each layer's ripple and turn is, and how deep its ripples
 * run — advanced a frame at a time from the state and the voice, so speeding
 * up or slowing down never makes the shape jump.
 */
private class BlobClock {
    var outerPhase by mutableFloatStateOf(0f)
        private set
    var outerTurn by mutableFloatStateOf(0f)
        private set
    var middlePhase by mutableFloatStateOf(0f)
        private set
    var middleTurn by mutableFloatStateOf(0f)
        private set
    var innerPhase by mutableFloatStateOf(0f)
        private set
    var innerTurn by mutableFloatStateOf(0f)
        private set
    var outerDepth by mutableFloatStateOf(BASE_DEPTH)
        private set
    var middleDepth by mutableFloatStateOf(BASE_DEPTH)
        private set
    var innerDepth by mutableFloatStateOf(BASE_DEPTH)
        private set

    fun advance(dt: Float, state: VoiceState, voice: Float) {
        // Ripples per second and turns per second, quickest while thinking.
        val (ripple, turn) = when (state) {
            VoiceState.LISTENING -> 0.42f to 0.16f
            VoiceState.THINKING -> 0.7f to 0.42f
            VoiceState.SPEAKING -> 0.36f to 0.12f
            else -> 0.15f to 0.08f
        }
        // A louder voice stirs the ripples faster as well as deeper.
        val stir = 1f + 1.4f * voice
        outerPhase = (outerPhase + dt * ripple * stir) % 1f
        outerTurn = (outerTurn + dt * turn) % 1f
        middlePhase = (middlePhase + dt * ripple * 0.7f * stir) % 1f
        middleTurn = (middleTurn + dt / MIDDLE_SPIN_S) % 1f
        innerPhase = (innerPhase + dt * ripple * 1.3f) % 1f
        innerTurn = (innerTurn + dt / INNER_SPIN_S) % 1f

        val rest = when (state) {
            VoiceState.THINKING -> BASE_DEPTH + 0.04f
            VoiceState.LISTENING, VoiceState.SPEAKING -> BASE_DEPTH + 0.02f
            else -> BASE_DEPTH
        }
        // Depth eases toward its target, the outer layer answering the voice the most.
        val ease = (dt * 9f).coerceAtMost(1f)
        outerDepth += (rest + VOICE_DEPTH * voice - outerDepth) * ease
        middleDepth += (rest + VOICE_DEPTH * 0.6f * voice - middleDepth) * ease
        innerDepth += (rest * 0.8f + VOICE_DEPTH * 0.35f * voice - innerDepth) * ease
    }
}

@Composable
private fun rememberBlobClock(state: VoiceState, voice: Float): BlobClock {
    val clock = remember { BlobClock() }
    val currentState by rememberUpdatedState(state)
    val currentVoice by rememberUpdatedState(voice)
    val reduced = Saarthi.reducedMotion
    LaunchedEffect(reduced) {
        if (reduced) return@LaunchedEffect
        var last = withFrameNanos { it }
        while (true) {
            withFrameNanos { now ->
                clock.advance(((now - last) / 1_000_000_000f).coerceAtMost(0.1f), currentState, currentVoice)
                last = now
            }
        }
    }
    return clock
}

/**
 * Something like Saarthi's voice while it talks: syllables of varying
 * loudness, with the odd pause between phrases. The words come from the
 * phone's speech engine, which says nothing of how loud it is, so the shape
 * follows this rhythm instead.
 */
@Composable
private fun rememberSpeechRhythm(active: Boolean): Float {
    var level by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(active) {
        if (!active) {
            level = 0f
            return@LaunchedEffect
        }
        val random = Random(System.nanoTime())
        while (true) {
            val pause = random.nextFloat() < 0.14f
            level = if (pause) 0.08f else 0.35f + random.nextFloat() * 0.65f
            delay(if (pause) 260L + random.nextLong(220) else 110L + random.nextLong(150))
        }
    }
    return level
}

/** One layer: its rippling outline at [phase], turned [turns] of a circle. */
private fun DrawScope.drawLayer(
    path: Path,
    inset: Float,
    phase: Float,
    turns: Float,
    depth: Float,
    seed: Float,
    brush: Brush,
    alpha: Float = 1f,
) {
    path.ripplingOutline(size.width / 2f, size.height / 2f, size.minDimension / 2f - inset, phase, depth, seed)
    rotate(turns * 360f) { drawPath(path, brush, alpha = alpha) }
}

/**
 * A closed, smooth outline whose radius rises and falls around the circle:
 * three waves of different lengths, each travelling at its own pace, so the
 * shape never repeats itself. [depth] is how far it strays from round.
 */
private fun Path.ripplingOutline(cx: Float, cy: Float, radius: Float, phase: Float, depth: Float, seed: Float) {
    val turn = phase * TAU
    val xs = FloatArray(POINTS)
    val ys = FloatArray(POINTS)
    for (i in 0 until POINTS) {
        val angle = TAU * i / POINTS
        val wobble = 0.55f * sin(2f * angle + turn + seed) +
            0.3f * sin(3f * angle - 1.3f * turn + seed * 2f) +
            0.15f * sin(5f * angle + 2.1f * turn + seed * 3f)
        val r = radius * (1f + depth * wobble)
        xs[i] = cx + r * cos(angle)
        ys[i] = cy + r * sin(angle)
    }
    reset()
    // Through the midpoints, curving at each sample: smooth all the way round.
    moveTo((xs[POINTS - 1] + xs[0]) / 2f, (ys[POINTS - 1] + ys[0]) / 2f)
    for (i in 0 until POINTS) {
        val next = (i + 1) % POINTS
        quadraticTo(xs[i], ys[i], (xs[i] + xs[next]) / 2f, (ys[i] + ys[next]) / 2f)
    }
    close()
}

/** The design's 150 dp blob: 10 dp of blur, layers inset 10 and 26 — kept in proportion at any size. */
private const val BLUR_SHARE = 10f / 150f
private const val MIDDLE_INSET_SHARE = 10f / 150f
private const val INNER_INSET_SHARE = 26f / 150f

private const val TAU = (2.0 * PI).toFloat()
private const val POINTS = 24

/** How far from round a resting layer strays, and how much further a loud voice takes it. */
private const val BASE_DEPTH = 0.07f
private const val VOICE_DEPTH = 0.2f

/** `radial-gradient(circle at 35% 30%)` reaches its farthest corner at this multiple of the side. */
private const val FARTHEST_CORNER = 0.955f

private const val MIDDLE_SPIN_S = 16f
private const val INNER_SPIN_S = 10f
private const val BARS = 5
private const val DOTS = 3

private val OuterColors = listOf(LightPalette.primary, DarkPalette.primary, Brand.saffron, Brand.green, LightPalette.primary)
private val MiddleColors = listOf(DarkPalette.primary, Brand.saffron, Color(0xFF86ABF2), DarkPalette.primary)
