@file:OptIn(ExperimentalLayoutApi::class)

package com.saarthi.driver.ui.shift.vehicle

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.core.network.IssueDto
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.ChoiceChip
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.MapInk
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.NotesField
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.popIn
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.shift.humanised

/** The categories the server accepts for a reported problem, in the order the design shows them. */
private enum class IssueCategory(@StringRes val label: Int) {
    ENGINE(R.string.vehicle_issue_engine),
    TYRE(R.string.vehicle_issue_tyre),
    BRAKE(R.string.vehicle_issue_brake),
    ELECTRICAL(R.string.vehicle_issue_electrical),
    ACCIDENT(R.string.vehicle_issue_accident),
    BODY(R.string.vehicle_issue_body),
    OTHER(R.string.vehicle_issue_other),
}

/** Where the fleet has got to with a problem. */
private enum class IssueStatus(@StringRes val label: Int) {
    OPEN(R.string.vehicle_issue_status_open),
    ACKNOWLEDGED(R.string.vehicle_issue_status_acknowledged),
    IN_PROGRESS(R.string.vehicle_issue_status_in_progress),
    RESOLVED(R.string.vehicle_issue_status_resolved),
    DISMISSED(R.string.vehicle_issue_status_dismissed),
}

/**
 * Problems reported against this vehicle, and the form to report another.
 *
 * The form closes and clears only once the fleet has the report; a failed send
 * keeps what the driver typed, because typing it again from a cab is the step
 * most people skip.
 */
@Composable
internal fun IssuesSection(cockpit: TerminalViewModel, offline: Boolean) {
    val issues by cockpit.issues.collectAsState()
    var reporting by rememberSaveable { mutableStateOf(false) }
    var category by rememberSaveable { mutableStateOf(IssueCategory.ENGINE) }
    var description by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    // The ids on screen before the last report, so the one just sent can pop in.
    var known by remember { mutableStateOf<Set<String>?>(null) }
    val sendFailed = stringResource(R.string.vehicle_report_failed)

    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Eyebrow(stringResource(R.string.vehicle_problems_title), Modifier.weight(1f))
        LinkButton(
            stringResource(if (reporting) R.string.action_cancel else R.string.vehicle_report_open),
            {
                reporting = !reporting
                failure = null
            },
            color = MapInk.primaryInk,
            style = SType.buttonSmall,
        )
    }

    if (reporting) {
        ReportForm(
            category = category,
            onCategory = { category = it },
            description = description,
            onDescription = { description = it.take(MAX_DESCRIPTION) },
            sending = sending,
            failure = failure,
            onSend = {
                sending = true
                failure = null
                known = issues.map { it.id }.toSet()
                cockpit.reportIssue(category.name, description.trim()) { sent ->
                    sending = false
                    if (sent) {
                        description = ""
                        reporting = false
                    } else {
                        failure = cockpit.lastError.value ?: sendFailed
                    }
                }
            },
        )
    }

    when {
        issues.isNotEmpty() -> issues.take(SHOWN_ISSUES).forEach { issue ->
            key(issue.id) {
                val justSent = known?.let { issue.id !in it } == true
                IssueRow(issue, if (justSent) Modifier.popIn(from = 0.8f) else Modifier)
            }
        }
        offline -> Text(stringResource(R.string.vehicle_issues_offline), style = SType.body, color = Saarthi.colors.muted)
        else -> Text(stringResource(R.string.vehicle_issues_none), style = SType.body, color = Saarthi.colors.muted)
    }
}

@Composable
private fun ReportForm(
    category: IssueCategory,
    onCategory: (IssueCategory) -> Unit,
    description: String,
    onDescription: (String) -> Unit,
    sending: Boolean,
    failure: String?,
    onSend: () -> Unit,
) {
    val c = Saarthi.colors
    Column(
        Modifier
            .fillMaxWidth()
            .rise(distance = 14.dp, durationMs = 600)
            .clip(RoundedCornerShape(18.dp))
            .background(c.elevated)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            IssueCategory.entries.forEach { option ->
                ChoiceChip(
                    stringResource(option.label),
                    selected = option == category,
                    onClick = { onCategory(option) },
                    onColor = c.primary,
                    onInk = c.onPrimary,
                    offColor = c.sunken,
                    offInk = MapInk.soft,
                    height = 38.dp,
                )
            }
        }
        NotesField(
            description,
            onDescription,
            stringResource(R.string.vehicle_report_label),
            background = c.card,
            border = c.input,
            minHeight = 92.dp,
        )
        failure?.let { NoticeCard(it, NoticeTone.DANGER) }
        SaarthiButton(
            stringResource(R.string.vehicle_report_send),
            onSend,
            enabled = description.trim().length >= MIN_DESCRIPTION,
            busy = sending,
            busyText = stringResource(R.string.vehicle_report_sending),
            height = 52.dp,
            textStyle = SType.bodyStrong,
        )
    }
}

/** "Tyre · Resolved" over what was said, coloured by where the fleet has got to. */
@Composable
private fun IssueRow(issue: IssueDto, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val category = IssueCategory.entries.firstOrNull { it.name == issue.category }
    val status = IssueStatus.entries.firstOrNull { it.name == issue.status }
    val ink: Color = when (status) {
        IssueStatus.OPEN -> c.warning
        IssueStatus.ACKNOWLEDGED, IssueStatus.IN_PROGRESS -> c.info
        IssueStatus.RESOLVED -> c.success
        IssueStatus.DISMISSED, null -> c.subtle
    }
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(c.elevated)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            stringResource(
                R.string.vehicle_issue_head,
                category?.let { stringResource(it.label) } ?: issue.category.humanised(),
                status?.let { stringResource(it.label) } ?: issue.status.humanised(),
            ),
            style = SType.smallStrong,
            color = ink,
        )
        Text(issue.description, style = SType.body, color = MapInk.soft)
    }
}

/** The server's own bounds on a description. */
private const val MIN_DESCRIPTION = 3
private const val MAX_DESCRIPTION = 2_000

/** As many as the old sheet showed; the fleet's dashboard holds the full history. */
private const val SHOWN_ISSUES = 5
