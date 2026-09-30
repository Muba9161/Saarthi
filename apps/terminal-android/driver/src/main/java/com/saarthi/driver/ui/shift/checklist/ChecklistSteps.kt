package com.saarthi.driver.ui.shift.checklist

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import com.saarthi.core.network.ChecklistItemDto
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NotesField
import com.saarthi.driver.ui.design.ProgressRing
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.shift.humanised
import kotlin.math.roundToInt

/** What the step-by-step part of the check can ask of the flow around it. */
internal class CheckStepActions(
    val onStep: (Int) -> Unit,
    val onAnswer: (index: Int, item: ChecklistItemDto, answer: CheckAnswer) -> Unit,
    val onNotes: (String) -> Unit,
    val onSubmit: () -> Unit,
)

/**
 * The check itself: how far along it is, what the vehicle answered, and one
 * card at a time for what only the driver can look at.
 *
 * One card at a time on purpose. A list of ten rows is tapped through in four
 * seconds with the tyres unlooked-at; a single large question with the answer
 * buttons under a thumb is actually read. The vehicle's own answers sit above as
 * chips — shown, never offered as controls.
 */
@Composable
internal fun ColumnScope.ChecklistSteps(
    items: List<ChecklistItemDto>,
    answers: Map<String, String>,
    step: Int,
    notes: String,
    remaining: Int,
    actions: CheckStepActions,
) {
    val automatic = remember(items) { items.filter { it.automatic } }
    val cards = remember(items) { items.filterNot { it.automatic } }
    val done = automatic.size + cards.count { answers.containsKey(it.code) }

    ProgressCard(
        done = done,
        total = items.size,
        byVehicle = automatic.size,
        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 14.dp),
    )
    if (automatic.isNotEmpty()) AutomaticChips(automatic)

    CardTrack(
        count = cards.size + 1,
        step = step,
        modifier = Modifier
            .padding(top = 18.dp)
            .weight(1f),
    ) { index, current ->
        if (index < cards.size) {
            val item = cards[index]
            ItemCard(
                item = item,
                number = index + 1,
                total = cards.size,
                answer = CheckAnswer.of(answers[item.code]),
                enabled = current,
                onAnswer = { actions.onAnswer(index, item, it) },
            )
        } else {
            NotesCard(notes, actions.onNotes, remaining, enabled = current, onSubmit = actions.onSubmit)
        }
    }

    val canGoBack = step > 0
    LinkButton(
        stringResource(R.string.checklist_previous),
        onClick = { if (canGoBack) actions.onStep(step - 1) },
        modifier = Modifier
            .align(Alignment.CenterHorizontally)
            .padding(top = 12.dp)
            .alpha(if (canGoBack) 1f else 0f)
            .then(if (canGoBack) Modifier else Modifier.clearAndSetSemantics {}),
        color = Saarthi.colors.muted,
        weight = FontWeight.Medium,
        enabled = canGoBack,
    )
}

/** The ring, "4 of 6 checked", and how many of those the vehicle answered itself. */
@Composable
private fun ProgressCard(done: Int, total: Int, byVehicle: Int, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val reduced = Saarthi.reducedMotion
    val target = if (total == 0) 1f else done.toFloat() / total
    val fraction by animateFloatAsState(target, if (reduced) snap() else tween(700, easing = Ease.out), label = "check-ring")
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 20.dp)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Box(Modifier.size(64.dp), contentAlignment = Alignment.Center) {
            // r = 27 in the design's 64 box: the ring's centre line sits 5 in.
            ProgressRing(
                track = c.sunken,
                fill = c.success,
                fraction = fraction,
                strokeWidth = 7.dp,
                modifier = Modifier
                    .matchParentSize()
                    .padding(1.5.dp),
            )
            Text(
                stringResource(R.string.checklist_progress_count, done, total),
                style = SType.cardTitle.copy(fontWeight = FontWeight.Bold),
                color = c.fg,
            )
        }
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.checklist_progress_title, done, total), style = SType.cardTitle, color = c.fg)
            Row(
                Modifier.padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                LineIcon(Lucide.cpu, size = 14.dp, color = c.muted)
                Text(
                    if (byVehicle > 0) {
                        pluralStringResource(R.plurals.checklist_by_vehicle, byVehicle, byVehicle)
                    } else {
                        stringResource(R.string.checklist_by_vehicle_none)
                    },
                    style = SType.small,
                    color = c.muted,
                )
            }
        }
    }
}

