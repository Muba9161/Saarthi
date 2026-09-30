package com.saarthi.driver.ui.shift.flow

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.RingSpinner
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SuccessDisc
import com.saarthi.driver.ui.design.SystemBars
import com.saarthi.driver.ui.design.popIn
import com.saarthi.driver.ui.design.rise

/**
 * A full-screen flow that rises over the shift: the safety check, the fuel slip.
 *
 * `translateY(100%) → none` over 550 ms, as both designs enter, and straight
 * back down when closed. Everything inside is composed only while the panel is
 * showing, so each opening starts from a clean first step rather than wherever
 * the last one was abandoned. The system back gesture goes to [onBack]; a flow
 * that must not be left while something is on its way to the fleet registers
 * its own `BackHandler` inside, which Android asks first.
 */
@Composable
internal fun FlowPanel(
    visible: Boolean,
    onBack: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    BackHandler(enabled = visible, onBack = onBack)
    val reduced = Saarthi.reducedMotion
    AnimatedVisibility(
        visible = visible,
        enter = if (reduced) EnterTransition.None else slideInVertically(tween(550, easing = Ease.out)) { it },
        exit = if (reduced) ExitTransition.None else slideOutVertically(tween(300, easing = Ease.standard)) { it },
    ) {
        val c = Saarthi.colors
        // The panel may open over the always-dark map, whose light status icons
        // would vanish on a light canvas.
        SystemBars(lightContent = c.dark)
        Column(
            Modifier
                .fillMaxSize()
                .background(c.canvas)
                // A hit target of its own, so a tap on an empty part of the
                // panel never reaches the tab underneath.
                .pointerInput(Unit) {}
                .windowInsetsPadding(WindowInsets.statusBars)
                .windowInsetsPadding(WindowInsets.navigationBars)
                .padding(top = 8.dp, bottom = 24.dp),
            content = content,
        )
    }
}

/** How an ending went, which picks the disc's colours. */
internal enum class OutcomeTone { SUCCESS, WARNING, DANGER }

/**
 * The centred ending of a flow: a disc, a title, a sentence.
 *
 * Success draws the design's self-writing tick. The two unhappy endings the
 * design has no frame for — a vehicle that must not be driven, a check that
 * could not be sent — use the same disc in their own tone with [icon] inside,
 * so they read as part of the same flow rather than as a system dialog.
 * [textDelayMs] staggers the words in after the disc, as the check's
 * `ck-rise` does; null leaves them still, as the fuel slip draws them.
 */
@Composable
internal fun FlowOutcome(
    tone: OutcomeTone,
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    icon: String? = null,
    textDelayMs: Int? = null,
    extra: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val c = Saarthi.colors
    Column(
        modifier.semantics { liveRegion = LiveRegionMode.Polite },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterVertically),
    ) {
        when (tone) {
            OutcomeTone.SUCCESS -> SuccessDisc(size = 120.dp, disc = c.successSoft, tick = c.success, halo = c.successWash)
            OutcomeTone.WARNING -> ToneDisc(icon, c.warningSoft, c.warning, c.warningWash)
            OutcomeTone.DANGER -> ToneDisc(icon, c.dangerSoft, c.danger, c.dangerWash)
        }
        Text(
            title,
            style = OutcomeTitle,
            color = c.fg,
            textAlign = TextAlign.Center,
            modifier = textDelayMs?.let { Modifier.rise(it, 14.dp, 600) } ?: Modifier,
        )
        Text(
            body,
            style = SType.lead,
            color = c.muted,
            textAlign = TextAlign.Center,
            modifier = textDelayMs?.let { Modifier.rise(it + 70, 14.dp, 600) } ?: Modifier,
        )
        extra?.invoke(this)
    }
}

/** The design's 28/600 celebration title, a size between a sheet title and `celebrate`. */
private val OutcomeTitle = SType.title.copy(fontSize = 28.sp, lineHeight = 32.sp, letterSpacing = (-0.035).em)

/** The success disc's twin for the other tones: soft disc, wash halo, a glyph instead of a tick. */
@Composable
private fun ToneDisc(icon: String?, disc: Color, ink: Color, halo: Color) {
    Box(Modifier.size(148.dp).popIn(), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(148.dp)
                .clip(CircleShape)
                .background(halo),
        )
        Box(
            Modifier
                .size(120.dp)
                .clip(CircleShape)
                .background(disc),
            contentAlignment = Alignment.Center,
        ) {
            icon?.let { LineIcon(it, size = 56.dp, color = ink, stroke = 2.4f) }
        }
    }
}

/** The design's "Submitting…": a 64 ring spinning over the sunken track, and a line saying what for. */
@Composable
internal fun FlowSpinner(label: String, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(
        modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(22.dp, Alignment.CenterVertically),
    ) {
        RingSpinner(track = c.sunken, head = c.primary, size = 64.dp, stroke = 5.dp)
        Text(
            label,
            style = SType.headerTitle,
            color = c.fg,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}
