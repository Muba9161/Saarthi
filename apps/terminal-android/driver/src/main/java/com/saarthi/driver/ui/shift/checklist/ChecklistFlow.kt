package com.saarthi.driver.ui.shift.checklist

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.ButtonRow
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.shift.flow.FlowOutcome
import com.saarthi.driver.ui.shift.flow.FlowPanel
import com.saarthi.driver.ui.shift.flow.FlowSpinner
import com.saarthi.driver.ui.shift.flow.FlowTopBar
import com.saarthi.driver.ui.shift.flow.OutcomeTone
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * The pre-trip safety check, rising over the shift.
 *
 * The checklist is fetched fresh on every opening, because the vehicle's own
 * answers — fuel, coolant, the document register — are recomputed from its
 * latest reading and yesterday's verdicts are not today's. Three endings, all
 * decided by the server: passed ([onDone], so the shell can close this and say
 * so), blocked (the vehicle must not be driven, with the reasons the server
 * gives), or no answer at all (retry, with every answer kept).
 */
@Composable
fun ChecklistFlow(
    visible: Boolean,
    cockpit: TerminalViewModel,
    onClose: () -> Unit,
    onDone: () -> Unit,
) {
    FlowPanel(visible, onBack = onClose) {
        ChecklistContent(cockpit, onClose, onDone)
    }
}

@Composable
private fun ColumnScope.ChecklistContent(
    cockpit: TerminalViewModel,
    onClose: () -> Unit,
    onDone: () -> Unit,
) {
    val preparation by cockpit.checklist.collectAsState()
    val answers by cockpit.checklistAnswers.collectAsState()
    val state by cockpit.uiState.collectAsState()
    val lastError by cockpit.lastError.collectAsState()
    val finish by rememberUpdatedState(onDone)
    val scope = rememberCoroutineScope()

    var loads by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var phase by remember { mutableStateOf<CheckPhase>(CheckPhase.Items) }
    var step by remember { mutableIntStateOf(0) }
    var notes by remember { mutableStateOf("") }
    var advance by remember { mutableStateOf<Job?>(null) }

    LaunchedEffect(loads) {
        loading = true
        val before = cockpit.checklist.value
        cockpit.loadChecklist()
        // `busy` is shared with every other call the cockpit makes, so a new
        // checklist arriving is the surer sign; `busy` falling covers a failure.
        combine(cockpit.checklist, cockpit.busy) { list, busy -> list !== before || !busy }.first { it }
        step = 0
        loading = false
    }
    LaunchedEffect(phase) {
        if (phase is CheckPhase.Done) {
            delay(DONE_HOLD_MS)
            finish()
        }
    }
    // Nothing leaves while the check is on its way; the verdict is worth waiting for.
    BackHandler(enabled = phase == CheckPhase.Submitting) {}

    val items = preparation?.items.orEmpty()
    val cards = remember(items) { items.filterNot { it.automatic } }
    val outstanding = cards.filter { it.required && it.manualInputRequired && !answers.containsKey(it.code) }
    val submit: () -> Unit = {
        phase = CheckPhase.Submitting
        cockpit.submitChecklist(notes.trim().ifEmpty { null }) { result -> phase = CheckPhase.of(result) }
    }

    FlowTopBar(
        title = preparation?.template?.takeUnless { it.isDefault }?.name ?: stringResource(R.string.checklist_title),
        plate = state.registration,
        modifier = Modifier.padding(horizontal = 20.dp),
        onClose = { if (phase != CheckPhase.Submitting) onClose() },
    )

    val fill = Modifier
        .weight(1f)
        .fillMaxWidth()
    when (val now = phase) {
        CheckPhase.Submitting -> FlowSpinner(stringResource(R.string.checklist_submitting), fill)
        is CheckPhase.Done -> FlowOutcome(
            tone = OutcomeTone.SUCCESS,
            title = stringResource(R.string.checklist_done_title),
            body = stringResource(if (now.warnings) R.string.checklist_done_warnings_body else R.string.checklist_done_body),
            modifier = fill.padding(horizontal = 28.dp),
            textDelayMs = 250,
        )
        is CheckPhase.Blocked -> BlockedEnding(
            reasons = now.reasons,
            onReview = {
                step = cards.indexOfFirst { it.code in now.codes }.takeIf { it >= 0 } ?: step
                phase = CheckPhase.Items
            },
            onClose = onClose,
        )
        CheckPhase.SendFailed -> RetryEnding(
            title = stringResource(R.string.checklist_send_failed_title),
            body = if (state.offline) {
                stringResource(R.string.checklist_send_offline)
            } else {
                lastError ?: stringResource(R.string.checklist_send_failed)
            },
            offline = state.offline,
            onRetry = submit,
            onBack = { phase = CheckPhase.Items },
        )
        CheckPhase.Items -> when {
            loading -> FlowSpinner(stringResource(R.string.checklist_loading), fill)
            preparation == null -> RetryEnding(
                title = stringResource(R.string.checklist_load_failed_title),
                body = if (state.offline) {
                    stringResource(R.string.checklist_load_offline)
                } else {
                    lastError ?: stringResource(R.string.checklist_load_failed)
                },
                offline = state.offline,
                onRetry = { loads++ },
                onBack = null,
            )
            else -> ChecklistSteps(
                items = items,
                answers = answers,
                step = step.coerceAtMost(cards.size),
                notes = notes,
                remaining = outstanding.size,
                actions = CheckStepActions(
                    onStep = {
                        advance?.cancel()
                        step = it
                    },
                    onAnswer = { index, item, answer ->
                        cockpit.answerChecklistItem(item.code, answer.status)
                        // A beat on the chosen answer before the next card
                        // slides in, so the driver sees what they picked.
                        advance?.cancel()
                        advance = scope.launch {
                            delay(ADVANCE_MS)
                            step = minOf(index + 1, cards.size)
                        }
                    },
                    onNotes = { notes = it },
                    onSubmit = {
                        if (cockpit.checklistComplete()) {
                            submit()
                        } else {
                            step = outstanding.firstOrNull()?.let(cards::indexOf) ?: 0
                        }
                    },
                ),
            )
        }
    }
}

