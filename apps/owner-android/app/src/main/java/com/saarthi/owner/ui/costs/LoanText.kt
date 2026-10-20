package com.saarthi.owner.ui.costs

import com.saarthi.owner.ui.papers.PaperText
import java.time.LocalDate

/**
 * What a loan's sanction letter, agreement or EMI schedule says, as far as the
 * add-loan form needs it. Each field is null when it could not be read with
 * reasonable confidence — a blank to fill beats a confident wrong figure.
 */
internal data class ReadLoan(
    val lender: String? = null,
    val loanNumber: String? = null,
    val principal: Double? = null,
    val ratePercent: Double? = null,
    /** True for a flat rate, false for reducing balance, null when the letter does not say. */
    val flat: Boolean? = null,
    val tenureMonths: Int? = null,
    val emi: Double? = null,
    val startDate: LocalDate? = null,
    val firstDue: LocalDate? = null,
    val debitDay: Int? = null,
    val plate: String? = null,
) {
    val foundAnything: Boolean
        get() = lender != null || loanNumber != null || principal != null || ratePercent != null || tenureMonths != null || emi != null
}

/**
 * Loan papers read on the phone, the way [SlipText] reads slips: each figure
 * is taken from beside the words lenders print it under — the most particular
 * words first — and only when it is a sensible size for what it is meant to be.
 */
internal object LoanText {

    fun read(text: String): ReadLoan {
        val upper = text.uppercase()
        val lines = upper.lines().map { it.trim() }.filter { it.isNotEmpty() }
        val firstDue = dateAfter(lines, FIRST_DUE_LABELS)
        return ReadLoan(
            lender = lenderIn(lines),
            loanNumber = loanNumberIn(lines),
            principal = amountAfter(lines, PRINCIPAL_LABELS, skip = NOT_PRINCIPAL, range = PRINCIPAL),
            ratePercent = rateIn(lines),
            flat = when {
                FLAT.containsMatchIn(upper) -> true
                REDUCING.any { it in upper } -> false
                else -> null
            },
            tenureMonths = tenureIn(lines),
            emi = amountAfter(lines, EMI_LABELS, skip = NOT_EMI, range = EMI),
            startDate = dateAfter(lines, START_LABELS, skip = NOT_START),
            firstDue = firstDue,
            debitDay = EVERY_MONTH.find(upper)?.groupValues?.get(1)?.toIntOrNull()?.takeIf { it in 1..31 } ?: firstDue?.dayOfMonth,
            plate = PaperText.platesIn(text).firstOrNull(),
        )
    }

    // -- Finding a label ---------------------------------------------------------------

    /**
     * Each line carrying [label] as words of its own (so "EMI" is not found in
     * "PREMIUM"), with what follows the label on that line and the line after —
     * the value's place when a letter prints its terms as a table.
     */
    private fun labelled(lines: List<String>, label: String, skip: List<String>): Sequence<Pair<String, String>> {
        val words = Regex("(?<![A-Z])${Regex.escape(label)}(?![A-Z])")
        return lines.asSequence().mapIndexedNotNull { index, line ->
            val found = words.find(line) ?: return@mapIndexedNotNull null
            if (skip.any { it in line && it !in label }) return@mapIndexedNotNull null
            line.substring(found.range.last + 1) to lines.getOrNull(index + 1).orEmpty()
        }
    }

    /** Only punctuation after a label: its value sits on the next line. */
    private fun String.bare(): Boolean = none { it.isLetterOrDigit() }

    // -- Figures -------------------------------------------------------------------------

    private val PRINCIPAL = 10_000.0..100_000_000.0
    private val EMI = 100.0..10_000_000.0
    private val MONTHS = 1..360
    private const val RATE_CEILING = 60.0

