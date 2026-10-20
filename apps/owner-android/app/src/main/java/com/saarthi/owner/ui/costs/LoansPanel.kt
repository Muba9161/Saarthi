package com.saarthi.owner.ui.costs

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.LoansApi
import com.saarthi.owner.network.VehiclesApi
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
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

private class LoansView(val summary: LoansApi.Summary?, val upcoming: LoansApi.UpcomingList, val loans: List<LoansApi.Loan>)

/**
 * Loans & EMI: what the fleet owes each month and in all, what falls due in
 * the next thirty days, and each loan — for the fleet, or one vehicle's.
 */
@Composable
internal fun LoansPanel(app: OwnerApp, access: CostAccess, vehicle: VehiclesApi.Vehicle?, changed: Int, onChanged: () -> Unit) {
    val navigator = LocalNavigator.current
    var attempt by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Loadable<LoansView>>(Loadable.Loading) }
    LaunchedEffect(vehicle?.id, changed, attempt) {
        state = try {
            coroutineScope {
                val summary = async { if (vehicle == null) app.loans.summary() else null }
                val upcoming = async { app.loans.upcoming(vehicleId = vehicle?.id) }
                val loans = async { if (vehicle == null) app.loans.loans().items else app.loans.forVehicle(vehicle.id) }
                Loadable.Ready(LoansView(summary.await(), upcoming.await(), loans.await()))
            }
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            Loadable.Failed(failure.readable())
        }
    }
    val openLoan: (String) -> Unit = { id -> navigator.push("loan-$id") { LoanScreen(app, access, id, onChanged) } }

    if (access.manageLoans) {
        SaarthiButton(
            stringResource(R.string.costs_add_loan),
            onClick = { navigator.push("add-loan-${vehicle?.id}") { AddLoanScreen(app, vehicle, onAdded = { onChanged(); openLoan(it) }) } },
            tone = ButtonTone.SECONDARY,
            leading = Lucide.plus,
            height = 48.dp,
        )
    }
    when (val shown = state) {
        Loadable.Loading -> SkeletonCards(count = 2)
        is Loadable.Failed -> FailedCard(shown.message, { attempt++ })
        is Loadable.Ready -> {
            val view = shown.value
            view.summary?.let { summary ->
                FigureRow {
                    FigureTile(stringResource(R.string.costs_loans_monthly), rupees(summary.monthlyObligation), "", Modifier.weight(1f))
                    FigureTile(stringResource(R.string.costs_loans_due_month), rupees(summary.dueThisMonth), "", Modifier.weight(1f))
                }
                FigureRow {
                    FigureTile(stringResource(R.string.costs_overdue), rupees(summary.overdueAmount), "", Modifier.weight(1f))
                    FigureTile(stringResource(R.string.costs_outstanding), rupees(summary.totalOutstanding), "", Modifier.weight(1f))
                }
            }
            if (view.upcoming.items.isNotEmpty()) {
                GroupLabel(stringResource(R.string.costs_loans_next_30_days))
                view.upcoming.items.forEach { due ->
                    CostRow(
                        title = due.lenderName.ifBlank { stringResource(R.string.costs_emi_number, due.number) },
                        detail = listOfNotNull(
                            formatPlate(due.registrationNumber).takeIf { vehicle == null && due.registrationNumber.isNotBlank() },
                            stringResource(R.string.costs_emi_number, due.number),
                            prettyDate(due.dueDate)?.let { stringResource(if (due.daysUntilDue < 0) R.string.costs_was_due else R.string.costs_due, it) },
                        ).joinToString(" · "),
                        trailing = rupees(due.outstanding),
                        badge = installmentWord(due.status)?.let { it to (due.status == "OVERDUE" || due.status == "DUE_TODAY") },
                        onClick = { openLoan(due.loanId) },
                    )
                }
            }
            GroupLabel(stringResource(if (vehicle == null) R.string.costs_loans else R.string.costs_loans_vehicle))
            if (view.loans.isEmpty()) Hint(stringResource(R.string.costs_loans_none))
            view.loans.forEach { loan ->
                CostRow(
                    title = loan.lenderName,
                    detail = listOfNotNull(
                        formatPlate(loan.registrationNumber).takeIf { vehicle == null && loan.registrationNumber.isNotBlank() },
                        loan.loanNumber?.ifBlank { null },
                        stringResource(R.string.costs_emi_amount, rupees(loan.emiAmount)),
                        prettyDate(loan.nextDueDate)?.let { stringResource(R.string.costs_loans_next, it) },
                    ).joinToString(" · "),
                    trailing = rupees(loan.totalOutstanding),
                    badge = when {
                        loan.overdueInstallments > 0 -> stringResource(R.string.costs_loans_overdue_count, loan.overdueInstallments) to true
                        !loan.active -> loanStatusWord(loan.status) to false
                        else -> null
                    },
                    onClick = { openLoan(loan.id) },
                )
            }
        }
    }
}

/** An installment's standing in words; none for one simply coming up. */
internal fun installmentWord(status: String): String? = when (status) {
    "DUE_SOON" -> Words.get(R.string.costs_installment_due_soon)
    "DUE_TODAY" -> Words.get(R.string.costs_installment_due_today)
    "OVERDUE" -> Words.get(R.string.costs_overdue)
    "PARTIALLY_PAID" -> Words.get(R.string.costs_installment_part_paid)
    "PAID" -> Words.get(R.string.costs_installment_paid)
    "WAIVED" -> Words.get(R.string.costs_installment_waived)
    "UNKNOWN" -> Words.get(R.string.costs_installment_unknown)
    else -> null
}

internal fun loanStatusWord(status: String): String = when (status) {
    "ACTIVE" -> Words.get(R.string.costs_loan_status_active)
    "CLOSED" -> Words.get(R.string.costs_loan_status_closed)
    "FORECLOSED" -> Words.get(R.string.costs_loan_status_foreclosed)
    "DEFAULTED" -> Words.get(R.string.costs_loan_status_defaulted)
    "ON_HOLD" -> Words.get(R.string.costs_loan_status_on_hold)
    "CANCELLED" -> Words.get(R.string.costs_loan_status_cancelled)
    "DRAFT" -> Words.get(R.string.costs_loan_status_draft)
    else -> status.lowercase().replaceFirstChar { it.uppercase() }
}
