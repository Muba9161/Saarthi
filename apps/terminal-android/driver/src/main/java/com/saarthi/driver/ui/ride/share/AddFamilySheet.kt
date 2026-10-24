package com.saarthi.driver.ui.ride.share

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.saarthi.driver.R
import com.saarthi.driver.data.FamilyContact
import com.saarthi.driver.ui.design.BottomSheet
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SaarthiButton

/**
 * "Add family" while sharing: one more person, by mobile number or email
 * address, told at once if they use Saarthi. The lead says the link is still
 * the way to reach everybody, so nobody is left believing a contact alone has
 * done it.
 *
 * A refusal stays on the sheet with the server's words, so the contact can be
 * corrected without typing it again.
 */
@Composable
internal fun AddFamilySheet(
    visible: Boolean,
    busy: Boolean,
    error: String?,
    onAdd: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val c = Saarthi.colors
    var contact by remember(visible) { mutableStateOf("") }
    var checked by remember(visible) { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(visible) { if (visible) runCatching { focus.requestFocus() } }

    val add: () -> Unit = {
        checked = true
        val normalised = FamilyContact.normalised(contact)
        if (FamilyContact.isValid(normalised) && !busy) onAdd(normalised)
    }

    BackHandler(enabled = visible, onBack = onDismiss)
    BottomSheet(visible = visible, onDismiss = { if (!busy) onDismiss() }) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(stringResource(R.string.share_add_title), style = SType.sheetTitle, color = c.fg)
            Text(stringResource(R.string.share_add_lead), style = SType.lead, color = c.muted)
            FamilyContactField(
                value = contact,
                onValueChange = { contact = it },
                checked = checked,
                focus = focus,
                onDone = add,
            )
            error?.let { NoticeCard(it, NoticeTone.DANGER) }
            SaarthiButton(
                stringResource(R.string.share_add_action),
                add,
                busy = busy,
                busyText = stringResource(R.string.share_adding),
                leading = Lucide.plus,
            )
            LinkButton(
                stringResource(R.string.action_not_now),
                onDismiss,
                Modifier.align(Alignment.CenterHorizontally),
                color = c.muted,
                weight = FontWeight.Medium,
                enabled = !busy,
            )
        }
    }
}
