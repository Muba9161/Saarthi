package com.saarthi.owner.ui.papers

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.InlineSpinner
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import kotlinx.coroutines.CancellationException

/** The paper a form reads, as each sentence of [SlipStep] names it. */
internal enum class SlipKind(@StringRes val prompt: Int, @StringRes val scan: Int, @StringRes val reading: Int) {
    PUMP_SLIP(R.string.costs_slip_step_pump_prompt, R.string.costs_slip_step_pump_scan, R.string.costs_slip_step_pump_reading),
    BILL(R.string.costs_slip_step_bill_prompt, R.string.costs_slip_step_bill_scan, R.string.costs_slip_step_bill_reading),
    SLIP(R.string.costs_slip_step_slip_prompt, R.string.costs_slip_step_slip_scan, R.string.costs_slip_step_slip_reading),
    LOAN_LETTER(R.string.costs_slip_step_loan_prompt, R.string.costs_slip_step_loan_scan, R.string.costs_slip_step_loan_reading),
    RECEIPT(R.string.costs_slip_step_receipt_prompt, R.string.costs_slip_step_receipt_scan, R.string.costs_slip_step_receipt_reading),
    BALANCE(R.string.costs_slip_step_balance_prompt, R.string.costs_slip_step_balance_scan, R.string.costs_slip_step_balance_reading),
    ESTIMATE(R.string.costs_slip_step_estimate_prompt, R.string.costs_slip_step_estimate_scan, R.string.costs_slip_step_estimate_reading),
    LICENCE_CARD(R.string.papers_scan_licence_prompt, R.string.papers_scan_licence, R.string.papers_scan_licence_reading),
    CERTIFICATE(R.string.papers_scan_certificate_prompt, R.string.papers_scan_certificate, R.string.papers_scan_certificate_reading),
    WEIGH_SLIP(R.string.customer_scan_weigh_prompt, R.string.customer_scan_weigh, R.string.customer_scan_weigh_reading),
}

/**
 * The first step of a form that reads a slip: a photo of it, or one from the
 * gallery. Once picked it is named here, read while the spinner turns, and
 * [outcome] says what was filled in.
 */
@Composable
internal fun SlipStep(
    what: SlipKind,
    pickers: Pickers,
    picked: OwnerApi.Upload?,
    reading: Boolean,
    outcome: String?,
    outcomeGood: Boolean,
    onClear: () -> Unit,
) {
    val c = Saarthi.colors
    if (picked == null) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(what.prompt), style = SType.body, color = c.muted)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SaarthiButton(stringResource(what.scan), onClick = pickers.takePhoto, leading = Lucide.camera, modifier = Modifier.weight(1f))
                SaarthiButton(stringResource(R.string.costs_slip_step_gallery), onClick = pickers.chooseFile, tone = ButtonTone.SECONDARY, leading = Lucide.image, modifier = Modifier.weight(0.7f))
            }
        }
        return
    }
    Row(
        Modifier.fillMaxWidth().card(radius = 16.dp, elevated = false).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconWell(Lucide.receipt, well = c.primarySoft, ink = c.primary, size = 40.dp, radius = 12.dp)
        Column(Modifier.weight(1f)) {
            Text(picked.fileName, style = SType.smallStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (reading) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    InlineSpinner(c.primary, size = 14.dp)
                    Text(stringResource(what.reading), style = SType.caption, color = c.muted)
                }
            } else {
                outcome?.let { Text(it, style = SType.caption, color = if (outcomeGood) c.success else c.warning) }
            }
        }
        LinkButton(stringResource(R.string.costs_slip_step_change), onClick = onClear, enabled = !reading)
    }
}

/** A paper picked for a form to read on the phone, and what was read off it. */
@Stable
internal class SlipReader<T>(val pickers: Pickers, private val state: SlipState<T>) {
    val picked: OwnerApi.Upload? get() = state.picked
    val reading: Boolean get() = state.reading
    val read: T? get() = state.read
    fun clear() {
        state.picked = null
        state.read = null
    }
}

internal class SlipState<T> {
    var picked by mutableStateOf<OwnerApi.Upload?>(null)
    var reading by mutableStateOf(false)
    var read by mutableStateOf<T?>(null)
}

/**
 * Reads whatever paper is picked with [parse] and hands the result to
 * [onRead] to fill the form — or [nothing] when no text could be found on it,
 * so the form says so instead of waiting. The paper itself is only read here,
 * never sent anywhere.
 */
@Composable
internal fun <T> rememberSlipReader(parse: (String) -> T, nothing: T, onProblem: (String) -> Unit, onRead: (T) -> Unit): SlipReader<T> {
    val context = LocalContext.current
    val state = remember { SlipState<T>() }
    val fill by rememberUpdatedState(onRead)
    val complain by rememberUpdatedState(onProblem)
    val pickers = rememberPickers(imagesOnly = false) { picked ->
        picked.onSuccess { state.picked = it }.onFailure { complain(it.message ?: Words.get(R.string.costs_photo_unusable)) }
    }
    LaunchedEffect(state.picked) {
        val file = state.picked ?: return@LaunchedEffect
        state.reading = true
        val found = try {
            PaperScanner.text(context, file)?.let(parse) ?: nothing
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            nothing
        }
        fill(found)
        state.read = found
        state.reading = false
    }
    return SlipReader(pickers, state)
}

/** [SlipStep] for a [SlipReader]: what was read is good when [good] says so. */
@Composable
internal fun <T> SlipStep(
    reader: SlipReader<T>,
    what: SlipKind,
    good: (T) -> Boolean,
    @StringRes goodText: Int = R.string.costs_receipt_read_good,
    @StringRes noneText: Int = R.string.costs_receipt_read_none,
) {
    val read = reader.read
    SlipStep(
        what = what,
        pickers = reader.pickers,
        picked = reader.picked,
        reading = reader.reading,
        outcome = read?.let { stringResource(if (good(it)) goodText else noneText) },
        outcomeGood = read?.let(good) == true,
        onClear = reader::clear,
    )
}
