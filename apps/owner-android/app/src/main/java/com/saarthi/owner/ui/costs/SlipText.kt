package com.saarthi.owner.ui.costs

import com.saarthi.owner.ui.papers.PaperText
import java.time.LocalDate
import java.time.LocalTime
import kotlin.math.abs
import kotlin.math.round

/**
 * What a pump slip says, read from the text the phone recognised on it. Each
 * field is null when it could not be read with reasonable confidence — a
 * blank for the person to fill beats a confident wrong number.
 */
internal data class ReadFillUp(
    val litres: Double? = null,
    val rate: Double? = null,
    val amount: Double? = null,
    val filledOn: LocalDate? = null,
    val filledAt: LocalTime? = null,
    val plate: String? = null,
    val station: String? = null,
    val odometerKm: Double? = null,
) {
    val foundAnything: Boolean get() = litres != null || rate != null || amount != null || filledOn != null
}

/** What a workshop's bill says about the work. */
internal data class ReadBill(
    val total: Double? = null,
    val date: LocalDate? = null,
    val invoiceNumber: String? = null,
    val workshop: String? = null,
    val odometerKm: Double? = null,
    /** The kind of work the bill's words point to, as a `maintenanceTypeSchema` value. */
    val type: String? = null,
    val plate: String? = null,
) {
    val foundAnything: Boolean get() = total != null || date != null || invoiceNumber != null || workshop != null
}

/** What a road slip says — a toll receipt, a parking ticket, a dhaba's bill. */
internal data class ReadSlip(
    val amount: Double? = null,
    /** The slip's kind as an `ExpenseCategory`, when its words say. */
    val category: String? = null,
    val vendor: String? = null,
    val date: LocalDate? = null,
    val plate: String? = null,
) {
    val foundAnything: Boolean get() = amount != null || category != null || vendor != null
}

/**
 * Slips and bills read on the phone, the way [PaperText] reads papers.
 *
 * A pump slip prints litres, rate and amount, and the three must agree —
 * litres × rate is the amount — so the reader checks them against each other,
 * and when the labels are lost (a till roll often comes out as a column of
 * labels and then a column of values) it looks for the three numbers that do.
 */
internal object SlipText {

    fun fillUp(text: String, today: LocalDate = LocalDate.now()): ReadFillUp {
        val upper = text.uppercase()
        val lines = upper.lines().map { it.trim() }.filter { it.isNotEmpty() }

        // "RS/LTR" names the rate, not the litres.
        var litres = labelled(lines, VOLUME_LABELS, skip = RATE_LABELS) { it in LITRES }
        var rate = labelled(lines, RATE_LABELS) { it in RATE }
        var amount = labelled(lines, AMOUNT_LABELS) { it in AMOUNT }

        if (!agree(litres, rate, amount)) {
            val found = agreeingTriple(numbersIn(lines))
            if (found != null) {
                litres = found.first
                rate = found.second
                amount = found.third
            } else {
                // Two read, the third worked out from them; a pair that gives nonsense is dropped.
                when {
                    amount != null && rate != null -> litres = (amount / rate).takeIf { it in LITRES }
                    amount != null && litres != null -> rate = (amount / litres).takeIf { it in RATE }
                    litres != null && rate != null -> amount = (litres * rate).takeIf { it in AMOUNT }
                }
            }
        }

        return ReadFillUp(
            litres = litres?.rounded(2),
            rate = rate?.rounded(2),
            amount = amount?.rounded(2),
            filledOn = PaperText.datesIn(text).firstOrNull { !it.isAfter(today) && it.isAfter(today.minusDays(RECENT_DAYS)) },
            filledAt = timeIn(upper),
            plate = PaperText.platesIn(text).firstOrNull(),
            station = stationIn(lines),
            odometerKm = labelled(lines, ODOMETER_LABELS) { it in ODOMETER },
        )
    }

