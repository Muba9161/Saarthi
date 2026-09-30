package com.saarthi.driver.ui.design

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.saarthi.core.ui.LocalReducedMotion
import com.saarthi.driver.R

/**
 * The design's `FlowTopBar`: back, a segmented progress rail, the mark.
 *
 * The segment being worked on fills in as the step arrives, so moving forward
 * is felt as well as read.
 */
@Composable
fun StepBar(
    total: Int,
    current: Int,
    label: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    Row(
        modifier
            .fillMaxWidth()
            .height(48.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        CircleButton(Lucide.chevronLeft, stringResource(R.string.action_back), onBack)
        Row(
            Modifier
                .weight(1f)
                .semantics { contentDescription = label },
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            for (index in 1..total) {
                Segment(
                    filled = index <= current,
                    animate = index == current,
                    track = c.track,
                    fill = c.primary,
                    modifier = Modifier.weight(1f),
                    key = current,
                )
            }
        }
        BrandMark(height = 32.dp)
    }
}

@Composable
private fun Segment(filled: Boolean, animate: Boolean, track: Color, fill: Color, modifier: Modifier, key: Int) {
    val reduced = LocalReducedMotion.current
    val grow = remember(key) { Animatable(if (animate && !reduced) 0f else 1f) }
    LaunchedEffect(key) {
        if (animate && !reduced) grow.animateTo(1f, tween(700, 120, Ease.out))
    }
    Box(
        modifier
            .height(5.dp)
            .clip(CircleShape)
            .background(track),
    ) {
        if (filled) {
            Box(
                Modifier
                    .matchParentSize()
                    .graphicsLayer {
                        scaleX = grow.value
                        transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 0.5f)
                    }
                    .clip(CircleShape)
                    .background(fill),
            )
        }
    }
}

/**
 * The header most start-of-shift screens carry: the mark, an eyebrow, a title.
 */
@Composable
fun StepHeader(
    eyebrow: String,
    title: String,
    modifier: Modifier = Modifier,
    eyebrowColor: Color = Saarthi.colors.muted,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .height(56.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        BrandMark(height = 36.dp)
        Column(Modifier.weight(1f)) {
            Eyebrow(eyebrow, color = eyebrowColor)
            Text(title, style = SType.headerTitle, color = Saarthi.colors.fg, maxLines = 1)
        }
        trailing?.invoke(this)
    }
}

/**
 * A full-screen step: the canvas colour, room for the status bar, 20 either side.
 *
 * [scroll] for steps whose content can outgrow a small phone; the button at the
 * foot of a fixed step sits at the bottom of the screen instead.
 */
@Composable
fun StepScreen(
    modifier: Modifier = Modifier,
    background: Color = Saarthi.colors.canvas,
    padding: PaddingValues = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 24.dp),
    scroll: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .fillMaxSize()
            .background(background)
            .windowInsetsPadding(WindowInsets.statusBars)
            .windowInsetsPadding(WindowInsets.navigationBars)
            // The keyboard pushes the step up, so the button at its foot stays reachable.
            .imePadding()
            .then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier)
            .padding(padding),
        content = content,
    )
}

/** A blank the height of the status bar, for screens that draw under it. */
@Composable
fun StatusBarSpace() = Box(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))

/**
 * A sheet that rises over a scrim.
 *
 * Tapping the scrim closes it, as a driver reaching past a panel to get back to
 * the map expects. Content that must stay dark whatever the theme (anything
 * over the map) passes its own [background].
 */
@Composable
fun BottomSheet(
    visible: Boolean,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    background: Color = Saarthi.colors.card,
    grabber: Color = Saarthi.colors.borderStrong,
    top: Dp? = null,
    padding: PaddingValues = PaddingValues(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 26.dp),
    scrim: Color = Color(0x8C09090B),
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(Modifier.fillMaxSize()) {
        AnimatedVisibility(
            visible = visible,
            enter = fadeIn(tween(350)),
            exit = fadeOut(tween(250)),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(scrim)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onDismiss,
                    ),
            )
        }
        AnimatedVisibility(
            visible = visible,
            enter = slideInVertically(tween(550, easing = Ease.out)) { it },
            exit = slideOutVertically(tween(300, easing = Ease.standard)) { it },
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            Column(
                modifier
                    .fillMaxWidth()
                    .then(if (top != null) Modifier.padding(top = top) else Modifier)
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                    .background(background)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = {},
                    )
                    .windowInsetsPadding(WindowInsets.navigationBars)
                    .padding(padding),
            ) {
                Box(
                    Modifier
                        .align(Alignment.CenterHorizontally)
                        .padding(bottom = 16.dp)
                        .width(40.dp)
                        .height(5.dp)
                        .clip(CircleShape)
                        .background(grabber),
                )
                content()
            }
        }
    }
}

/** A square gap, for the few places spacing is not a column's `spacedBy`. */
@Composable
fun Gap(size: Dp) = Box(Modifier.size(size))
