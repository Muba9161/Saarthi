package com.saarthi.terminal.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.saarthi.terminal.domain.AssistantState
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * The Saarthi assistant, as a shape (specification section 34).
 *
 * A blob rather than a microphone icon, and the reason is stated in the spec:
 * this should feel like *Saarthi*, not like a generic dictation control. A
 * microphone says "I am recording you". This says "I am here, I am listening, I
 * am thinking" — which are three different things a driver needs to be able to
 * tell apart at a glance, without taking their eyes off the road for longer
 * than a glance.
 *
 * Each state has its own motion, and the motions are chosen to be
 * distinguishable in peripheral vision:
 *
 *   IDLE       a slow, barely-there drift. Present without asking for attention.
 *   LISTENING  a steady outward pulse. Reads as "go on".
 *   THINKING   a rotation. Reads as work happening, not as waiting.
 *   SPEAKING   amplitude-driven wobble, so the shape tracks the voice.
 *   ERROR      still, red, with an icon. Motion would suggest it is still trying.
 *
 * Under reduced motion every one of them becomes a static shape with the state's
 * colour and icon. The information survives; only the movement goes.
 */
@Composable
fun AiBlob(
    state: AssistantState,
    modifier: Modifier = Modifier,
    size: Dp = 88.dp,
    /** 0..1, driven by speech amplitude while SPEAKING. */
    amplitude: Float = 0f,
    onClick: (() -> Unit)? = null,
) {
    val reducedMotion = LocalReducedMotion.current

    val tint = when (state) {
        AssistantState.IDLE -> MaterialTheme.colorScheme.primary
        AssistantState.LISTENING -> SaarthiInfo
        AssistantState.THINKING -> MaterialTheme.colorScheme.secondary
        AssistantState.SPEAKING -> SaarthiSuccess
        AssistantState.ERROR -> SaarthiDanger
    }

    val transition = rememberInfiniteTransition(label = "blob")

    // One phase drives every animated state, so the shape never jumps when the
    // assistant moves between them mid-gesture.
    val phase by if (reducedMotion) {
        androidx.compose.runtime.remember { androidx.compose.runtime.mutableFloatStateOf(0f) }
    } else {
        transition.animateFloat(
            initialValue = 0f,
            targetValue = (2 * PI).toFloat(),
            animationSpec = infiniteRepeatable(
                animation = tween(
                    durationMillis = when (state) {
                        AssistantState.THINKING -> 1_600
                        AssistantState.LISTENING -> 2_200
                        else -> 5_000
                    },
                    easing = LinearEasing,
                ),
                repeatMode = RepeatMode.Restart,
            ),
            label = "blob-phase",
        )
    }

    // How far the outline deviates from a circle.
    val targetWobble = when (state) {
        AssistantState.IDLE -> 0.045f
        AssistantState.LISTENING -> 0.12f
        AssistantState.THINKING -> 0.16f
        AssistantState.SPEAKING -> 0.08f + amplitude.coerceIn(0f, 1f) * 0.16f
        AssistantState.ERROR -> 0f
    }
    val wobble by animateFloatAsState(
        targetValue = if (reducedMotion) 0f else targetWobble,
        animationSpec = tween(400),
        label = "blob-wobble",
    )

    val scale by animateFloatAsState(
        targetValue = when {
            reducedMotion -> 1f
            state == AssistantState.LISTENING -> 1.06f
            state == AssistantState.SPEAKING -> 1f + amplitude.coerceIn(0f, 1f) * 0.08f
            else -> 1f
        },
        animationSpec = tween(300),
        label = "blob-scale",
    )

    val description = when (state) {
        AssistantState.IDLE -> "Saarthi assistant, idle. Tap or say Hey Saarthi."
        AssistantState.LISTENING -> "Saarthi is listening."
        AssistantState.THINKING -> "Saarthi is working on your question."
        AssistantState.SPEAKING -> "Saarthi is answering."
        AssistantState.ERROR -> "Saarthi could not answer."
    }

    Box(
        modifier = modifier
            .size(size)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(size)) {
            drawBlob(
                tint = tint,
                phase = phase,
                wobble = wobble,
                scale = scale,
                rotating = state == AssistantState.THINKING && !reducedMotion,
            )
        }

        Icon(
            imageVector = when (state) {
                AssistantState.IDLE -> Icons.Rounded.AutoAwesome
                AssistantState.LISTENING -> Icons.Rounded.Mic
                AssistantState.THINKING -> Icons.Rounded.AutoAwesome
                AssistantState.SPEAKING -> Icons.Rounded.GraphicEq
                AssistantState.ERROR -> Icons.Rounded.ErrorOutline
            },
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(size / 3),
        )
    }
}

/**
 * Draw the blob.
 *
 * A closed path around a circle whose radius is modulated by two sine waves at
 * different frequencies. Two rather than one because a single wave reads as a
 * pulsing circle, and the second one at a different period is what makes it
 * read as something organic rather than something mechanical.
 */
private fun DrawScope.drawBlob(
    tint: Color,
    phase: Float,
    wobble: Float,
    scale: Float,
    rotating: Boolean,
) {
    val centre = Offset(size.width / 2f, size.height / 2f)
    val baseRadius = (size.minDimension / 2f) * 0.86f * scale
    val rotation = if (rotating) phase else 0f

    val path = Path()
    val steps = 72

    for (step in 0..steps) {
        val angle = (step.toFloat() / steps) * 2f * PI.toFloat()
        val modulation =
            sin(angle * 3f + phase) * wobble + sin(angle * 5f - phase * 0.7f) * (wobble * 0.55f)
        val radius = baseRadius * (1f + modulation)

        val x = centre.x + cos(angle + rotation) * radius
        val y = centre.y + sin(angle + rotation) * radius

        if (step == 0) path.moveTo(x, y) else path.lineTo(x, y)
    }
    path.close()

    // A soft halo first, so the shape has depth without a drop shadow, which
    // Compose cannot draw cheaply on an arbitrary path.
    drawCircle(
        brush = Brush.radialGradient(
            colors = listOf(tint.copy(alpha = 0.28f), Color.Transparent),
            center = centre,
            radius = baseRadius * 1.5f,
        ),
        radius = baseRadius * 1.5f,
        center = centre,
    )

    drawPath(
        path = path,
        brush = Brush.linearGradient(
            colors = listOf(tint, tint.copy(alpha = 0.72f)),
            start = Offset(centre.x - baseRadius, centre.y - baseRadius),
            end = Offset(centre.x + baseRadius, centre.y + baseRadius),
        ),
    )
}