    fun bill(text: String, today: LocalDate = LocalDate.now()): ReadBill {
        val upper = text.uppercase()
        val lines = upper.lines().map { it.trim() }.filter { it.isNotEmpty() }
        return ReadBill(
            total = billTotal(lines),
            date = PaperText.datesIn(text).firstOrNull { !it.isAfter(today) },
            invoiceNumber = invoiceIn(lines),
            workshop = workshopIn(lines),
            odometerKm = labelled(lines, ODOMETER_LABELS) { it in ODOMETER },
            type = workTypeIn(upper),
            plate = PaperText.platesIn(text).firstOrNull(),
        )
    }

    fun expense(text: String, today: LocalDate = LocalDate.now()): ReadSlip {
        val upper = text.uppercase()
        val lines = upper.lines().map { it.trim() }.filter { it.isNotEmpty() }
        return ReadSlip(
            amount = billTotal(lines) ?: labelled(lines, SLIP_AMOUNT_LABELS) { it in AMOUNT },
            category = SLIP_KINDS.firstOrNull { (words, _) -> words.any { it in upper } }?.second,
            vendor = slipVendorIn(lines),
            date = PaperText.datesIn(text).firstOrNull { !it.isAfter(today) && it.isAfter(today.minusDays(RECENT_DAYS)) },
            plate = PaperText.platesIn(text).firstOrNull(),
        )
    }

    // -- Numbers ----------------------------------------------------------------

    private val LITRES = 0.5..2000.0
    private val RATE = 40.0..300.0
    private val AMOUNT = 10.0..2_000_000.0
    private val ODOMETER = 100.0..5_000_000.0
    private const val RECENT_DAYS = 60L

    /** Amounts as printed: 1,25,000.00 (lakhs) · 5,000.00 · 5000 · 54.08 · 94,27 (a decimal comma). */
    private val NUMBER = Regex("(?<![0-9A-Z])([0-9]{1,2}(?:,[0-9]{2})+,[0-9]{3}(?:\\.[0-9]{1,3})?|[0-9]{1,3}(?:,[0-9]{3})+(?:\\.[0-9]{1,3})?|[0-9]+(?:[.,][0-9]{1,3})?)(?![0-9])")

    /** Thousands grouped the Indian way (1,25,000) or the Western way (125,000). */
    private val GROUPED = Regex("^[0-9]{1,3}(,[0-9]{2,3})*,[0-9]{3}$")

    private fun parse(raw: String): Double? = when {
        ',' in raw && '.' in raw -> raw.replace(",", "")
        GROUPED.matches(raw) -> raw.replace(",", "")
        else -> raw.replace(',', '.')
    }.toDoubleOrNull()

    /** The amounts printed on one line, in order. */
    internal fun numbersOn(line: String): List<Double> = NUMBER.findAll(line).mapNotNull { parse(it.groupValues[1]) }.toList()

    private fun numbersIn(lines: List<String>): List<Double> = lines.flatMap(::numbersOn).distinct()

    /**
     * The first plausible number after one of [labels]: on the label's own
     * line, or alone on the line below it when the slip prints a table.
     */
    private fun labelled(lines: List<String>, labels: List<String>, skip: List<String> = emptyList(), plausible: (Double) -> Boolean): Double? {
        lines.forEachIndexed { index, line ->
            if (skip.any { it in line }) return@forEachIndexed
            val at = labels.firstNotNullOfOrNull { label -> line.indexOf(label).takeIf { it >= 0 }?.let { it + label.length } } ?: return@forEachIndexed
            numbersOn(line.substring(at)).firstOrNull(plausible)?.let { return it }
            lines.getOrNull(index + 1)?.let { next -> numbersOn(next).firstOrNull(plausible)?.let { return it } }
        }
        return null
    }

    private fun agree(litres: Double?, rate: Double?, amount: Double?): Boolean =
        litres != null && rate != null && amount != null && abs(litres * rate - amount) <= amount * AGREE_WITHIN

