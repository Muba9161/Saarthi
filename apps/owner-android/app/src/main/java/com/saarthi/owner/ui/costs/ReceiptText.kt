package com.saarthi.owner.ui.costs

import com.saarthi.owner.ui.papers.PaperText
import java.time.LocalDate

/**
 * What a payment receipt says — a bank's SMS or app screen, a UPI
 * confirmation, a FASTag recharge or balance screen — as far as a form that
 * notes a payment needs it.
 */
internal data class ReadReceipt(
    /** What was paid, debited or recharged. */
    val amount: Double? = null,
    /** The balance left after it, or the balance shown. */
    val balance: Double? = null,
    val date: LocalDate? = null,
    /** The bank's reference for it: a UTR, RRN, transaction or cheque number. */
    val reference: String? = null,
    /** How it was paid, as a `LoansApi.METHODS` code. */
    val method: String? = null,
) {
    val foundAnything: Boolean get() = amount != null || balance != null || reference != null
}

/** Receipts and bank messages read on the phone, the way [SlipText] reads slips. */
internal object ReceiptText {

    fun read(text: String, today: LocalDate = LocalDate.now()): ReadReceipt {
        // "RS.60", "INR1,250" — the amount pressed against its currency is still an amount.
        val upper = CURRENCY.replace(text.uppercase(), "$1 ")
        val lines = upper.lines().map { it.trim() }.filter { it.isNotEmpty() }
        return ReadReceipt(
            amount = amountAfter(lines, AMOUNT_LABELS, skip = BALANCE_WORDS),
            balance = amountAfter(lines, BALANCE_LABELS, skip = emptyList()),
            date = PaperText.datesIn(upper).firstOrNull { !it.isAfter(today) },
            reference = referenceIn(lines),
            method = METHODS.firstOrNull { (words, _) -> words.any { it.containsMatchIn(upper) } }?.second,
        )
    }

    private val CURRENCY = Regex("(RS\\.?|INR|₹)\\s*:?(?=[0-9])")
    private val MONEY = 1.0..10_000_000.0

    /** Days and times, whose parts are not amounts. */
    private val NOT_AMOUNTS = Regex("[0-9]{1,4}[/.\\-][0-9A-Z]{1,9}[/.\\-][0-9]{2,4}|[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?|[X*]+[0-9]{2,6}")

    /** Strongest first: what a receipt names the payment by, before the bare currency. */
    private val AMOUNT_LABELS = listOf(
        "AMOUNT PAID", "PAID AMOUNT", "RECHARGE AMOUNT", "RECHARGED WITH", "RECHARGE OF", "TOP UP AMOUNT", "TOPUP AMOUNT",
        "TRANSACTION AMOUNT", "TXN AMOUNT", "EMI AMOUNT", "DEBITED FOR", "DEBITED BY", "DEBITED WITH", "CREDITED FOR",
        "CREDITED WITH", "CREDITED BY", "PAID", "AMOUNT", "AMT", "RS", "INR", "₹",
    )
    private val BALANCE_WORDS = listOf("BAL")

    private val BALANCE_LABELS = listOf(
        "AVAILABLE BALANCE", "AVL BAL", "AVAIL BAL", "AVBL BAL", "CLOSING BALANCE", "UPDATED BALANCE", "TAG BALANCE",
        "WALLET BALANCE", "CURRENT BALANCE", "BALANCE", "BAL",
    )

    /**
     * The first sensible amount after the strongest label: on the label's own
     * line, else alone on the next. An amount label on a line about the balance
     * reads past the balance's figure, since a bank message often puts both on
     * one line.
     */
    private fun amountAfter(lines: List<String>, labels: List<String>, skip: List<String>): Double? {
        for (label in labels) {
            val words = Regex("(?<![A-Z])${Regex.escape(label)}(?![A-Z])")
            lines.forEachIndexed { index, line ->
                val found = words.find(line) ?: return@forEachIndexed
                var rest = line.substring(found.range.last + 1)
                // Cut off what is said about the balance, so its figure is not taken for the payment.
                skip.firstNotNullOfOrNull { word -> rest.indexOf(word).takeIf { it >= 0 } }?.let { rest = rest.substring(0, it) }
                val shown = NOT_AMOUNTS.replace(if (rest.none(Char::isLetterOrDigit)) lines.getOrNull(index + 1).orEmpty() else rest, " ")
                SlipText.numbersOn(shown).firstOrNull { it in MONEY }?.let { return it }
            }
        }
        return null
    }

    private val REFERENCE_LABELS = listOf(
        "UTR NO", "UTR NUMBER", "UTR", "RRN", "UPI REF NO", "UPI REF", "UPI TRANSACTION ID", "TRANSACTION ID", "TRANSACTION NO",
        "TXN ID", "TXN NO", "REFERENCE NUMBER", "REFERENCE NO", "REF NO", "REF", "ORDER ID", "CHEQUE NO", "CHQ NO",
    )
    private val TOKEN = Regex("^[\\s:.#\\-]*([A-Z0-9][A-Z0-9\\-]{5,40})")

    /** The bank's reference: the first code after its label with enough digits to be one. */
    private fun referenceIn(lines: List<String>): String? {
        for (label in REFERENCE_LABELS) {
            val words = Regex("(?<![A-Z])${Regex.escape(label)}(?![A-Z])")
            lines.forEachIndexed { index, line ->
                val found = words.find(line) ?: return@forEachIndexed
                val rest = line.substring(found.range.last + 1).let { if (it.none(Char::isLetterOrDigit)) lines.getOrNull(index + 1).orEmpty() else it }
                val token = TOKEN.find(rest)?.groupValues?.get(1) ?: return@forEachIndexed
                if (token.count(Char::isDigit) >= 4) return token
            }
        }
        return null
    }

    /** How it was paid; a mandate's debit before the rails it ran on. */
    private val METHODS = listOf(
        listOf("NACH", "ECS", "E-MANDATE", "EMANDATE", "MANDATE") to "NACH",
        listOf("AUTO DEBIT", "AUTO-DEBIT", "AUTODEBIT", "STANDING INSTRUCTION") to "AUTO_DEBIT",
        listOf("UPI") to "UPI",
        listOf("NEFT", "RTGS", "IMPS", "NET BANKING", "NETBANKING", "MOB BK", "MOBILE BANKING", "FUND TRANSFER") to "BANK_TRANSFER",
        listOf("CHEQUE", "CHQ") to "CHEQUE",
        listOf("DEBIT CARD", "CREDIT CARD", "CARD NO", "POS") to "CARD",
        listOf("CASH") to "CASH",
    ).map { (words, code) -> words.map { Regex("(?<![A-Z])${Regex.escape(it)}(?![A-Z])") } to code }
}
