package com.saarthi.owner.ui.costs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.TollApi
import com.saarthi.owner.ui.common.DayField
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.ago
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.isNow
import com.saarthi.owner.ui.common.prettyDate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.papers.SlipKind
import com.saarthi.owner.ui.papers.SlipStep
import com.saarthi.owner.ui.papers.rememberSlipReader
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * One FASTag: what its bank last said, and — for whoever manages tolls — the
 * balance read off the bank's app, a recharge made there, or the bank asked
 * again where the plan includes the bank link. Nothing here moves money.
 */
@Composable
internal fun FastagScreen(app: OwnerApp, access: CostAccess, initial: TollApi.Tag, onChanged: () -> Unit) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    var tag by remember { mutableStateOf(initial) }
    var note by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }
    var syncing by remember { mutableStateOf(false) }
    val updated: (TollApi.Tag?, String) -> Unit = { fresh, message ->
        fresh?.let { tag = it }
        note = message to NoticeTone.SUCCESS
        onChanged()
    }

    DetailScreen(eyebrow = formatPlate(tag.registrationNumber), title = "FASTag") {
        Column(Modifier.fillMaxWidth().card(radius = 22.dp, ring = if (tag.needsAttention) c.warningRing else c.ring).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Eyebrow(tag.issuerBank.ifBlank { "FASTag" })
                    Text(tag.balance?.let(::rupees) ?: stringResource(R.string.costs_fastag_balance_unknown), style = SType.headerTitle, color = c.fg)
                }
                tagHealthWord(tag)?.let { StatusPill(it, background = if (tag.needsAttention) c.warningBg else c.sunken, ink = if (tag.needsAttention) c.warning else c.muted, dot = false) }
            }
            Text(
                listOfNotNull(
                    tag.tagId?.ifBlank { null },
                    tag.balanceUpdatedAt?.let { if (isNow(it)) stringResource(R.string.costs_fastag_balance_now) else stringResource(R.string.costs_fastag_balance_from, ago(it)) },
                    tag.lowBalanceThreshold.takeIf { it > 0 }?.let { stringResource(R.string.costs_fastag_warns_below, rupees(it)) },
                    prettyDate(tag.expiresAt)?.let { stringResource(R.string.costs_fastag_valid_till, it) },
                ).joinToString(" · "),
                style = SType.caption,
                color = c.muted,
            )
            tag.health.reasons.takeIf { it.isNotEmpty() }?.let { Text(it.joinToString(" · "), style = SType.caption, color = c.subtle) }
            tag.lastSyncError?.let { Text(stringResource(R.string.costs_fastag_bank_said, it), style = SType.caption, color = c.warning) }
        }
        note?.let { (text, tone) -> NoticeCard(text, tone) }

        if (access.manageToll && access.bankLink) {
            SaarthiButton(
                stringResource(R.string.costs_fastag_ask_bank),
                onClick = {
                    syncing = true
                    note = null
                    scope.launch {
                        try {
                            val synced = app.toll.sync(tag.id)
                            updated(synced?.fastag, synced?.coverageNote ?: Words.get(R.string.costs_fastag_synced))
                        } catch (failure: Exception) {
                            if (failure is CancellationException) throw failure
                            note = failure.readable() to NoticeTone.DANGER
                        } finally {
                            syncing = false
                        }
                    }
                },
                tone = ButtonTone.SECONDARY,
                leading = Lucide.refresh,
                busy = syncing,
                busyText = stringResource(R.string.costs_asking_bank),
                height = 48.dp,
            )
        }
        if (access.manageToll) {
            BalanceForm(app, tag) { fresh -> updated(fresh, Words.get(R.string.costs_fastag_balance_updated)) }
            RechargeForm(app, tag) { fresh, message -> updated(fresh, message ?: Words.get(R.string.costs_fastag_recharge_recorded)) }
        }
    }
}