    /** Three numbers on the slip where litres × rate is the amount, to within a rupee or so. */
    private fun agreeingTriple(numbers: List<Double>): Triple<Double, Double, Double>? {
        for (rate in numbers.filter { it in RATE }) {
            for (litres in numbers.filter { it in LITRES && it != rate }) {
                val amount = numbers.firstOrNull { it in AMOUNT && it != rate && it != litres && abs(litres * rate - it) <= maxOf(1.0, it * TRIPLE_WITHIN) }
                if (amount != null) return Triple(litres, rate, amount)
            }
        }
        return null
    }

    private const val AGREE_WITHIN = 0.03
    private const val TRIPLE_WITHIN = 0.005

    private fun Double.rounded(places: Int): Double {
        var factor = 1.0
        repeat(places) { factor *= 10 }
        return round(this * factor) / factor
    }

    // -- Pump slip words ----------------------------------------------------------

    private val VOLUME_LABELS = listOf("VOLUME", "VOL.", "VOL ", "QUANTITY", "QTY", "LITRES", "LITERS", "LTRS", "LTR")
    private val RATE_LABELS = listOf("RATE", "PRICE", "RS/L", "RS/LTR", "₹/L")
    private val AMOUNT_LABELS = listOf("AMOUNT", "AMT", "SALE", "TOTAL", "VALUE")
    private val ODOMETER_LABELS = listOf("ODOMETER", "ODO", "KM READING", "KMS", "KM")

    private val TIME = Regex("(?<![0-9])([01]?[0-9]|2[0-3]):([0-5][0-9])(?::[0-5][0-9])?\\s*(AM|PM)?")

    private fun timeIn(upper: String): LocalTime? {
        val match = TIME.find(upper) ?: return null
        var hour = match.groupValues[1].toInt()
        when (match.groupValues[3]) {
            "PM" -> if (hour < 12) hour += 12
            "AM" -> if (hour == 12) hour = 0
        }
        return runCatching { LocalTime.of(hour, match.groupValues[2].toInt()) }.getOrNull()
    }

    private val STATION_WORDS = listOf("FILLING STATION", "FUEL STATION", "SERVICE STATION", "PETROL PUMP", "FUELS", "PETROLEUM", "FILLING", "AUTOMOBILES", "KISAN SEVA KENDRA")
    private val BRANDS = listOf("INDIAN OIL" to "Indian Oil", "IOCL" to "Indian Oil", "BHARAT PETROLEUM" to "Bharat Petroleum", "BPCL" to "Bharat Petroleum", "HINDUSTAN PETROLEUM" to "Hindustan Petroleum", "HPCL" to "Hindustan Petroleum", "NAYARA" to "Nayara Energy", "RELIANCE" to "Jio-bp", "JIO-BP" to "Jio-bp", "SHELL" to "Shell")

    /** The pump's own name when it prints one, else the oil company's. */
    private fun stationIn(lines: List<String>): String? =
        lines.firstOrNull { line -> STATION_WORDS.any { it in line } }?.let(PaperText::titled)
            ?: BRANDS.firstOrNull { (word, _) -> lines.any { word in it } }?.second

    // -- Bill words -----------------------------------------------------------------

    /** Strongest first: a grand total over a sub-total, a net amount over a line total. */
    private val TOTAL_LABELS = listOf("GRAND TOTAL", "NET PAYABLE", "AMOUNT PAYABLE", "NET AMOUNT", "TOTAL AMOUNT", "BILL AMOUNT", "INVOICE TOTAL", "NET TOTAL", "TOTAL")

    private fun billTotal(lines: List<String>): Double? {
        for (label in TOTAL_LABELS) {
            val values = lines.mapIndexedNotNull { index, line ->
                if (label !in line || "SUB" in line.substringBefore(label).takeLast(4)) return@mapIndexedNotNull null
                (numbersOn(line.substringAfter(label)).lastOrNull { it in BILL } ?: lines.getOrNull(index + 1)?.let { numbersOn(it).lastOrNull { v -> v in BILL } })
            }
            values.maxOrNull()?.let { return it }
        }
        return null
    }

    private val BILL = 1.0..10_000_000.0

