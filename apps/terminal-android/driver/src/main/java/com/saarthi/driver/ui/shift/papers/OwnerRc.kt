package com.saarthi.driver.ui.shift.papers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.driver.R
import com.saarthi.driver.network.OwnerRcApi
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.Hint
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.PinDots
import com.saarthi.driver.ui.design.PinKeypad
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.card

/**
 * Under the masked RC, for an owner: "Show full RC", the Secure PIN, and the
 * fields the mask hid.
 *
 * Nothing at all for anyone who could never be shown it, so a hired driver
 * sees the card exactly as before. Leaving the folder hides the record again.
 */
@Composable
internal fun OwnerRcControls(registrationNumber: String, modifier: Modifier = Modifier) {
    val owner: OwnerRcViewModel = viewModel()
    val offered by owner.offered.collectAsState()
    val ui by owner.ui.collectAsState()
    DisposableEffect(Unit) { onDispose { owner.hide() } }
    if (!offered) return

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        when (ui.stage) {
            OwnerRcViewModel.Stage.IDLE, OwnerRcViewModel.Stage.CHECKING -> {
                SaarthiButton(
                    stringResource(R.string.owner_rc_show),
                    { owner.open(registrationNumber) },
                    tone = ButtonTone.SECONDARY,
                    leading = Lucide.lock,
                    busy = ui.stage == OwnerRcViewModel.Stage.CHECKING,
                )
                Hint(stringResource(R.string.owner_rc_show_sub))
            }
            OwnerRcViewModel.Stage.NEEDS_PIN -> PinEntry(ui, owner::enterPin, owner::hide)
            OwnerRcViewModel.Stage.SHOWING -> ui.record?.let { FullRc(it, owner::hide) }
            OwnerRcViewModel.Stage.NEEDS_OWNERSHIP ->
                NoticeCard(stringResource(R.string.owner_rc_needs_ownership), NoticeTone.INFO)
            OwnerRcViewModel.Stage.NO_PIN ->
                NoticeCard(stringResource(R.string.owner_rc_no_pin), NoticeTone.INFO)
        }
        ui.problem?.let { NoticeCard(it, NoticeTone.DANGER) }
    }
}

/** Four digits on the design's keypad, sent the moment the fourth lands. */
@Composable
private fun PinEntry(ui: OwnerRcViewModel.Ui, onPin: (String) -> Unit, onCancel: () -> Unit) {
    val c = Saarthi.colors
    var pin by remember { mutableStateOf("") }
    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 20.dp)
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(stringResource(R.string.owner_rc_pin_title), style = SType.bodyStrong, color = c.fg)
        Text(stringResource(R.string.owner_rc_pin_sub), style = SType.small, color = c.muted)
        PinDots(entered = pin.length, shakeKey = ui.shake)
        PinKeypad(
            onDigit = { digit ->
                if (pin.length < PIN_LENGTH) {
                    pin += digit
                    if (pin.length == PIN_LENGTH) {
                        onPin(pin)
                        pin = ""
                    }
                }
            },
            onBackspace = { pin = pin.dropLast(1) },
            keyHeight = 52.dp,
            enabled = !ui.busy,
        )
        SaarthiButton(stringResource(R.string.owner_rc_cancel), onCancel, tone = ButtonTone.SECONDARY, height = 48.dp)
    }
}

/** What the mask hid, and only that — the rest is already on the card above. */
@Composable
private fun FullRc(record: OwnerRcApi.RcRecord, onHide: () -> Unit) {
    RecordSection(R.string.owner_rc_title) {
        Field(R.string.papers_rc_owner, record.owner?.name)
        Field(R.string.owner_rc_father, record.owner?.fatherName)
        Field(R.string.owner_rc_mobile, record.owner?.mobileNumber)
        Field(R.string.owner_rc_address, record.owner?.permanentAddress ?: record.owner?.presentAddress)
        Field(R.string.papers_rc_chassis, record.chassisNumber)
        Field(R.string.papers_rc_engine, record.engineNumber)
        Field(R.string.owner_rc_policy, record.insurancePolicyNumber)
    }
    Hint(stringResource(R.string.owner_rc_hides))
    SaarthiButton(stringResource(R.string.owner_rc_hide), onHide, tone = ButtonTone.SECONDARY, leading = Lucide.eyeOff)
}

/** `securePinSchema`: four digits. */
private const val PIN_LENGTH = 4
