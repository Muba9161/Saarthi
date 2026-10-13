package com.saarthi.owner.ui.fleet

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.saarthi.owner.network.FleetApi
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.plural
import com.saarthi.owner.ui.design.Avatar
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.NotesField
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton

/** The reasons an owner most often gives; any other is typed. */
private val Reasons = listOf(
    "Not assigned to this vehicle",
    "Vehicle is not ready",
    "I don't know this driver",
)

/**
 * A closer look at a waiting driver, with the two answers.
 *
 * Turning somebody down needs a reason because the server shows it to them —
 * a refusal with no reason leaves a driver at a truck with no idea what next.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReviewSheet(
    approval: FleetApi.Approval?,
    busy: Boolean,
    onApprove: (String) -> Unit,
    onReject: (String, String) -> Unit,
    onDismiss: () -> Unit,
) {
    val c = Saarthi.colors
    // Held while the sheet slides away, so it does not empty mid-exit.
    var shown by remember { mutableStateOf(approval) }
    if (approval != null) shown = approval
    var declining by remember(approval?.id) { mutableStateOf(false) }
    var reason by remember(approval?.id) { mutableStateOf("") }

    BottomSheet(visible = approval != null, onDismiss = onDismiss) {
        val current = shown ?: return@BottomSheet
        val name = current.driver?.name?.ifBlank { null } ?: "A driver"
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Avatar(name, size = 60.dp, brand = true)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(name, style = SType.sheetTitle, color = c.fg)
                    PlateChip(current.registrationNumber)
                }
            }
            current.driver?.let { driver ->
                Text(
                    "${plural(driver.experienceYears, "year")} driving · ${plural(driver.totalTrips, "trip")} on Saarthi",
                    style = SType.body,
                    color = c.muted,
                )
            }

            if (!declining) {
                SaarthiButton("Approve", onClick = { onApprove(current.id) }, busy = busy)
                SaarthiButton(
                    "Turn down",
                    onClick = { declining = true },
                    tone = ButtonTone.DANGER_OUTLINE,
                    enabled = !busy,
                )
            } else {
                Eyebrow("Why? The driver will see this")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Reasons.forEach { option ->
                        ChoiceChip(option, selected = reason == option, onClick = { reason = option })
                    }
                }
                NotesField(
                    value = reason,
                    onValueChange = { reason = it.take(500) },
                    label = "Or say it in your words",
                    minHeight = 80.dp,
                )
                SaarthiButton(
                    "Turn down",
                    onClick = { onReject(current.id, reason.trim()) },
                    tone = ButtonTone.DANGER_OUTLINE,
                    enabled = reason.trim().length >= 3 && !busy,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
