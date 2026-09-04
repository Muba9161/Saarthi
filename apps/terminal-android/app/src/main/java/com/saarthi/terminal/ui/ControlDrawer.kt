package com.saarthi.terminal.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * The handle that hides the controls.
 *
 * A permanent bar of destinations along the foot of a driving screen is a row of
 * things to hit by accident, and section 23 asks the interface not to encourage
 * complex interaction while the vehicle is moving. So the destinations live
 * behind a deliberate gesture and the screen keeps its map.
 *
 * **What does not go behind the gesture is the emergency control.** SOS stays
 * pinned wherever this drawer is used. A swipe followed by a tap is a fine cost
 * for "show me nearby fuel" and an unacceptable one for the button somebody
 * reaches for without looking; section 36 is explicit that it must be reachable
 * at all times, and a drawer that swallowed it would have traded a real safety
 * property for a tidier screen.
 *
 * Both gestures work, because both get used: a driver swipes up out of habit
 * from every other Android surface, and an installer with a gloved hand taps.
 */
@Composable
fun ControlHandle(
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
    label: String = "Show controls",
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(28.dp)
            .semantics {
                contentDescription = label
                onClick(label) {
                    onOpen()
                    true
                }
            }
            .clickable(onClick = onOpen)
            .pointerInput(Unit) {
                detectVerticalDragGestures { _, dragAmount ->
                    // Upward is negative. A few points of travel is enough to
                    // read as intent without firing on the tremor of a hand
                    // resting against a moving dashboard.
                    if (dragAmount < -4f) onOpen()
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .width(52.dp)
                .height(5.dp)
                .clip(RoundedCornerShape(Radius.pill))
                .background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.55f)),
        )
    }
}

/**
 * The controls themselves, over the cockpit.
 *
 * A scrim behind it, so a tap anywhere else closes it — the gesture to dismiss
 * has to be at least as easy as the one to open, or a driver is left prodding at
 * a panel they opened by accident.
 */
@Composable
fun ControlDrawer(
    visible: Boolean,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val reduced = LocalReducedMotion.current

    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(),
        exit = fadeOut(),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .background(Color_scrim())
                .clickable(onClick = onDismiss),
        )
    }

    AnimatedVisibility(
        visible = visible,
        enter = if (reduced) {
            fadeIn()
        } else {
            fadeIn() + slideInVertically(
                spring(dampingRatio = Spring.DampingRatioLowBouncy, stiffness = Spring.StiffnessMedium),
            ) { it }
        },
        exit = if (reduced) fadeOut() else fadeOut() + slideOutVertically { it },
        modifier = modifier,
    ) {
        /*
         * Wide enough to use, never wider.
         *
         * Across a landscape phone the drawer is about 900dp, and a row of two
         * buttons stretched over that puts a centred label a hand's width from
         * the icon beside it — legible, and unusable at a glance. Capped and
         * centred, the controls sit where a thumb already is, and the cap does
         * nothing at all on a phone held upright, which is narrower than it.
         */
        GlassCard(
            // `widthIn` first: `fillMaxWidth` fixes the width to whatever
            // maximum it is handed, so a cap placed after it never applies.
            Modifier.widthIn(max = DRAWER_MAX_WIDTH).fillMaxWidth(),
            contentPadding = 12.dp,
        ) {
            // The same handle, pointing the other way: what opened it closes it.
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(20.dp)
                    .clickable(onClick = onDismiss)
                    .pointerInput(Unit) {
                        detectVerticalDragGestures { _, dragAmount ->
                            if (dragAmount > 4f) onDismiss()
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier
                        .width(52.dp)
                        .height(5.dp)
                        .clip(RoundedCornerShape(Radius.pill))
                        .background(
                            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.55f),
                        ),
                )
            }
            Spacer(Modifier.height(8.dp))
            content()
        }
    }
}

/** Barely there. Enough to signal "this closes on a tap", not enough to darken the map. */
@Composable
private fun Color_scrim() = MaterialTheme.colorScheme.scrim.copy(alpha = 0.01f)

/**
 * One labelled destination inside the drawer.
 *
 * Labels return here, where the bar could not afford them. The drawer is opened
 * deliberately and read once, so a word costs nothing and removes the guess that
 * an icon alone leaves — which is the trade the bar could not make when six
 * controls were competing for 336 points of width.
 */
@Composable
fun DrawerAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    androidx.compose.material3.Surface(
        modifier = modifier.height(TouchTarget),
        onClick = onClick,
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            androidx.compose.material3.Icon(
                icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(22.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                label,
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1,
                softWrap = false,
            )
        }
    }
}

/**
 * The widest the drawer is drawn.
 *
 * 520dp is a shade under the point at which two side-by-side controls stop
 * reading as a pair, and comfortably wider than any phone held upright — so the
 * cap only ever takes effect on a screen that had too much room, not too little.
 */
private val DRAWER_MAX_WIDTH = 520.dp
