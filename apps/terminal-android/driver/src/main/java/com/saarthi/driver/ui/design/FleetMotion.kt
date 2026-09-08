package com.saarthi.driver.ui.design

import androidx.compose.animation.core.EaseInOutSine
import androidx.compose.animation.core.EaseOutCubic
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import com.saarthi.core.ui.LocalReducedMotion
import kotlinx.coroutines.delay

/**
 * How this app moves.
 *
 * Every duration and curve in the driver app comes from here, because the thing
 * that makes an interface feel assembled rather than designed is six components
 * each easing at a slightly different rate. There are four speeds and two
 * curves, and nothing outside this file invents a fifth.
 *
 * One rule runs through all of it: motion has to *mean* something. A card that
 * rises as it arrives says it came from below, which is where the driver's
 * thumb is and where the next screen lives. A card that merely fades says only
 * that the screen redrew.
 *
 * And all of it stops dead under [LocalReducedMotion]. That setting is an
 * accessibility promise, not a performance switch: a driver who has asked for
 * stillness gets stillness, not a slower version of the same movement.
 */
object FleetMotion {

    /** A press, a toggle, a chip lighting up. */
    const val INSTANT = 120

    /** The default. A card arriving, a panel expanding. */
    const val QUICK = 260

    /** A screen changing, a sheet rising. */
    const val PAGE = 380

    /**
     * An exit.
     *
     * Deliberately shorter than the matching entrance. A driver who has decided
     * to leave a screen has already stopped looking at it, and matching the two
     * durations makes the app feel like it is arguing.
     */
    const val EXIT = 200

    /** The gap between one card arriving and the next. */
    const val STAGGER_MS = 45L

    /** Settles rather than bounces. This is a working app in a cab. */
    fun <T> settle(): FiniteAnimationSpec<T> = spring(
        dampingRatio = Spring.DampingRatioNoBouncy,
        stiffness = Spring.StiffnessMediumLow,
    )

    /** A little life, for things a driver chose to make happen. */
    fun <T> lively(): FiniteAnimationSpec<T> = spring(
        dampingRatio = 0.72f,
        stiffness = Spring.StiffnessMedium,
    )

    /**
     * Entering: decelerates into place, so the end of the move is the calm part.
     *
     * Typed as a `FiniteAnimationSpec` rather than the wider `AnimationSpec`
     * because `fadeIn`, `expandVertically` and the rest of the transition API
     * will only take one that is known to end.
     */
    fun <T> enter(duration: Int = QUICK): FiniteAnimationSpec<T> =
        tween(durationMillis = duration, easing = EaseOutCubic)
}

/**
 * A duration that is zero when the driver has asked for stillness.
 *
 * Used instead of branching at every call site — an animation that runs for 0ms
 * is an animation that does not run, and the surrounding code stays readable.
 */
@Composable
fun stillOr(duration: Int): Int = if (LocalReducedMotion.current) 0 else duration

/**
 * Arrive.
 *
 * Wraps a block so it fades up into place a beat after the one before it. The
 * stagger is what turns a screenful of cards from a single flat repaint into a
 * list that assembles itself, and 45ms is the interval where that reads as one
 * motion rather than as items queueing.
 *
 * [index] is the card's position in its group, not its position on the screen —
 * a header that should land first is index 0 wherever it sits.
 */
@Composable
fun FleetEnter(
    index: Int = 0,
    modifier: Modifier = Modifier,
    rise: Dp = Dp.Unspecified,
    content: @Composable () -> Unit,
) {
    val reducedMotion = LocalReducedMotion.current
    var arrived by remember { mutableStateOf(reducedMotion) }

    LaunchedEffect(reducedMotion) {
        if (reducedMotion) {
            arrived = true
        } else {
            delay(index * FleetMotion.STAGGER_MS)
            arrived = true
        }
    }

    val progress by animateFloatAsState(
        targetValue = if (arrived) 1f else 0f,
        animationSpec = FleetMotion.enter(stillOr(FleetMotion.QUICK + 60)),
        label = "fleet-enter",
    )

    // A fixed 28dp unless the caller wants a longer travel: far enough to read
    // as movement, short enough that a slow phone does not show it crawling.
    val travel = if (rise == Dp.Unspecified) 28f else rise.value

    Box(
        modifier.graphicsLayer {
            alpha = progress
            translationY = (1f - progress) * travel * density
        },
    ) {
        content()
    }
}

/**
 * Press.
 *
 * A card that dips under a thumb and springs back is the cheapest confirmation
 * an interface can give, and on a phone being held in a moving vehicle it is
 * often the only one the driver registers. It replaces Material's ripple on
 * these surfaces rather than joining it: a ripple on a 26dp-radius card clips
 * into a shape nobody designed.
 *
 * The scale is applied to the layer, never to the layout, so nothing around the
 * pressed card moves — a press that reflows the screen reads as a fault.
 */
@Composable
fun Modifier.pressable(
    enabled: Boolean = true,
    scaleTo: Float = 0.97f,
    onClick: () -> Unit,
): Modifier {
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()
    val reducedMotion = LocalReducedMotion.current

    val scale by animateFloatAsState(
        targetValue = if (pressed && enabled && !reducedMotion) scaleTo else 1f,
        animationSpec = FleetMotion.lively(),
        label = "press-scale",
    )

    return this
        .graphicsLayer {
            scaleX = scale
            scaleY = scale
        }
        .clickable(
            interactionSource = interactions,
            indication = null,
            enabled = enabled,
            onClick = onClick,
        )
}

/**
 * A slow breath.
 *
 * Returns 0..1 and back, for anything that should read as alive rather than as
 * animated: the glow behind a scanner frame, the ring around a live marker.
 * Held at [restingAt] when the driver has asked for stillness, so the element
 * keeps whatever look it has at that point in the cycle instead of vanishing.
 */
@Composable
fun rememberBreath(
    periodMs: Int = 2_600,
    restingAt: Float = 1f,
): State<Float> {
    val reducedMotion = LocalReducedMotion.current
    if (reducedMotion) return remember(restingAt) { mutableStateOf(restingAt) }

    val transition = rememberInfiniteTransition(label = "breath")
    return transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(periodMs, easing = EaseInOutSine),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "breath-value",
    )
}

/**
 * A value that runs 0→1 and starts over.
 *
 * For things that travel rather than pulse: the sweep of a shimmer, the march
 * of the chevrons between two places, the sweep line across a scanner.
 */
@Composable
fun rememberSweep(periodMs: Int = 1_600): State<Float> {
    val reducedMotion = LocalReducedMotion.current
    if (reducedMotion) return remember { mutableStateOf(0f) }

    val transition = rememberInfiniteTransition(label = "sweep")
    return transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(periodMs, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "sweep-value",
    )
}

