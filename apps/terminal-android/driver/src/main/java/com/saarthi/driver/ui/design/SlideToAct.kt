package com.saarthi.driver.ui.design

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * "Slide to start your trip" — a drag, never a tap.
 *
 * A phone in a dashboard cradle collects accidental taps all day, and starting
 * or ending a trip tells a fleet a truck is moving. So the knob has to be
 * carried most of the way across; let go early and it springs back.
 *
 * Screen readers get a plain activate action with the same label, because a
 * gesture nobody can perform without sight must not be the only way in.
 */
@Composable
fun SlideToAct(
    label: String,
    onConfirm: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val confirm by rememberUpdatedState(onConfirm)
    val scope = rememberCoroutineScope()
    val offset = remember { Animatable(0f) }
    val density = LocalDensity.current
    val nudge by rememberLoop(900, Ease.standard, reverse = true, rest = 0f, label = "slide-nudge")

    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .height(64.dp)
            .brandGradient(CircleShape)
            .semantics {
                role = Role.Button
                onClick(label = label) {
                    if (enabled) confirm()
                    true
                }
            },
    ) {
        val travel = with(density) { (maxWidth - 64.dp).toPx() }.coerceAtLeast(1f)
        val progress = (offset.value / travel).coerceIn(0f, 1f)

        Text(
            label,
            style = SType.button.copy(fontWeight = FontWeight.Medium),
            color = Color.White,
            modifier = Modifier
                .align(Alignment.Center)
                .padding(start = 64.dp)
                .graphicsLayer { alpha = 1f - progress * 1.6f },
        )

        val drag = rememberDraggableState { delta ->
            scope.launch { offset.snapTo((offset.value + delta).coerceIn(0f, travel)) }
        }
        Box(
            Modifier
                .padding(4.dp)
                .offset { IntOffset(offset.value.roundToInt(), 0) }
                .size(56.dp)
                .shadow(6.dp, CircleShape, spotColor = Color.Black.copy(alpha = 0.4f))
                .clip(CircleShape)
                .background(Color.White)
                .draggable(
                    state = drag,
                    orientation = Orientation.Horizontal,
                    enabled = enabled,
                    onDragStopped = {
                        if (offset.value > travel * 0.82f) {
                            offset.animateTo(travel, tween(200, easing = Ease.out))
                            confirm()
                            delay(900)
                            offset.snapTo(0f)
                        } else {
                            offset.animateTo(0f, tween(450, easing = Ease.inOut))
                        }
                    },
                ),
            contentAlignment = Alignment.Center,
        ) {
            LineIcon(
                Lucide.arrowRight,
                size = 22.dp,
                color = Brand.navy,
                stroke = 2.2f,
                modifier = Modifier.offset(x = (6f * nudge * (1f - progress)).dp),
            )
        }
    }
}