    private val PRINCIPAL_LABELS = listOf(
        "SANCTIONED AMOUNT", "SANCTION AMOUNT", "AMOUNT SANCTIONED", "LOAN SANCTIONED", "AMOUNT FINANCED", "FINANCED AMOUNT",
        "FINANCE AMOUNT", "LOAN AMOUNT", "AMOUNT OF LOAN", "PRINCIPAL AMOUNT", "PRINCIPAL",
    )
    private val NOT_PRINCIPAL = listOf("PROCESSING", "OUTSTANDING", "INSURANCE", "EMI", "INSTAL", "INTEREST")

    private val EMI_LABELS = listOf(
        "EMI AMOUNT", "MONTHLY EMI", "INSTALMENT AMOUNT", "INSTALLMENT AMOUNT", "MONTHLY INSTALMENT", "MONTHLY INSTALLMENT", "EMI",
    )
    private val NOT_EMI = listOf("NO. OF", "NO OF", "NUMBER OF", "TOTAL", "DATE", "START", "COMMENCE", "FREQUENCY", "MODE", "PRINCIPAL", "FIRST")

    /** A printed day — 05/12/2026, 05-DEC-2026 — whose parts are not amounts. */
    private val DAY = Regex("[0-9]{1,4}[/.\\-][0-9A-Z]{1,9}[/.\\-][0-9]{2,4}")

    /** The first sensible amount after the strongest of [labels] the letter carries. */
    private fun amountAfter(lines: List<String>, labels: List<String>, skip: List<String>, range: ClosedFloatingPointRange<Double>): Double? {
        for (label in labels) {
            for ((rest, next) in labelled(lines, label, skip)) {
                val shown = DAY.replace(if (rest.bare()) next else rest, " ")
                SlipText.numbersOn(shown).firstOrNull { it in range }?.let { return it }
            }
        }
        return null
    }

    private val RATE_LABELS = listOf("RATE OF INTEREST", "INTEREST RATE", "ROI", "INTEREST @", "INTEREST")
    private val NOT_RATE = listOf("PENAL", "OVERDUE", "DELAY", "LATE", "ADDITIONAL", "DEFAULT", "PER MONTH", "BOUNCE", "FORECLOSURE", "PREPAYMENT")
    private val PERCENT = Regex("(?<![0-9.])([0-9]{1,2}(?:\\.[0-9]{1,3})?)\\s*%")
    private val PER_ANNUM = Regex("(?<![0-9.])([0-9]{1,2}(?:\\.[0-9]{1,3})?)\\s*%\\s*(?:P\\.?\\s?A\\.?|PER ANNUM|PER YEAR|ANNUAL)")

    /** The yearly rate: printed beside its label, or failing that as "x% p.a." on a line about no penalty. */
    private fun rateIn(lines: List<String>): Double? {
        fun sensible(found: MatchResult?) = found?.groupValues?.get(1)?.toDoubleOrNull()?.takeIf { it > 0 && it <= RATE_CEILING }
        for (label in RATE_LABELS) {
            for ((rest, next) in labelled(lines, label, NOT_RATE)) {
                sensible(PERCENT.find(if (rest.bare()) next else rest))?.let { return it }
            }
        }
        return lines.filterNot { line -> NOT_RATE.any { it in line } }.firstNotNullOfOrNull { sensible(PER_ANNUM.find(it)) }
    }

    private val FLAT = Regex("FLAT\\s*(?:RATE|INTEREST|ROI|BASIS)|%\\s*(?:P\\.?\\s?A\\.?\\s*)?\\(?\\s*FLAT|INTEREST TYPE\\W*FLAT")
    private val REDUCING = listOf("REDUCING", "DIMINISHING", "MONTHLY REST")

