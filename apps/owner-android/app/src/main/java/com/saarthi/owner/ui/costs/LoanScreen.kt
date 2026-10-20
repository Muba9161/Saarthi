package com.saarthi.owner.ui.costs

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.LoansApi
import com.saarthi.owner.ui.common.DayField
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.FigureRow
import com.saarthi.owner.ui.common.FigureTile
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.prettyDate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SaarthiSwitch
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.papers.SlipKind
import com.saarthi.owner.ui.papers.SlipStep
import com.saarthi.owner.ui.papers.rememberSlipReader
import java.time.LocalDate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * One loan, as the web's loan page has it: the EMI, what falls due next, what
 * is still owed and how much is repaid; the repayment schedule; the payments
 * made; the terms; reminders; and the way to note a payment made at the bank.
 */
@Composable
internal fun LoanScreen(app: OwnerApp, access: CostAccess, loanId: String, onChanged: () -> Unit) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    var attempt by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Loadable<LoansApi.Loan>>(Loadable.Loading) }
    // The EMI a payment is noted against (none for a prepayment), the sheet, and a fresh form each opening.
    var paying by remember { mutableStateOf<LoansApi.Installment?>(null) }
    var sheetOpen by remember { mutableStateOf(false) }
    var opening by remember { mutableIntStateOf(0) }
    var reminderProblem by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(loanId, attempt) {
        state = try {
            app.loans.get(loanId)?.let { Loadable.Ready(it) } ?: Loadable.Failed(Words.get(R.string.costs_loan_not_found))
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            Loadable.Failed(failure.readable())
        }
    }
    val loan = (state as? Loadable.Ready)?.value

    DetailScreen(
        eyebrow = loan?.let { listOfNotNull(formatPlate(it.registrationNumber), it.loanNumber).filter(String::isNotBlank).joinToString(" · ") } ?: stringResource(R.string.costs_loan),
        title = loan?.lenderName ?: stringResource(R.string.costs_loan),
        footer = if (loan != null && access.manageLoans && loan.active) {
            {
                SaarthiButton(
                    stringResource(R.string.costs_loan_record_payment),
                    onClick = {
                        paying = loan.installments.firstOrNull { it.payable }
                        sheetOpen = true
                        opening++
                    },
                    leading = Lucide.receipt,
                )
            }
        } else {
            null
        },
    ) {
        when (val shown = state) {
            Loadable.Loading -> SkeletonCards(count = 3)
            is Loadable.Failed -> FailedCard(shown.message, { attempt++ })
            is Loadable.Ready -> {
                val current = shown.value
                if (current.overdueInstallments > 0) {
                    NoticeCard(pluralStringResource(R.plurals.costs_loan_overdue_notice, current.overdueInstallments, current.overdueInstallments, rupees(current.overdueAmount)), NoticeTone.WARNING)
                }
                FigureRow {
                    FigureTile(stringResource(R.string.costs_emi), rupees(current.emiAmount), "", Modifier.weight(1f))
                    FigureTile(stringResource(R.string.costs_loan_next_due), prettyDate(current.nextDueDate) ?: "—", "", Modifier.weight(1.2f))
                }
                FigureRow {
                    FigureTile(stringResource(R.string.costs_outstanding), rupees(current.totalOutstanding), "", Modifier.weight(1.2f))
                    FigureTile(stringResource(R.string.costs_loan_repaid), "${current.paidInstallments}/${current.paidInstallments + current.remainingInstallments}", stringResource(R.string.costs_loan_emis_unit), Modifier.weight(1f))
                }

                if (access.manageLoans) {
                    Row(Modifier.fillMaxWidth().card(radius = 18.dp).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(stringResource(R.string.costs_loan_reminders), style = SType.bodyStrong, color = c.fg)
                            Text(stringResource(R.string.costs_loan_reminders_detail), style = SType.caption, color = c.muted)
                        }
                        SaarthiSwitch(
                            checked = current.remindersEnabled,
                            label = stringResource(R.string.costs_loan_reminders),
                            onCheckedChange = { on ->
                                reminderProblem = null
                                scope.launch {
                                    try {
                                        app.loans.setReminders(current.id, on)?.let { state = Loadable.Ready(it.withListsOf(current)) }
                                    } catch (failure: Exception) {
                                        if (failure is CancellationException) throw failure
                                        reminderProblem = failure.readable()
                                    }
                                }
                            },
                        )
                    }
                    reminderProblem?.let { NoticeCard(it, NoticeTone.DANGER) }
                }

                GroupLabel(stringResource(R.string.costs_loan_schedule))
                if (current.installments.isEmpty()) Hint(stringResource(R.string.costs_loan_no_schedule))
                current.installments.forEach { installment ->
                    CostRow(
                        title = stringResource(R.string.costs_emi_number_on, installment.number, prettyDate(installment.dueDate) ?: installment.dueDate),
                        detail = installment.closingBalance?.let { stringResource(R.string.costs_loan_installment_detail_left, rupees(installment.principal), rupees(installment.interest), rupees(it)) }
                            ?: stringResource(R.string.costs_loan_installment_detail, rupees(installment.principal), rupees(installment.interest)),
                        trailing = rupees(if (installment.payable) installment.outstanding else installment.totalDue),
                        badge = installmentWord(installment.status)?.let { it to (installment.status == "OVERDUE" || installment.status == "DUE_TODAY") },
                        onClick = if (access.manageLoans && current.active && installment.payable) {
                            {
                                paying = installment
                                sheetOpen = true
                                opening++
                            }
                        } else {
                            null
                        },
                    )
                }

                if (current.payments.isNotEmpty()) {
                    GroupLabel(stringResource(R.string.costs_loan_payments))
                    current.payments.forEach { payment ->
                        CostRow(
                            title = rupees(payment.amount + payment.penalty),
                            detail = listOfNotNull(
                                payment.installmentNumber?.let { stringResource(R.string.costs_emi_number, it) } ?: stringResource(R.string.costs_loan_prepayment),
                                LoansApi.METHODS.firstOrNull { it.first == payment.method }?.second,
                                payment.reference,
                                prettyDate(payment.paidAt),
                            ).joinToString(" · "),
                            trailing = null,
                            badge = if (payment.reversedAt != null) stringResource(R.string.costs_loan_reversed) to true else null,
                        )
                    }
                }

                GroupLabel(stringResource(R.string.costs_loan_terms))
                Column(Modifier.fillMaxWidth().card(radius = 18.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Term(stringResource(R.string.costs_lender), listOfNotNull(current.lenderName, current.lenderBranch).joinToString(", "))
                    Term(stringResource(R.string.costs_loan_borrowed), rupees(current.principal))
                    Term(stringResource(R.string.costs_loan_interest), stringResource(if (current.interestType == "FLAT") R.string.costs_loan_rate_flat else R.string.costs_loan_rate, current.annualRatePercent))
                    Term(stringResource(R.string.costs_loan_tenure), pluralStringResource(R.plurals.costs_loan_tenure_months, current.tenureMonths, current.tenureMonths))
                    Term(stringResource(R.string.costs_loan_runs), runsBetween(prettyDate(current.startDate), prettyDate(current.endDate)))
                    current.autoDebitDay?.let { Term(stringResource(R.string.costs_loan_auto_debit), stringResource(R.string.costs_loan_auto_debit_day, it)) }
                    Term(stringResource(R.string.costs_loan_standing), loanStatusWord(current.status))
                }
            }
        }
    }

    // Beside the page, not in it, so it rises over the whole screen.
    BottomSheet(visible = sheetOpen && loan != null, onDismiss = { sheetOpen = false }) {
        val current = loan ?: return@BottomSheet
        key(opening) {
            PaymentForm(app, current, paying) { updated ->
                state = Loadable.Ready(updated)
                sheetOpen = false
                onChanged()
            }
        }
    }
}