    private val INVOICE_LABELS = listOf("INVOICE NO", "INVOICE NUMBER", "INVOICE #", "INV NO", "INV. NO", "BILL NO", "BILL NUMBER", "JOB CARD NO", "JOB CARD")
    private val TOKEN = Regex("^[\\s:.#\\-]*([A-Z0-9][A-Z0-9/\\-]{1,30})")

    private fun invoiceIn(lines: List<String>): String? {
        for (line in lines) {
            val label = INVOICE_LABELS.firstOrNull { it in line } ?: continue
            val token = TOKEN.find(line.substringAfter(label))?.groupValues?.get(1) ?: continue
            if (token != "DATE" && token.any { it.isDigit() }) return token
        }
        return null
    }

    private val WORKSHOP_WORDS = listOf("MOTORS", "AUTOMOBILES", "AUTO ", "GARAGE", "WORKSHOP", "SERVICE CENTRE", "SERVICE CENTER", "SERVICE STATION", "ENGINEERING", "WORKS", "TYRES", "SPARES", "MECHANIC")

    /** The workshop's name, from the head of the bill where it is printed. */
    private fun workshopIn(lines: List<String>): String? =
        lines.take(HEAD_LINES).firstOrNull { line -> WORKSHOP_WORDS.any { it in "$line " } }?.let(PaperText::titled)

    private const val HEAD_LINES = 6

    /** The kind of work, most particular first: a general service lists oil too, so it is a service. */
    private val WORK_TYPES = listOf(
        listOf("GENERAL SERVICE", "PERIODIC SERVICE", "FREE SERVICE", "PAID SERVICE", "SERVICING") to "PREVENTIVE",
        listOf("TYRE", "TIRE", "PUNCTURE", "ALIGNMENT", "BALANCING") to "TYRE",
        listOf("BRAKE") to "BRAKE",
        listOf("ENGINE OIL", "OIL CHANGE", "OIL FILTER") to "OIL_CHANGE",
        listOf("BATTERY", "ALTERNATOR", "WIRING", "SELF MOTOR", "STARTER") to "ELECTRICAL",
        listOf("DENT", "PAINT", "BODY") to "BODYWORK",
        listOf("CLUTCH", "GEARBOX", "ENGINE") to "ENGINE",
        listOf("INSPECTION", "FITNESS") to "INSPECTION",
        listOf("SERVICE") to "PREVENTIVE",
    )

    private fun workTypeIn(upper: String): String? = WORK_TYPES.firstOrNull { (words, _) -> words.any { it in upper } }?.second

    // -- Road slip words -------------------------------------------------------------

    private val SLIP_AMOUNT_LABELS = listOf("AMOUNT", "AMT", "FEE", "FARE", "PAID", "CHARGES", "RS.", "RS ", "₹")

    /** The kind of slip, most particular first: a challan on a highway is still a challan, not a toll. */
    private val SLIP_KINDS = listOf(
        listOf("CHALLAN", "PENALTY", "FINE ", "TRAFFIC POLICE") to "CHALLAN",
        listOf("TOLL", "PLAZA", "NHAI", "FASTAG") to "TOLL",
        listOf("PARKING") to "PARKING",
        listOf("UNLOADING", "LOADING", "HAMALI") to "LOADING",
        listOf("PUNCTURE", "REPAIR", "MECHANIC", "WORKSHOP") to "REPAIR",
        listOf("DHABA", "RESTAURANT", "HOTEL", "MEALS", "THALI", "FOOD") to "FOOD",
    )

    private val NOT_NAMES = listOf("RECEIPT", "INVOICE", "CASH MEMO", "BILL", "WELCOME", "THANK", "GSTIN", "TICKET", "DATE")

    /** Who was paid: a plaza's name when it prints one, else the slip's heading. */
    private fun slipVendorIn(lines: List<String>): String? {
        val head = lines.take(HEAD_LINES).filterNot { line -> NOT_NAMES.any { it in line } || line == "NHAI" }
        return (head.firstOrNull { "PLAZA" in it } ?: head.firstOrNull { line -> line.count(Char::isLetter) >= 4 && line.count(Char::isDigit) <= 2 })?.let(PaperText::titled)
    }
}
