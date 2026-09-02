package com.saarthi.terminal.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.HelpOutline
import androidx.compose.material.icons.rounded.Sensors
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.saarthi.terminal.network.ChecklistItemDto
import com.saarthi.terminal.ui.Gutter
import com.saarthi.terminal.ui.PrimaryAction
import com.saarthi.terminal.ui.SaarthiDanger
import com.saarthi.terminal.ui.SaarthiSuccess
import com.saarthi.terminal.ui.SaarthiWarning
import com.saarthi.terminal.ui.SectionLabel
import com.saarthi.terminal.ui.SimulatedTag
import com.saarthi.terminal.ui.GlassCard
import com.saarthi.terminal.ui.StatusTone
import com.saarthi.terminal.ui.TerminalPage
import com.saarthi.terminal.ui.TerminalViewModel

/**
 * The mandatory pre-trip check (specification sections 17 and 18).
 *
 * The intelligent part is what each row *does not* claim. An item the vehicle
 * genuinely reported shows the number and its verdict, greyed out because the
 * driver cannot overrule a sensor. An item the vehicle cannot answer — which for
 * a tablet with no OBD adapter is most of them — asks the driver to look, and
 * says plainly that manual inspection is required. It never pre-ticks itself.
 *
 * That distinction is the whole point. A checklist that arrives with ten green
 * ticks is a checklist a driver taps through in four seconds, and the tyres go
 * unlooked-at. So the automated rows are the exception, they are visibly
 * different from the manual ones, and anything built on simulated data is
 * labelled where the driver cannot miss it.
 *
 * The verdicts here are advisory. The server recomputes every automated one from
 * the stored reading when the check is submitted, because a terminal that could
 * post its own coolant verdict could post a passing one.
 */