/**
 * The vehicle's own verdicts — "✓ Fuel · 64 %" — in their verdict's colour.
 *
 * A reading from the on-device simulator says so on the chip itself, because a
 * driver signing off a vehicle must never mistake an invented figure for the
 * engine's.
 */
@Composable
private fun AutomaticChips(items: List<ChecklistItemDto>) {
    Row(
        Modifier
            .padding(top = 10.dp)
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items.forEach { item ->
            val verdict = CheckAnswer.of(item.status)
            val (soft, ink) = verdict.tone()
            val value = item.observedValue?.let { reading(it, item.unit) }
                ?: verdict?.let { stringResource(it.label) }
                ?: item.status?.humanised().orEmpty()
            Row(
                Modifier
                    .clip(CircleShape)
                    .background(soft)
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                verdict?.let { LineIcon(it.icon, size = 12.dp, color = ink, stroke = 3f) }
                Text(
                    stringResource(
                        if (item.simulated) R.string.checklist_chip_simulated else R.string.checklist_chip,
                        item.label,
                        value,
                    ),
                    style = SType.captionStrong,
                    color = ink,
                    maxLines = 1,
                )
            }
        }
    }
}

/**
 * Cards side by side, the current one centred and its neighbours dimmed.
 *
 * Every card takes the height of the tallest, as the design's flex track does,
 * so the answer buttons do not jump as the row slides. The slide is read only
 * while placing, so it moves the cards without recomposing them each frame.
 * A card too tall for a small phone scrolls inside itself.
 */
@Composable
private fun CardTrack(
    count: Int,
    step: Int,
    modifier: Modifier = Modifier,
    card: @Composable (index: Int, current: Boolean) -> Unit,
) {
    val reduced = Saarthi.reducedMotion
    val position by animateFloatAsState(step.toFloat(), if (reduced) snap() else tween(600, easing = Ease.out), label = "check-track")
    Layout(
        content = {
            repeat(count) { index ->
                val current = index == step
                val shown by animateFloatAsState(if (current) 1f else 0.35f, tween(400), label = "check-card")
                Box(
                    Modifier
                        .graphicsLayer { alpha = shown }
                        // Only the card in view is read out; the dimmed ones
                        // either side are scenery until the driver gets there.
                        .then(if (current) Modifier else Modifier.clearAndSetSemantics {}),
                ) {
                    card(index, current)
                }
            }
        },
        modifier = modifier
            .fillMaxWidth()
            .clipToBounds(),
    ) { measurables, constraints ->
        val inset = TrackInset.roundToPx()
        val gap = TrackGap.roundToPx()
        val width = (constraints.maxWidth - inset * 2).coerceAtLeast(0)
        val tallest = (measurables.maxOfOrNull { it.maxIntrinsicHeight(width) } ?: 0)
            .coerceAtMost(constraints.maxHeight)
        val placeables = measurables.map { it.measure(Constraints.fixed(width, tallest)) }
        // At least the space given, so the cards sit at its top rather than
        // being centred in it, as an undersized layout would be.
        layout(constraints.maxWidth, maxOf(tallest, constraints.minHeight)) {
            placeables.forEachIndexed { index, placeable ->
                placeable.placeRelative(inset + ((index - position) * (width + gap)).roundToInt(), 0)
            }
        }
    }
}

private val TrackInset = 20.dp
private val TrackGap = 16.dp

