package com.saarthi.owner.network

import com.saarthi.owner.R
import com.saarthi.owner.ui.common.Words
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The vehicles' loans and their EMIs, as the web's Loans & EMI tab keeps them:
 * what is owed, what falls due next, the repayment schedule, and the payments
 * made against it. Amounts are rupees; due dates are days (`YYYY-MM-DD`).
 *
 * Recording a payment notes one made at the bank — it moves no money.
 */
class LoansApi(private val api: OwnerApi) {

    @Serializable
    data class Attention(
        val loanId: String,
        val registrationNumber: String = "",
        val lenderName: String = "",
        val dueDate: String = "",
        val amount: Double = 0.0,
        val status: String = "",
    )

    @Serializable
    data class Summary(
        val activeLoans: Int = 0,
        val financedVehicles: Int = 0,
        val totalOutstanding: Double = 0.0,
        val monthlyObligation: Double = 0.0,
        val dueThisMonth: Double = 0.0,
        val overdueInstallments: Int = 0,
        val overdueAmount: Double = 0.0,
        val nextDueDate: String? = null,
        val attention: List<Attention> = emptyList(),
    )

    @Serializable
    data class Upcoming(
        val installmentId: String,
        val loanId: String,
        val registrationNumber: String = "",
        val lenderName: String = "",
        val number: Int = 0,
        val dueDate: String = "",
        val outstanding: Double = 0.0,
        val status: String = "",
        val daysUntilDue: Int = 0,
    )

    @Serializable
    data class UpcomingList(val items: List<Upcoming> = emptyList(), val totalDue: Double = 0.0, val overdueAmount: Double = 0.0)

    @Serializable
    data class Installment(
        val id: String,
        val number: Int = 0,
        val dueDate: String = "",
        val principal: Double = 0.0,
        val interest: Double = 0.0,
        val totalDue: Double = 0.0,
        val closingBalance: Double? = null,
        val status: String = "",
        val amountPaid: Double = 0.0,
        val outstanding: Double = 0.0,
        val paidAt: String? = null,
    ) {
        val payable: Boolean get() = status !in setOf("PAID", "WAIVED") && outstanding > 0
    }

    @Serializable
    data class Payment(
        val id: String,
        val installmentNumber: Int? = null,
        val amount: Double = 0.0,
        val penalty: Double = 0.0,
        val kind: String = "",
        val method: String = "",
        val paidAt: String = "",
        val reference: String? = null,
        val reversedAt: String? = null,
    )

    /**
     * A loan. The list sends the summary; one loan's read adds its
     * [installments] and [payments], which are empty otherwise.
     */
    @Serializable
    data class Loan(
        val id: String,
        val vehicleId: String = "",
        val registrationNumber: String = "",
        /** Masked by the server unless this person may see it whole. */
        val loanNumber: String? = null,
        val lenderName: String = "",
        val lenderBranch: String? = null,
        val loanType: String = "",
        val status: String = "",
        val principal: Double = 0.0,
        val annualRatePercent: Double = 0.0,
        val interestType: String = "",
        val tenureMonths: Int = 0,
        val frequency: String = "",
        val startDate: String = "",
        val endDate: String? = null,
        val emiAmount: Double = 0.0,
        val autoDebitDay: Int? = null,
        val totalOutstanding: Double = 0.0,
        val paidInstallments: Int = 0,
        val remainingInstallments: Int = 0,
        val overdueInstallments: Int = 0,
        val overdueAmount: Double = 0.0,
        val nextDueDate: String? = null,
        val nextDueAmount: Double? = null,
        val completionPercent: Double = 0.0,
        val remindersEnabled: Boolean = true,
        val installments: List<Installment> = emptyList(),
        val payments: List<Payment> = emptyList(),
    ) {
        val active: Boolean get() = status == "ACTIVE"
    }

    @Serializable
    data class PreviewInstallment(val number: Int = 0, val dueDate: String = "", val principal: Double = 0.0, val interest: Double = 0.0, val totalDue: Double = 0.0)

    @Serializable
    data class PreviewTotals(val installments: Int = 0, val principal: Double = 0.0, val interest: Double = 0.0, val total: Double = 0.0)

    /** The schedule a loan's terms would make, before it is saved. */
    @Serializable
    data class Preview(val emiAmount: Double = 0.0, val installments: List<PreviewInstallment> = emptyList(), val totals: PreviewTotals = PreviewTotals())