@Composable
fun ChecklistScreen(viewModel: TerminalViewModel, expanded: Boolean) {
    val preparation by viewModel.checklist.collectAsState()
    val answers by viewModel.checklistAnswers.collectAsState()
    val busy by viewModel.busy.collectAsState()
    val state by viewModel.uiState.collectAsState()

    var notes by remember { mutableStateOf("") }
    var failure by remember { mutableStateOf<List<String>?>(null) }

    LaunchedEffect(Unit) {
        if (preparation == null) viewModel.loadChecklist()
    }

    val items = preparation?.items.orEmpty()
    val manualItems = items.filter { it.manualInputRequired && it.required }
    val answered = manualItems.count { answers.containsKey(it.code) }
    val progress = if (manualItems.isEmpty()) 1f else answered.toFloat() / manualItems.size

    // The item list is a LazyColumn, which owns its own scrolling. Nesting it
    // in a scrolling parent gives it unbounded height and throws.
    TerminalPage(scrollable = false) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text(
                    preparation?.template?.name ?: "Pre-trip safety check",
                    style = MaterialTheme.typography.headlineSmall,
                )
                Text(
                    "${state.registration ?: ""} · $answered of ${manualItems.size} checked",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Spacer(Modifier.height(12.dp))

        LinearProgressIndicator(
            progress = { progress },
            modifier = Modifier
                .fillMaxWidth()
                .height(6.dp),
            color = SaarthiSuccess,
            trackColor = MaterialTheme.colorScheme.surfaceVariant,
        )

        Spacer(Modifier.height(Gutter))

        // Said once, at the top, where a driver signing off a vehicle cannot
        // miss it. Section 19: simulated data must never read as real ECU data.
        if (preparation?.usesSimulatedData == true) {
            Surface(
                color = SaarthiWarning.copy(alpha = 0.14f),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    Modifier.padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Rounded.Warning,
                        contentDescription = null,
                        tint = SaarthiWarning,
                        modifier = Modifier.size(20.dp),
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(
                        "Some readings below come from the on-device simulator, not from this vehicle's engine. " +
                            "Check those items yourself.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            Spacer(Modifier.height(Gutter))
        }

        failure?.let { blockers ->
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(14.dp)) {
                    Text(
                        "This vehicle cannot start a trip",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Blocked by: ${blockers.joinToString(", ")}. Your fleet has been told.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    )
                }
            }
            Spacer(Modifier.height(Gutter))
        }

        LazyColumn(
            Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(items, key = { it.code }) { item ->
                ChecklistRow(
                    item = item,
                    answer = answers[item.code],
                    onAnswer = { status -> viewModel.answerChecklistItem(item.code, status) },
                )
            }

            item {
                Spacer(Modifier.height(4.dp))
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("Anything else worth recording (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                )
            }
        }

        Spacer(Modifier.height(Gutter))

        PrimaryAction(
            label = when {
                busy -> "Submitting…"
                !viewModel.checklistComplete() ->
                    "Check the remaining ${manualItems.size - answered} item(s)"
                else -> "Complete the safety check"
            },
            // Deliberately not disabled-with-no-explanation: the label says what
            // is outstanding, so a driver is never left tapping a dead button.
            enabled = !busy && viewModel.checklistComplete(),
            tone = StatusTone.GOOD,
            onClick = {
                viewModel.submitChecklist(notes.ifBlank { null }) { result ->
                    failure = if (result?.outcome == "FAILED") result.blockedBy else null
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * One line of the checklist.
 *
 * Three shapes, and the visual difference between them is load-bearing:
 *
 *  * **Answered by the vehicle** — the reading, the verdict, no controls. The
 *    driver cannot overrule a sensor, and offering them a toggle would suggest
 *    they can.
 *  * **Answered by the driver** — two large targets, nothing pre-selected.
 *  * **Simulated** — as above, plus the label, because the number is invented.
 */
@Composable
private fun ChecklistRow(
    item: ChecklistItemDto,
    answer: String?,
    onAnswer: (String) -> Unit,
) {
    val automatic = !item.manualInputRequired && item.status != null
    val status = answer ?: item.status

    GlassCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            StatusGlyph(status, automatic)
            Spacer(Modifier.width(12.dp))

            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        item.label,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (item.simulated) {
                        Spacer(Modifier.width(8.dp))
                        SimulatedTag()
                    }
                }

                if (item.observedValue != null) {
                    Text(
                        buildString {
                            append(formatValue(item.observedValue))
                            item.unit?.let { append(" ").append(it) }
                        },
                        style = MaterialTheme.typography.headlineSmall,
                        color = toneFor(status),
                    )
                }

                item.detail?.let { detail ->
                    Text(
                        detail,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            if (automatic) {
                // A sensor answered. The row shows what it said and offers
                // nothing to press.
                Icon(
                    Icons.Rounded.Sensors,
                    contentDescription = "Answered by the vehicle",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(20.dp),
                )
            }
        }

        if (!automatic) {
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                AnswerButton(
                    label = "Good",
                    selected = answer == "OK",
                    tone = SaarthiSuccess,
                    modifier = Modifier.weight(1f),
                    onClick = { onAnswer("OK") },
                )
                AnswerButton(
                    label = "Needs attention",
                    selected = answer == "ATTENTION",
                    tone = SaarthiWarning,
                    modifier = Modifier.weight(1f),
                    onClick = { onAnswer("ATTENTION") },
                )
                if (item.blocking) {
                    // Only offered where it means something. A "faulty" verdict
                    // on a non-blocking item reads as a fault that stops the
                    // trip when it does not, which teaches drivers the button
                    // is meaningless.
                    AnswerButton(
                        label = "Faulty",
                        selected = answer == "CRITICAL",
                        tone = SaarthiDanger,
                        modifier = Modifier.weight(1f),
                        onClick = { onAnswer("CRITICAL") },
                    )
                }
            }
        }
    }
}

@Composable
private fun AnswerButton(
    label: String,
    selected: Boolean,
    tone: Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(
        modifier = modifier
            // 56dp minimum. The driver is standing beside a truck, often in
            // gloves, and Material's 48dp default is not enough for that.
            .height(56.dp)
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        color = if (selected) tone.copy(alpha = 0.22f) else MaterialTheme.colorScheme.surfaceVariant,
        border = if (selected) {
            androidx.compose.foundation.BorderStroke(2.dp, tone)
        } else {
            null
        },
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                label,
                style = MaterialTheme.typography.labelLarge,
                color = if (selected) tone else MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            )
        }
    }
}

/** Icon, colour and shape together. Never colour alone (section 60). */
@Composable
private fun StatusGlyph(status: String?, automatic: Boolean) {
    val (icon: ImageVector, tint: Color) = when (status) {
        "OK" -> Icons.Rounded.CheckCircle to SaarthiSuccess
        "ATTENTION" -> Icons.Rounded.Warning to SaarthiWarning
        "CRITICAL" -> Icons.Rounded.ErrorOutline to SaarthiDanger
        else -> Icons.Rounded.HelpOutline to MaterialTheme.colorScheme.onSurfaceVariant
    }

    Box(
        Modifier
            .size(44.dp)
            .background(tint.copy(alpha = if (automatic) 0.14f else 0.08f), RoundedCornerShape(12.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = status ?: "Not checked", tint = tint, modifier = Modifier.size(24.dp))
    }
}

@Composable
private fun toneFor(status: String?): Color = when (status) {
    "OK" -> SaarthiSuccess
    "ATTENTION" -> SaarthiWarning
    "CRITICAL" -> SaarthiDanger
    else -> MaterialTheme.colorScheme.onSurface
}

private fun formatValue(value: Double): String =
    if (value == value.toLong().toDouble()) value.toLong().toString() else "%.1f".format(value)