/** One thing to look at: what it is, how to check it, and the answers under a thumb. */
@Composable
private fun ItemCard(
    item: ChecklistItemDto,
    number: Int,
    total: Int,
    answer: CheckAnswer?,
    enabled: Boolean,
    onAnswer: (CheckAnswer) -> Unit,
) {
    val c = Saarthi.colors
    Column(
        Modifier
            .fillMaxSize()
            .card(radius = 26.dp)
            .verticalScroll(rememberScrollState())
            .padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Eyebrow(stringResource(R.string.checklist_step, number, total), color = c.primary)
            if (item.blocking) {
                Text(
                    stringResource(R.string.checklist_can_stop),
                    style = SType.microStrong,
                    color = c.danger,
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(c.dangerSoft)
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                )
            }
        }
        IconWell(
            itemIcon(item.code),
            well = c.primarySoft,
            ink = c.primary,
            size = 64.dp,
            radius = 20.dp,
            iconSize = 30.dp,
            stroke = 1.8f,
        )
        Text(item.label, style = SType.title, color = c.fg)
        item.detail?.let { Text(it, style = SType.body, color = c.muted) }
        Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            CheckAnswer.offeredFor(item).forEach { option ->
                AnswerButton(option, selected = option == answer, enabled = enabled) { onAnswer(option) }
            }
        }
    }
}

/**
 * `.ck-ans`: 60 tall, grey until chosen, then its verdict's wash with a 2px
 * ring in its ink. Colour is never the only signal — each answer has its glyph.
 */
@Composable
private fun AnswerButton(answer: CheckAnswer, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val c = Saarthi.colors
    val (soft, ink) = answer.tone()
    val ground by animateColorAsState(if (selected) soft else c.sunken, tween(250), label = "answer-ground")
    val text by animateColorAsState(if (selected) ink else c.fg, tween(250), label = "answer-ink")
    val ring by animateColorAsState(if (selected) ink else Color.Transparent, tween(250), label = "answer-ring")
    val shape = RoundedCornerShape(16.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .semantics { this.selected = selected }
            .pressable(enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .height(60.dp)
            .clip(shape)
            .background(ground)
            .border(2.dp, ring, shape),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LineIcon(answer.icon, size = 18.dp, color = text, stroke = 2.4f)
        Text(stringResource(answer.label), style = SType.bodyStrong, color = text)
    }
}

/**
 * The last card: optional notes, then the one button that sends the check.
 *
 * The button is never dead. While required items are still unanswered it says
 * how many, and pressing it goes to the first of them.
 */
@Composable
private fun NotesCard(
    notes: String,
    onNotes: (String) -> Unit,
    remaining: Int,
    enabled: Boolean,
    onSubmit: () -> Unit,
) {
    val c = Saarthi.colors
    Column(
        Modifier
            .fillMaxSize()
            .card(radius = 26.dp)
            .verticalScroll(rememberScrollState())
            .padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Eyebrow(stringResource(R.string.checklist_last_step), color = c.primary)
        Text(stringResource(R.string.checklist_notes_title), style = SType.title, color = c.fg)
        NotesField(
            value = notes,
            onValueChange = { onNotes(it.take(NOTES_LIMIT)) },
            label = stringResource(R.string.checklist_notes_label),
            minHeight = 116.dp,
        )
        SaarthiButton(
            text = if (remaining > 0) {
                pluralStringResource(R.plurals.checklist_remaining, remaining, remaining)
            } else {
                stringResource(R.string.checklist_complete)
            },
            // Not `enabled`: that fades the button, and a dimmed neighbour card
            // already fades it once. A card out of view just ignores the press.
            onClick = { if (enabled) onSubmit() },
            height = 60.dp,
            textStyle = SType.bodyStrong,
        )
    }
}

/** The server keeps up to a thousand characters of notes; more would be refused whole. */
private const val NOTES_LIMIT = 1_000
