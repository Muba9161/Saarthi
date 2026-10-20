package com.saarthi.owner.ui.costs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.LoansApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DayField
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.prettyDate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SegmentedControl
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.papers.SlipKind
import com.saarthi.owner.ui.papers.SlipStep
import com.saarthi.owner.ui.papers.rememberSlipReader
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.tracking.attempt
import java.time.LocalDate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * A vehicle's loan, as the web's add-loan form takes it: who lent it, how
 * much, at what rate and for how long — read off the sanction letter or EMI
 * schedule where there is one — with the schedule those terms make, worked
 * out by the server as they are typed. The letter is only read, not kept.
 */
@Composable
internal fun AddLoanScreen(app: OwnerApp, vehicle: VehiclesApi.Vehicle?, onAdded: (String) -> Unit) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var vehicles by remember { mutableStateOf(listOfNotNull(vehicle)) }
    var vehicleId by remember { mutableStateOf(vehicle?.id) }
    var lender by remember { mutableStateOf("") }
    var number by remember { mutableStateOf("") }
    var principal by remember { mutableStateOf("") }
    var rate by remember { mutableStateOf("") }
    var tenure by remember { mutableStateOf("") }
    var flat by remember { mutableStateOf(false) }
    var start by remember { mutableStateOf<LocalDate?>(LocalDate.now()) }
    var firstDue by remember { mutableStateOf<LocalDate?>(LocalDate.now().plusMonths(1)) }
    var debitDay by remember { mutableStateOf("") }
    var lenderEmi by remember { mutableStateOf("") }
    var preview by remember { mutableStateOf<LoansApi.Preview?>(null) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val letter = rememberSlipReader(LoanText::read, ReadLoan(), onProblem = { problem = it }) { found ->
        problem = null
        found.lender?.let { lender = it }
        found.loanNumber?.takeIf { LOAN_NUMBER.matches(it) }?.let { number = it }
        found.principal?.let { principal = it.typed() }
        found.ratePercent?.let { rate = it.typed() }
        found.tenureMonths?.let { tenure = it.toString() }
        found.flat?.let { flat = it }
        found.emi?.let { lenderEmi = it.typed() }
        found.debitDay?.let { debitDay = it.toString() }
        found.firstDue?.let { firstDue = it }
        // A letter that gives the first EMI but not the start: the loan started a month before it, as this form assumes.
        (found.startDate ?: found.firstDue?.minusMonths(1))?.let { start = it }
        found.plate?.let { plate -> vehicles.firstOrNull { it.registrationNumber.filter(Char::isLetterOrDigit).equals(plate, true) }?.let { vehicleId = it.id } }
    }

    LaunchedEffect(Unit) {
        if (vehicle == null) attempt { app.vehicles.list() }?.let { vehicles = it }
    }

    val terms = run {
        val p = principal.toDoubleOrNull()?.takeIf { it > 0 }
        val r = rate.toDoubleOrNull()?.takeIf { it in 0.0..60.0 }
        val t = tenure.toIntOrNull()?.takeIf { it in 1..360 }
        val due = firstDue
        if (p != null && r != null && t != null && due != null) {
            LoansApi.Terms(p, r, t, due.toString(), interestType = if (flat) "FLAT" else "REDUCING_BALANCE")
        } else {
            null
        }
    }
    // The schedule follows the terms, a moment after the typing stops.
    LaunchedEffect(terms?.principal, terms?.annualRatePercent, terms?.tenureMonths, terms?.firstDueDate, terms?.interestType) {
        val asked = terms ?: run { preview = null; return@LaunchedEffect }
        delay(PREVIEW_AFTER_MS)
        preview = attempt { app.loans.preview(asked) }
    }

    val day = debitDay.toIntOrNull()
    val datesFit = start != null && firstDue != null && !firstDue!!.isBefore(start)
    val emi = lenderEmi.toDoubleOrNull()?.takeIf { it > 0 }
    // A rupee or two apart is rounding; a wider gap, as on the web, usually means a misread or a typo.
    val emiGap = emi?.let { lenders -> preview?.takeIf { terms != null }?.let { kotlin.math.abs(lenders - it.emiAmount) } }?.takeIf { it > EMI_ROUNDING }
    val chosen = vehicles.firstOrNull { it.id == vehicleId }
    val otherPlate = letter.read?.plate?.takeIf { plate -> chosen != null && !chosen.registrationNumber.filter(Char::isLetterOrDigit).equals(plate, true) }
    val ready = vehicleId != null && lender.trim().length >= 2 && LOAN_NUMBER.matches(number.trim().uppercase()) &&
        terms != null && datesFit && (debitDay.isBlank() || day in 1..31) && !busy && !letter.reading

    DetailScreen(
        eyebrow = chosen?.let { formatPlate(it.registrationNumber) } ?: stringResource(R.string.costs_loans),
        title = stringResource(R.string.costs_add_loan),
        footer = {
            problem?.let { NoticeCard(it, NoticeTone.DANGER) }
            SaarthiButton(
                stringResource(R.string.costs_add_loan_save),
                onClick = {
                    busy = true
                    problem = null
                    scope.launch {
                        try {
                            val saved = app.loans.create(
                                LoansApi.NewLoan(
                                    vehicleId = vehicleId!!,
                                    loanNumber = number,
                                    lenderName = lender,
                                    terms = terms!!,
                                    startDate = start!!.toString(),
                                    emiAmount = emi,
                                    autoDebitDay = day,
                                ),
                            )
                            navigator.pop()
                            saved?.let { onAdded(it.id) }
                        } catch (failure: Exception) {
                            if (failure is CancellationException) throw failure
                            problem = failure.readable()
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = ready,
                busy = busy,
                busyText = stringResource(R.string.costs_saving),
            )
        },
    ) {
        SlipStep(letter, SlipKind.LOAN_LETTER, good = { it.foundAnything }, goodText = R.string.costs_add_loan_read_good, noneText = R.string.costs_add_loan_read_none)
        otherPlate?.let { NoticeCard(stringResource(R.string.costs_letter_other_plate, formatPlate(it), formatPlate(chosen!!.registrationNumber)), NoticeTone.WARNING) }

        if (vehicle == null) {
            GroupLabel(stringResource(R.string.costs_vehicle))
            VehiclePicker(vehicles, vehicleId) { vehicleId = it.id }
        }
        CompactField(lender, { lender = it.take(160) }, stringResource(R.string.costs_lender), placeholder = stringResource(R.string.costs_add_loan_lender_placeholder))
        CompactField(number, { number = it.uppercase().take(64) }, stringResource(R.string.costs_add_loan_number))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CompactField(principal, { principal = decimalOf(it, 12) }, stringResource(R.string.costs_add_loan_principal), Modifier.weight(1.3f), keyboardOptions = Decimal)
            CompactField(rate, { rate = decimalOf(it, 5) }, stringResource(R.string.costs_add_loan_rate), Modifier.weight(1f), keyboardOptions = Decimal)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CompactField(tenure, { tenure = it.filter(Char::isDigit).take(3) }, stringResource(R.string.costs_add_loan_months), Modifier.weight(1f), keyboardOptions = Whole)
            CompactField(debitDay, { debitDay = it.filter(Char::isDigit).take(2) }, stringResource(R.string.costs_add_loan_debit_day), Modifier.weight(1.3f), keyboardOptions = Whole)
        }
        SegmentedControl(options = listOf(stringResource(R.string.costs_add_loan_reducing), stringResource(R.string.costs_add_loan_flat)), selected = if (flat) 1 else 0, onSelect = { flat = it == 1 }, height = 44.dp)
        DayField(stringResource(R.string.costs_add_loan_started), start, onPick = { start = it })
        DayField(stringResource(R.string.costs_add_loan_first_emi), firstDue, onPick = { firstDue = it }, earliest = start)
        if (!datesFit) Text(stringResource(R.string.costs_add_loan_dates_misfit), style = SType.small, color = c.danger)

        preview?.takeIf { terms != null }?.let { schedule -> SchedulePreview(schedule) }
        CompactField(
            lenderEmi,
            { lenderEmi = decimalOf(it, 10) },
            stringResource(R.string.costs_add_loan_lender_emi),
            placeholder = preview?.takeIf { terms != null }?.let { kotlin.math.ceil(it.emiAmount).toLong().toString() },
            keyboardOptions = Decimal,
        )
        emiGap?.let { Text(stringResource(R.string.costs_add_loan_emi_differs, rupees(it)), style = SType.small, color = c.warning) }
    }
}

@Composable
private fun SchedulePreview(schedule: LoansApi.Preview) {
    val c = Saarthi.colors
    Column(Modifier.fillMaxWidth().card(radius = 20.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Eyebrow(stringResource(R.string.costs_add_loan_schedule_title))
        Text(stringResource(R.string.costs_emi_amount, rupees(schedule.emiAmount)), style = SType.headerTitle, color = c.fg)
        Text(
            pluralStringResource(R.plurals.costs_add_loan_schedule_totals, schedule.totals.installments, schedule.totals.installments, rupees(schedule.totals.interest), rupees(schedule.totals.total)),
            style = SType.small,
            color = c.muted,
        )
        schedule.installments.take(PREVIEW_ROWS).forEach { row ->
            Row(Modifier.fillMaxWidth().padding(top = 2.dp)) {
                Text(stringResource(R.string.costs_emi_number_on, row.number, prettyDate(row.dueDate) ?: row.dueDate), style = SType.small, color = c.muted, modifier = Modifier.weight(1f))
                Text(rupees(row.totalDue), style = SType.smallStrong, color = c.fg)
            }
        }
    }
}

/** `loanNumber` as the server takes it: letters, digits, dashes, slashes and spaces, 3 to 64. */
private val LOAN_NUMBER = Regex("^[A-Z0-9][A-Z0-9\\-/ ]{2,63}$")
private const val EMI_ROUNDING = 5.0
private const val PREVIEW_AFTER_MS = 600L
private const val PREVIEW_ROWS = 3