    class Terms(
        val principal: Double,
        val annualRatePercent: Double,
        val tenureMonths: Int,
        /** The first EMI's day, `YYYY-MM-DD`. */
        val firstDueDate: String,
        val interestType: String = "REDUCING_BALANCE",
        val frequency: String = "MONTHLY",
    )

    class NewLoan(
        val vehicleId: String,
        val loanNumber: String,
        val lenderName: String,
        val terms: Terms,
        /** The day the loan started, `YYYY-MM-DD`. */
        val startDate: String,
        val emiAmount: Double?,
        val autoDebitDay: Int?,
    )

    suspend fun summary(): Summary = api.get("/fleet/loans/summary", Summary.serializer()) ?: Summary()

    suspend fun upcoming(days: Int = 30, vehicleId: String? = null): UpcomingList =
        api.get("/fleet/loans/upcoming?days=$days${vehicleId?.let { "&vehicleId=$it" }.orEmpty()}", UpcomingList.serializer()) ?: UpcomingList()

    suspend fun loans(page: Int = 1): Page<Loan> =
        api.get("/fleet/loans?page=$page&pageSize=$PAGE_SIZE", Page.serializer(Loan.serializer())) ?: Page()

    suspend fun forVehicle(vehicleId: String): List<Loan> =
        api.get("/fleet/vehicles/$vehicleId/loans", ListSerializer(Loan.serializer())).orEmpty()

    suspend fun get(id: String): Loan? = api.get("/fleet/loans/$id", Loan.serializer())

    suspend fun preview(terms: Terms): Preview? {
        val body = buildJsonObject {
            put("principal", terms.principal)
            put("annualRatePercent", terms.annualRatePercent)
            put("interestType", terms.interestType)
            put("tenureMonths", terms.tenureMonths)
            put("frequency", terms.frequency)
            put("firstDueDate", terms.firstDueDate)
        }
        return api.post("/fleet/loans/preview-schedule", body.toString(), Preview.serializer())
    }

    suspend fun create(input: NewLoan): Loan? {
        val body = buildJsonObject {
            put("vehicleId", input.vehicleId)
            put("loanNumber", input.loanNumber.trim().uppercase())
            put("lenderName", input.lenderName.trim())
            put("principal", input.terms.principal)
            put("annualRatePercent", input.terms.annualRatePercent)
            put("interestType", input.terms.interestType)
            put("tenureMonths", input.terms.tenureMonths)
            put("frequency", input.terms.frequency)
            put("startDate", input.startDate)
            put("firstDueDate", input.terms.firstDueDate)
            input.emiAmount?.let { put("emiAmount", it) }
            input.autoDebitDay?.let { put("autoDebitDay", it) }
        }
        return api.post("/fleet/loans", body.toString(), Loan.serializer())
    }

    /** Note a payment made at the bank against an installment (or as a part prepayment). */
    suspend fun recordPayment(
        loanId: String,
        amount: Double,
        installmentId: String?,
        paidOn: String,
        method: String,
        reference: String?,
        penalty: Double?,
    ): Loan? {
        val body = buildJsonObject {
            put("amount", amount)
            put("kind", if (installmentId != null) "INSTALLMENT" else "PART_PREPAYMENT")
            installmentId?.let { put("installmentId", it) }
            put("paidAt", paidOn)
            put("method", method)
            reference?.ifBlank { null }?.let { put("reference", it.take(120)) }
            penalty?.takeIf { it > 0 }?.let { put("penalty", it) }
        }
        return api.post("/fleet/loans/$loanId/payments", body.toString(), Loan.serializer())
    }

    suspend fun setReminders(loanId: String, on: Boolean): Loan? =
        api.patch("/fleet/loans/$loanId", buildJsonObject { put("remindersEnabled", on) }.toString(), Loan.serializer())

    companion object {
        const val PAGE_SIZE = 25

        const val CAN_READ = "loans.read"
        const val CAN_MANAGE = "loans.manage"
        const val FEATURE = "finance.loans"

        /** How a payment was made, in the web's words. */
        val METHODS: List<Pair<String, String>>
            get() = listOf(
                "AUTO_DEBIT" to Words.get(R.string.net_loan_method_auto_debit),
                "NACH" to "NACH",
                "UPI" to "UPI",
                "BANK_TRANSFER" to Words.get(R.string.net_loan_method_bank_transfer),
                "CHEQUE" to Words.get(R.string.net_loan_method_cheque),
                "CASH" to Words.get(R.string.net_loan_method_cash),
                "CARD" to Words.get(R.string.net_loan_method_card),
                "OTHER" to Words.get(R.string.net_loan_method_other),
            )
    }
}