    private val TENURE_LABELS = listOf(
        "NO. OF INSTALMENTS", "NO. OF INSTALLMENTS", "NO OF INSTALMENTS", "NO OF INSTALLMENTS", "NUMBER OF INSTALMENTS",
        "NUMBER OF INSTALLMENTS", "NO. OF EMIS", "NO OF EMIS", "NO. OF EMI", "NO OF EMI", "TOTAL EMIS", "TENURE", "TENOR",
        "LOAN TERM", "REPAYMENT PERIOD",
    )
    private val TERM = Regex("(?<![0-9.,/])([0-9]{1,3})(?![0-9.,/])\\s*(MONTHS?|MTHS?|YEARS?|YRS?)?")

    /** The tenure in months; one printed in years is turned into months. */
    private fun tenureIn(lines: List<String>): Int? {
        for (label in TENURE_LABELS) {
            for ((rest, next) in labelled(lines, label, emptyList())) {
                val match = TERM.find(if (rest.bare()) next else rest) ?: continue
                val count = match.groupValues[1].toIntOrNull() ?: continue
                val months = if (match.groupValues[2].startsWith("Y")) count * 12 else count
                if (months in MONTHS) return months
            }
        }
        return null
    }

    // -- Days ------------------------------------------------------------------------------

    private val FIRST_DUE_LABELS = listOf(
        "FIRST EMI DATE", "DATE OF FIRST EMI", "FIRST EMI DUE", "FIRST INSTALMENT DATE", "FIRST INSTALLMENT DATE",
        "DATE OF FIRST INSTALMENT", "DATE OF FIRST INSTALLMENT", "EMI START DATE", "EMI COMMENCEMENT", "REPAYMENT START",
        "FIRST INSTALMENT", "FIRST INSTALLMENT", "FIRST EMI", "EMI START",
    )
    private val START_LABELS = listOf(
        "DATE OF DISBURSEMENT", "DISBURSEMENT DATE", "DISBURSED ON", "LOAN START DATE", "DATE OF AGREEMENT", "AGREEMENT DATE",
        "DATE OF SANCTION", "SANCTION DATE", "LOAN DATE", "START DATE",
    )
    private val NOT_START = listOf("EMI", "INSTAL", "REPAYMENT")

    /** The first date after the strongest of [labels] the letter carries. */
    private fun dateAfter(lines: List<String>, labels: List<String>, skip: List<String> = emptyList()): LocalDate? {
        for (label in labels) {
            for ((rest, next) in labelled(lines, label, skip)) {
                PaperText.datesIn(if (rest.bare()) next else rest).firstOrNull()?.let { return it }
            }
        }
        return null
    }

    /** "On the 5th of every month". */
    private val EVERY_MONTH = Regex("(?<![0-9])([0-9]{1,2})\\s*(?:ST|ND|RD|TH)?\\s*(?:DAY\\s*)?OF\\s*(?:EVERY|EACH)\\s*(?:CALENDAR\\s*)?MONTH")

    // -- Which loan, and whose -----------------------------------------------------------------

    private val LOAN_NUMBER_LABELS = listOf(
        "LOAN ACCOUNT NUMBER", "LOAN ACCOUNT NO", "LOAN A/C NUMBER", "LOAN A/C NO", "LOAN A/C", "LOAN NUMBER", "LOAN NO",
        "AGREEMENT NUMBER", "AGREEMENT NO", "CONTRACT NUMBER", "CONTRACT NO", "LAN",
    )
    private val TOKEN = Regex("^[\\s:.#\\-]*([A-Z0-9][A-Z0-9/\\-]{2,40})")

    /** The lender's number for the loan: the first code after its label with a few digits in it. */
    private fun loanNumberIn(lines: List<String>): String? {
        for (label in LOAN_NUMBER_LABELS) {
            for ((rest, next) in labelled(lines, label, emptyList())) {
                val token = TOKEN.find(if (rest.bare()) next else rest)?.groupValues?.get(1) ?: continue
                if (token.count(Char::isDigit) >= 3) return token
            }
        }
        return null
    }

