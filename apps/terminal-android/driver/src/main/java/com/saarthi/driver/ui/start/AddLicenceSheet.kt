package com.saarthi.driver.ui.start

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.saarthi.driver.R
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.auth.LicenceCard
import com.saarthi.driver.ui.auth.LicenceField
import com.saarthi.driver.ui.design.BottomSheet
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SuccessDisc
import com.saarthi.driver.ui.design.brandGradient
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger

/**
 * Add the driving licence skipped at sign-up.
 *
 * The server takes it once; after that it is the fleet's record to change, and
 * a second attempt comes back as a sentence that appears here.
 */
@Composable
fun AddLicenceSheet(
    visible: Boolean,
    viewModel: DriverViewModel,
    onDismiss: () -> Unit,
) {
    val busy by viewModel.busy.collectAsState()
    val error by viewModel.error.collectAsState()
    var number by rememberSaveable { mutableStateOf("") }
    var saving by rememberSaveable { mutableStateOf(false) }
    var saved by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(busy) { if (!busy) saving = false }
    LaunchedEffect(visible) {
        if (visible) {
            number = ""
            saved = false
            // An earlier screen's message is not this sheet's to show.
            viewModel.clearError()
        }
    }

    BottomSheet(visible = visible, onDismiss = { if (!saving) onDismiss() }) {
        if (saved) {
            SavedContent(onDismiss)
            return@BottomSheet
        }
        val c = Saarthi.colors
        val ready = number.trim().length >= 4
        val save = {
            saving = true
            viewModel.addLicence(number) { saved = true }
        }
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(
                Modifier.rise(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Box(
                    Modifier
                        .size(52.dp)
                        .brandGradient(RoundedCornerShape(16.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    LineIcon(Lucide.creditCard, size = 24.dp, color = Color.White)
                }
                Column {
                    Text(stringResource(R.string.licence_sheet_title), style = SType.sheetTitle, color = c.fg)
                    Text(stringResource(R.string.register_licence_lead), style = SType.body, color = c.muted)
                }
            }
            LicenceCard(number, Modifier.rise(stagger(1)))
            LicenceField(
                value = number,
                onValueChange = { number = it },
                onDone = { if (ready && !saving) save() },
                modifier = Modifier.rise(stagger(2)),
            )
            error?.let { NoticeCard(it, NoticeTone.DANGER) }
            SaarthiButton(
                stringResource(R.string.licence_save),
                save,
                Modifier.rise(stagger(3)),
                enabled = ready,
                busy = saving && busy,
                busyText = stringResource(R.string.licence_saving),
            )
            LinkButton(
                stringResource(R.string.action_not_now),
                onDismiss,
                Modifier
                    .align(Alignment.CenterHorizontally)
                    .rise(stagger(4)),
                color = c.muted,
                weight = FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun SavedContent(onDone: () -> Unit) {
    val c = Saarthi.colors
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 10.dp, bottom = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        SuccessDisc(size = 96.dp, disc = c.successSoft, tick = c.success, halo = c.successWash, haloWidth = 12.dp, tickSize = 46.dp)
        Text(
            stringResource(R.string.licence_saved_title),
            style = SType.sheetTitle,
            color = c.fg,
            textAlign = TextAlign.Center,
            modifier = Modifier.rise(stagger(2)),
        )
        Text(
            stringResource(R.string.licence_saved_body),
            style = SType.lead,
            color = c.muted,
            textAlign = TextAlign.Center,
            modifier = Modifier.rise(stagger(3)),
        )
        SaarthiButton(stringResource(R.string.action_done), onDone, Modifier.padding(top = 6.dp).rise(stagger(4)))
    }
}