/** The reminder switch answers with the summary only; keep the schedule already on screen. */
private fun LoansApi.Loan.withListsOf(loan: LoansApi.Loan): LoansApi.Loan =
    if (installments.isEmpty() && payments.isEmpty()) copy(installments = loan.installments, payments = loan.payments) else this

/** When a loan runs: both days when both are known, else the one that is. */
@Composable
private fun runsBetween(start: String?, end: String?): String =
    if (start != null && end != null) stringResource(R.string.costs_loan_runs_span, start, end) else start ?: end.orEmpty()

@Composable
private fun Term(label: String, value: String) {
    val c = Saarthi.colors
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, style = SType.small, color = c.muted, modifier = Modifier.weight(0.4f))
        Text(value, style = SType.smallStrong, color = c.fg, modifier = Modifier.weight(0.6f))
    }
}

/** A payment made at the bank, noted against an EMI (or as a prepayment when none is picked). */
@Composable
private fun PaymentForm(app: OwnerApp, loan: LoansApi.Loan, initial: LoansApi.Installment?, onRecorded: (LoansApi.Loan) -> Unit) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    val payable = loan.installments.filter { it.payable }
    var installment by remember { mutableStateOf(initial) }
    var amount by remember { mutableStateOf(initial?.outstanding?.typed().orEmpty()) }
    var paidOn by remember { mutableStateOf<LocalDate?>(LocalDate.now()) }
    var method by remember { mutableStateOf("BANK_TRANSFER") }
    var reference by remember { mutableStateOf("") }
    var lateFee by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    // The bank's receipt or message fills the payment: how much, the day, how, and its reference.
    val receipt = rememberSlipReader(ReceiptText::read, ReadReceipt(), onProblem = { problem = it }) { found ->
        problem = null
        found.amount?.let { amount = it.typed() }
        found.date?.let { paidOn = it }
        found.method?.let { method = it }
        found.reference?.let { reference = it.take(120) }
    }
    val value = amount.toDoubleOrNull()

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(stringResource(R.string.costs_loan_record_payment), style = SType.sheetTitle, color = c.fg)
        Text(stringResource(R.string.costs_loan_payment_intro), style = SType.small, color = c.muted)
        SlipStep(receipt, SlipKind.RECEIPT, good = { it.foundAnything })
        Eyebrow(stringResource(R.string.costs_loan_payment_against))
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            payable.take(MAX_CHOICES).forEach { option ->
                ChoiceChip(stringResource(R.string.costs_emi_number, option.number), selected = installment?.id == option.id, onClick = { installment = option; amount = option.outstanding.typed() }, height = 36.dp)
            }
            ChoiceChip(stringResource(R.string.costs_loan_prepayment), selected = installment == null, onClick = { installment = null }, height = 36.dp)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CompactField(amount, { amount = decimalOf(it) }, stringResource(R.string.costs_loan_amount_paid), Modifier.weight(1f), keyboardOptions = Decimal)
            CompactField(lateFee, { lateFee = decimalOf(it) }, stringResource(R.string.costs_loan_late_fee), Modifier.weight(1f), keyboardOptions = Decimal)
        }
        DayField(stringResource(R.string.costs_loan_paid_on), paidOn, onPick = { paidOn = it }, latest = LocalDate.now())
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LoansApi.METHODS.forEach { (code, label) -> ChoiceChip(label, selected = method == code, onClick = { method = code }, height = 36.dp) }
        }
        CompactField(reference, { reference = it.take(120) }, stringResource(R.string.costs_reference_optional), placeholder = stringResource(R.string.costs_loan_reference_placeholder))
        problem?.let { NoticeCard(it, NoticeTone.DANGER) }
        SaarthiButton(
            stringResource(R.string.costs_loan_record_payment_button),
            onClick = {
                busy = true
                problem = null
                scope.launch {
                    try {
                        app.loans.recordPayment(
                            loanId = loan.id,
                            amount = value!!,
                            installmentId = installment?.id,
                            paidOn = paidOn!!.toString(),
                            method = method,
                            reference = reference.trim(),
                            penalty = lateFee.toDoubleOrNull(),
                        )?.let(onRecorded)
                    } catch (failure: Exception) {
                        if (failure is CancellationException) throw failure
                        problem = failure.readable()
                    } finally {
                        busy = false
                    }
                }
            },
            enabled = (value ?: 0.0) > 0 && paidOn != null && !busy && !receipt.reading,
            busy = busy,
            busyText = stringResource(R.string.costs_recording),
            modifier = Modifier.padding(bottom = 4.dp),
        )
    }
}

/** EMIs offered to pay against: the next few still owed. */
private const val MAX_CHOICES = 6