/** The balance as read off the bank's app or SMS, and the day it was true. */
@Composable
private fun BalanceForm(app: OwnerApp, tag: TollApi.Tag, onDone: (TollApi.Tag?) -> Unit) {
    val scope = rememberCoroutineScope()
    var balance by remember { mutableStateOf("") }
    var day by remember { mutableStateOf<LocalDate?>(LocalDate.now()) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    // A screenshot of the bank's app or message: the balance it shows, and the day it showed it.
    val screen = rememberSlipReader(ReceiptText::read, ReadReceipt(), onProblem = { problem = it }) { found ->
        problem = null
        found.balance?.let { balance = it.typed() }
        found.date?.let { day = it }
    }
    GroupLabel(stringResource(R.string.costs_fastag_update_balance))
    SlipStep(screen, SlipKind.BALANCE, good = { it.balance != null })
    CompactField(balance, { balance = decimalOf(it, 9) }, stringResource(R.string.costs_fastag_balance), keyboardOptions = Decimal)
    DayField(stringResource(R.string.costs_fastag_when_true), day, onPick = { day = it }, latest = LocalDate.now())
    problem?.let { NoticeCard(it, NoticeTone.DANGER) }
    SaarthiButton(
        stringResource(R.string.costs_fastag_save_balance),
        onClick = {
            busy = true
            problem = null
            scope.launch {
                try {
                    onDone(app.toll.updateBalance(tag.id, balance.toDouble(), observedAt(day!!)))
                    balance = ""
                } catch (failure: Exception) {
                    if (failure is CancellationException) throw failure
                    problem = failure.readable()
                } finally {
                    busy = false
                }
            }
        },
        enabled = balance.toDoubleOrNull() != null && day != null && !busy && !screen.reading,
        busy = busy,
        busyText = stringResource(R.string.costs_saving),
        tone = ButtonTone.SECONDARY,
        height = 48.dp,
    )
}

/** A top-up made at the bank, noted here so the balance and the spend add up. */
@Composable
private fun RechargeForm(app: OwnerApp, tag: TollApi.Tag, onDone: (TollApi.Tag?, String?) -> Unit) {
    val scope = rememberCoroutineScope()
    var amount by remember { mutableStateOf("") }
    var after by remember { mutableStateOf("") }
    var reference by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val receipt = rememberSlipReader(ReceiptText::read, ReadReceipt(), onProblem = { problem = it }) { found ->
        problem = null
        found.amount?.let { amount = it.typed() }
        found.balance?.let { after = it.typed() }
        found.reference?.let { reference = it.take(120) }
    }
    GroupLabel(stringResource(R.string.costs_fastag_record_recharge_title))
    SlipStep(receipt, SlipKind.RECEIPT, good = { it.amount != null })
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        CompactField(amount, { amount = decimalOf(it, 7) }, stringResource(R.string.costs_fastag_amount_added), Modifier.weight(1f), keyboardOptions = Decimal)
        CompactField(after, { after = decimalOf(it, 9) }, stringResource(R.string.costs_fastag_balance_after), Modifier.weight(1f), keyboardOptions = Decimal)
    }
    CompactField(reference, { reference = it.take(120) }, stringResource(R.string.costs_reference_optional))
    problem?.let { NoticeCard(it, NoticeTone.DANGER) }
    SaarthiButton(
        stringResource(R.string.costs_fastag_record_recharge),
        onClick = {
            busy = true
            problem = null
            scope.launch {
                try {
                    // An older receipt is recorded on its own day, not today.
                    val madeAt = receipt.read?.date?.let(::observedAt) ?: java.time.Instant.now().toString()
                    val recorded = app.toll.recordRecharge(tag.id, amount.toDouble(), after.toDoubleOrNull(), reference.trim(), madeAt)
                    onDone(recorded?.fastag, recorded?.message)
                    amount = ""
                    after = ""
                    reference = ""
                } catch (failure: Exception) {
                    if (failure is CancellationException) throw failure
                    problem = failure.readable()
                } finally {
                    busy = false
                }
            }
        },
        enabled = (amount.toDoubleOrNull() ?: 0.0) > 0 && !busy && !receipt.reading,
        busy = busy,
        busyText = stringResource(R.string.costs_recording),
        tone = ButtonTone.SECONDARY,
        height = 48.dp,
        modifier = Modifier.padding(bottom = 4.dp),
    )
}

/** Today means now; an earlier day means that day's evening, when the bank's balance is usually read. */
private fun observedAt(day: LocalDate): String =
    if (day == LocalDate.now()) java.time.Instant.now().toString()
    else day.atTime(LocalTime.of(20, 0)).atZone(ZoneId.systemDefault()).toInstant().toString()
