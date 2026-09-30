package com.saarthi.driver.ui.design

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.saarthi.core.ui.LocalReducedMotion

/** The design's three curves, as it names them in CSS. */
object Ease {
    /** `cubic-bezier(.16,1,.3,1)` — arrives fast and settles; used for almost everything. */
    val out: Easing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)

    /** `cubic-bezier(.34,1.56,.64,1)` — a small overshoot, for things that pop in. */
    val pop: Easing = CubicBezierEasing(0.34f, 1.56f, 0.64f, 1f)

    /** `cubic-bezier(.65,0,.35,1)` — symmetrical, for a knob sliding or a line drawing. */
    val inOut: Easing = CubicBezierEasing(0.65f, 0f, 0.35f, 1f)

    val standard: Easing = FastOutSlowInEasing
}

/**
 * The entrance every block on a screen makes: up from below and into view.
 *
 * Staggered by [delayMs] so a screen assembles top to bottom rather than
 * appearing at once. Under reduced motion it is simply there.
 */
fun Modifier.rise(
    delayMs: Int = 0,
    distance: Dp = 16.dp,
    durationMs: Int = 700,
): Modifier = composed {
    val reduced = LocalReducedMotion.current
    val progress = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!reduced) progress.animateTo(1f, tween(durationMs, delayMs, Ease.out))
    }
    val travel = with(LocalDensity.current) { distance.toPx() }
    graphicsLayer {
        alpha = progress.value
        translationY = (1f - progress.value) * travel
    }
}

/** The design's `.d1`…`.d7` delays, by position down the screen. */
fun stagger(index: Int): Int = when (index) {
    0 -> 0
    1 -> 60
    2 -> 120
    3 -> 180
    4 -> 260
    5 -> 340
    6 -> 420
    else -> 500
}

/** A pop into place with a slight overshoot — ticks, badges, avatars. */
fun Modifier.popIn(delayMs: Int = 0, from: Float = 0.5f): Modifier = composed {
    val reduced = LocalReducedMotion.current
    val progress = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!reduced) progress.animateTo(1f, tween(700, delayMs, Ease.pop))
    }
    graphicsLayer {
        val value = progress.value
        alpha = value.coerceIn(0f, 1f)
        val scale = from + (1f - from) * value
        scaleX = scale
        scaleY = scale
    }
}

/**
 * Tappable, with the press answered by a small shrink rather than a ripple.
 *
 * The design never shows a ripple: a control acknowledges a thumb by giving
 * under it, which reads the same in bright sun and through a smudged screen.
 */
fun Modifier.pressable(
    enabled: Boolean = true,
    scale: Float = 0.97f,
    role: Role? = Role.Button,
    label: String? = null,
    onClick: () -> Unit,
): Modifier = composed {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val reduced = LocalReducedMotion.current
    val target = if (pressed && enabled && !reduced) scale else 1f
    val animated by animateFloatAsState(target, tween(200, easing = Ease.out), label = "press")
    this
        .graphicsLayer {
            scaleX = animated
            scaleY = animated
        }
        .clickable(
            interactionSource = interaction,
            indication = null,
            enabled = enabled,
            role = role,
            onClickLabel = label,
            onClick = onClick,
        )
}

/**
 * A value running 0 → 1 forever — the clock behind every looping effect.
 *
 * Returns a constant [rest] under reduced motion, so a caller drawing from it
 * shows the resting frame rather than a frozen mid-animation one.
 */
@Composable
fun rememberLoop(
    periodMs: Int,
    easing: Easing = LinearEasing,
    reverse: Boolean = false,
    rest: Float = 1f,
    label: String = "loop",
): State<Float> {
    if (LocalReducedMotion.current) return remember { mutableFloatStateOf(rest) }
    val transition = rememberInfiniteTransition(label = label)
    return transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(periodMs, easing = easing),
            repeatMode = if (reverse) RepeatMode.Reverse else RepeatMode.Restart,
        ),
        label = label,
    )
}

/** The design's `breathe` — a live dot fading between 35% and 100%. */
fun Modifier.breathing(periodMs: Int = 1500, low: Float = 0.35f): Modifier = composed {
    val phase by rememberLoop(periodMs / 2, Ease.standard, reverse = true, rest = 1f, label = "breathe")
    graphicsLayer { alpha = low + (1f - low) * phase }
}