    /** Lenders that finance vehicles, by the words their papers carry; the more particular name first. */
    private val LENDERS = listOf(
        "KOTAK MAHINDRA" to "Kotak Mahindra Bank",
        "MAHINDRA & MAHINDRA FINANCIAL" to "Mahindra Finance",
        "MAHINDRA FINANCE" to "Mahindra Finance",
        "SHRIRAM" to "Shriram Finance",
        "CHOLAMANDALAM" to "Cholamandalam Finance",
        "TATA MOTORS FINANCE" to "Tata Motors Finance",
        "TATA CAPITAL" to "Tata Capital",
        "HINDUJA LEYLAND" to "Hinduja Leyland Finance",
        "SUNDARAM FINANCE" to "Sundaram Finance",
        "BAJAJ FINANCE" to "Bajaj Finance",
        "BAJAJ FINSERV" to "Bajaj Finance",
        "L&T FINANCE" to "L&T Finance",
        "L & T FINANCE" to "L&T Finance",
        "POONAWALLA" to "Poonawalla Fincorp",
        "MAGMA" to "Magma Fincorp",
        "SK FINANCE" to "SK Finance",
        "KOGTA" to "Kogta Financial",
        "HERO FINCORP" to "Hero FinCorp",
        "TVS CREDIT" to "TVS Credit",
        "DAIMLER FINANCIAL" to "Daimler Financial Services",
        "VOLVO FINANCIAL" to "Volvo Financial Services",
        "MUTHOOT" to "Muthoot Capital",
        "AU SMALL FINANCE" to "AU Small Finance Bank",
        "EQUITAS" to "Equitas Small Finance Bank",
        "UJJIVAN" to "Ujjivan Small Finance Bank",
        "HDFC BANK" to "HDFC Bank",
        "ICICI BANK" to "ICICI Bank",
        "AXIS BANK" to "Axis Bank",
        "INDUSIND" to "IndusInd Bank",
        "IDFC FIRST" to "IDFC First Bank",
        "YES BANK" to "Yes Bank",
        "FEDERAL BANK" to "Federal Bank",
        "STATE BANK OF INDIA" to "State Bank of India",
        "PUNJAB NATIONAL BANK" to "Punjab National Bank",
        "BANK OF BARODA" to "Bank of Baroda",
        "CANARA BANK" to "Canara Bank",
        "UNION BANK OF INDIA" to "Union Bank of India",
        "CENTRAL BANK OF INDIA" to "Central Bank of India",
        "BANK OF INDIA" to "Bank of India",
        "INDIAN OVERSEAS BANK" to "Indian Overseas Bank",
        "INDIAN BANK" to "Indian Bank",
        "UCO BANK" to "UCO Bank",
        "IDBI BANK" to "IDBI Bank",
        "SBI" to "State Bank of India",
        "PNB" to "Punjab National Bank",
        "HDFC" to "HDFC Bank",
        "ICICI" to "ICICI Bank",
    ).map { (words, name) -> Regex("(?<![A-Z])${Regex.escape(words)}(?![A-Z])") to name }

    private val LENDER_WORDS = Regex("(?<![A-Z])(?:BANK|FINANCE|FINANCIAL|FINCORP|FINSERV|CAPITAL|CREDIT|LEASING)(?![A-Z])")
    private const val HEAD_LINES = 8

    /**
     * Who lent it: the topmost line near the head that names a lender — a
     * known one by its proper name, any other as printed — since a letter
     * from one lender often names another bank for the auto-debit further
     * down; failing that, a known lender anywhere on the paper.
     */
    private fun lenderIn(lines: List<String>): String? {
        fun known(line: String) = LENDERS.firstOrNull { (words, _) -> words.containsMatchIn(line) }?.second
        return lines.take(HEAD_LINES).firstNotNullOfOrNull { line ->
            known(line) ?: line.takeIf { LENDER_WORDS.containsMatchIn(it) && it.count(Char::isDigit) <= 2 }?.let(PaperText::titled)
        } ?: lines.firstNotNullOfOrNull(::known)
    }
}