/**
 * The vehicle must not be driven. The reasons are the server's own — the
 * blocking items marked faulty — and the fleet has already been told, so the
 * driver is not left wondering whether to phone anybody.
 */
@Composable
private fun ColumnScope.BlockedEnding(reasons: List<String>, onReview: () -> Unit, onClose: () -> Unit) {
    FlowOutcome(
        tone = OutcomeTone.DANGER,
        title = stringResource(R.string.checklist_blocked_title),
        body = stringResource(R.string.checklist_blocked_body),
        icon = Lucide.ban,
        textDelayMs = 250,
        modifier = Modifier
            .weight(1f)
            .fillMaxWidth()
            .padding(horizontal = 28.dp),
    ) {
        if (reasons.isNotEmpty()) BlockedReasons(reasons, Modifier.rise(390, 14.dp, 600))
    }
    Box(Modifier.padding(horizontal = 20.dp)) {
        ButtonRow {
            SaarthiButton(
                stringResource(R.string.checklist_back_to_check),
                onReview,
                Modifier.weight(1f),
                tone = ButtonTone.SECONDARY,
            )
            SaarthiButton(stringResource(R.string.action_close), onClose, Modifier.weight(1f))
        }
    }
}

/** What stopped the trip, one line each, scrolling if a fleet's list is long. */
@Composable
private fun BlockedReasons(reasons: List<String>, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(
        modifier
            .fillMaxWidth()
            .card(radius = 20.dp)
            .heightIn(max = 200.dp)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Eyebrow(stringResource(R.string.checklist_blocked_reasons), color = c.danger)
        reasons.forEach { reason ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                IconWell(Lucide.close, well = c.dangerSoft, ink = c.danger, size = 28.dp, shape = CircleShape, iconSize = 14.dp, stroke = 2.6f)
                Text(reason, style = SType.bodyStrong, color = c.fg)
            }
        }
    }
}

/**
 * Something did not arrive — the checklist, or the verdict on it. Answers and
 * notes are kept in the view model and here, so Try again costs one tap.
 */
@Composable
private fun ColumnScope.RetryEnding(
    title: String,
    body: String,
    offline: Boolean,
    onRetry: () -> Unit,
    onBack: (() -> Unit)?,
) {
    FlowOutcome(
        tone = OutcomeTone.WARNING,
        title = title,
        body = body,
        icon = if (offline) Lucide.cloudOff else Lucide.alertTriangle,
        modifier = Modifier
            .weight(1f)
            .fillMaxWidth()
            .padding(horizontal = 28.dp),
    )
    Box(Modifier.padding(horizontal = 20.dp)) {
        ButtonRow {
            onBack?.let {
                SaarthiButton(
                    stringResource(R.string.checklist_back_to_check),
                    it,
                    Modifier.weight(1f),
                    tone = ButtonTone.SECONDARY,
                )
            }
            SaarthiButton(stringResource(R.string.action_try_again), onRetry, Modifier.weight(1f))
        }
    }
}

/** How long the chosen answer shows before the next card slides in — the design's 380 ms. */
private const val ADVANCE_MS = 380L

/** How long "Safety check done" stays before the shell takes over — the design's 1.6 s. */
private const val DONE_HOLD_MS = 1_600L
