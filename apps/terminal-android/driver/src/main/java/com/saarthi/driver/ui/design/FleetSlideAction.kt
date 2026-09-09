package com.saarthi.driver.ui.design

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Slide to start.
 *
 * A deliberate gesture for the one action that must never happen by accident.
 * Starting a trip tells a fleet a truck is moving, begins the driver's hours and
 * opens a record somebody will be paid against — and the button that did it sat
 * under a thumb resting on a phone wedged in a dashboard cradle. A tap is the
 * wrong shape for that; a drag across the full width is not something a pocket
 * or a pothole produces.
 *
 * Three details that make it feel like a control rather than a novelty:
 *
 *  * **It follows the finger exactly** while dragging, and springs back if
 *    released short. Anything that lags or snaps mid-gesture reads as broken.
 *  * **It confirms with haptics** at the moment it commits, not when the finger
 *    lifts — so a driver knows it took without looking down.
 *  * **The label fades as the knob travels.** By two-thirds of the way the words
 *    are gone and only the destination remains, which is the affordance doing
 *    the explaining rather than the copy.
 */
@Composable
fun FleetSlideAction(
    label: String,
    onConfirm: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val density = LocalDensity.current
    // Read once, in composition: `stillOr` is itself composable and cannot be
    // called from inside a drag callback.
    val commitMs = stillOr(FleetMotion.INSTANT)

    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .height(FleetTouchTarget + 8.dp),
    ) {
        val trackWidth = with(density) { maxWidth.toPx() }
        val knobSize = FleetTouchTarget
        val knobPx = with(density) { knobSize.toPx() }
        val travel = (trackWidth - knobPx - with(density) { 8.dp.toPx() }).coerceAtLeast(1f)

        val offset = remember { Animatable(0f) }
        var committed by remember { mutableStateOf(false) }

        // Past two-thirds it is going to happen. Chosen rather than a full
        // traverse because a driver's thumb rarely reaches the far edge of a
        // six-inch phone held one-handed.
        val commitAt = travel * 0.66f
        val progress = (offset.value / travel).coerceIn(0f, 1f)

        Box(
            Modifier
                .fillMaxSize()
                .background(
                    brush = Brush.horizontalGradient(
                        listOf(OnyxRaised, OnyxDeep),
                    ),
                    shape = CircleShape,
                )
                .alpha(if (enabled) 1f else 0.5f)
                /*
                 * Centred in the track the knob leaves, not in the whole track.
                 *
                 * Centred across the full width, the first word sat underneath
                 * the knob at rest — "Slide to start your trip" read as "lide to
                 * start your trip" before a finger had touched it. The padding
                 * comes after the background so the pill still fills the row and
                 * only the words are inset.
                 */
                .padding(start = knobSize + 8.dp, end = FleetSpace.base),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                label,
                style = MaterialTheme.typography.titleMedium,
                color = Ash,
                // Gone by the time the knob is two-thirds across, so the words
                // never sit under the thing the driver is looking at.
                modifier = Modifier.alpha(((1f - progress * 1.6f)).coerceIn(0f, 1f)),
                maxLines = 1,
            )
        }

        Box(
            Modifier
                .offset { IntOffset(offset.value.roundToInt() + with(density) { 4.dp.roundToPx() }, 0) }
                .align(Alignment.CenterStart)
                .size(knobSize)
                .background(EmberGradient, CircleShape)
                .pointerInput(enabled, travel) {
                    if (!enabled) return@pointerInput
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            scope.launch {
                                if (offset.value >= commitAt && !committed) {
                                    committed = true
                                    // Confirm at the moment it commits, not when
                                    // the finger lifts — the driver is looking at
                                    // the road, not the screen.
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                    offset.animateTo(travel, tween(commitMs))
                                    onConfirm()
                                    offset.snapTo(0f)
                                    committed = false
                                } else {
                                    offset.animateTo(0f, FleetMotion.settle())
                                }
                            }
                        },
                        onDragCancel = {
                            scope.launch { offset.animateTo(0f, FleetMotion.settle()) }
                        },
                    ) { _, dragAmount ->
                        scope.launch {
                            offset.snapTo((offset.value + dragAmount).coerceIn(0f, travel))
                        }
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.AutoMirrored.Rounded.ArrowForward,
                contentDescription = label,
                tint = EmberInk,
                modifier = Modifier.padding(14.dp).fillMaxSize(),
            )
        }
    }
}
