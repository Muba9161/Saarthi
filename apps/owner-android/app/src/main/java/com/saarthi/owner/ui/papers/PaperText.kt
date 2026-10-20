package com.saarthi.owner.ui.papers

import java.time.LocalDate

/**
 * What a vehicle paper says about itself, read from the text the phone
 * recognised on it: the paper's number, the date it was issued and the date
 * it runs out, and which vehicle it names.
 *
 * The text is OCR from a phone photo or a PDF, so it is noisy; dates are found
 * by their shape and sorted by the label printed before them ("Valid upto",
 * "Period of insurance … to", "Date of issue"). Anything that cannot be read
 * with reasonable confidence is left null, for the person to fill: a blank is
 * better than a confident wrong date.
 */
internal data class ReadPaper(
    val number: String? = null,
    val issuedOn: LocalDate? = null,
    val expiresOn: LocalDate? = null,
    /** A registration the paper names that is not this vehicle's, when it names none that is. */
    val otherPlate: String? = null,
) {
    val foundAnything: Boolean get() = number != null || issuedOn != null || expiresOn != null
}

internal object PaperText {

    /** Read [text] as the paper [documentType] for the vehicle [plate]. */
    fun read(text: String, documentType: String, plate: String?, today: LocalDate = LocalDate.now()): ReadPaper {
        val upper = text.uppercase()
        val lines = upper.lines()
        val dates = findDates(lines)
        val (issued, expires) = classify(dates, today)
        val plates = findPlates(upper)
        val ownPlate = plate?.let(::compact)
        val namesThisVehicle = ownPlate != null && ownPlate in plates
        val number = when (documentType) {
            RC -> if (namesThisVehicle) ownPlate else plates.firstOrNull()
            LICENCE -> findLicence(upper)
            else -> findNumber(lines, NUMBER_LABELS[documentType] ?: GENERIC_NUMBER_LABELS, plates)
        }
        return ReadPaper(
            number = number,
            issuedOn = issued,
            expiresOn = expires,
            otherPlate = if (!namesThisVehicle && ownPlate != null) plates.firstOrNull { it != ownPlate } else null,
        )
    }

    /** Every date printed in [text], in reading order — for other slips that print one (a pump slip, a bill). */
    fun datesIn(text: String): List<LocalDate> = findDates(text.uppercase().lines()).map { it.date }

    /** Every registration number printed in [text], without spaces. */
    fun platesIn(text: String): List<String> = findPlates(text.uppercase())

    // -- Dates ----------------------------------------------------------------

    /** A date on the paper, and the label nearest before it, if it has one. */
    private data class FoundDate(val date: LocalDate, val label: DateLabel?)

    private enum class DateLabel { ISSUE, EXPIRY }

    private val MONTHS = listOf("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")
    /** A month's name, allowing the digits OCR prints for its letters: "0ct", "N0v", "5ep", "Ju1". */
    private const val MONTH = "(JAN|FEB|MAR|APR|MAY|JUN|JU[L1I]|AUG|[S5]EP|[O0]CT|N[O0]V|DEC)[A-Z]*\\.?"

    /** Day first, as Indian papers print it: 15/04/2027, 15-04-27, 15.4.2027. */
    private val NUMERIC = Regex("(?<![0-9])([0-9]{1,2})\\s?[./-]\\s?([0-9]{1,2})\\s?[./-]\\s?([0-9]{4}|[0-9]{2})(?![0-9])")
    private val DAY_MONTH_NAME = Regex("(?<![0-9])([0-9]{1,2})(?:ST|ND|RD|TH)?[\\s./-]*$MONTH[\\s.,/-]*([0-9]{4}|[0-9]{2})(?![0-9])")
    private val MONTH_NAME_DAY = Regex("(?<![A-Z])$MONTH\\s+([0-9]{1,2}),?\\s+([0-9]{4})(?![0-9])")
    private val ISO = Regex("(?<![0-9])([0-9]{4})-([0-9]{2})-([0-9]{2})(?![0-9])")

    /** Characters OCR reads in place of a digit, inside something shaped like a date. */
    private val DATE_LIKE = Regex("[0-9OILS|]{1,4}\\s?[./-]\\s?[0-9OILS|]{1,2}\\s?[./-]\\s?[0-9OILS|]{2,4}")

    /** Labels, longest first so "EXPIRY DATE" wins over "DATE" where both end in the same place. */
    private val DATE_LABELS: List<Pair<String, DateLabel>> = listOf(
        "VALID UPTO" to DateLabel.EXPIRY, "VALID UP TO" to DateLabel.EXPIRY, "VALID TILL" to DateLabel.EXPIRY,
        "VALID UNTIL" to DateLabel.EXPIRY, "VALID TO" to DateLabel.EXPIRY, "VALIDITY UPTO" to DateLabel.EXPIRY,
        "VALIDITY" to DateLabel.EXPIRY, "UPTO" to DateLabel.EXPIRY, "UP TO" to DateLabel.EXPIRY,
        "EXPIRY DATE" to DateLabel.EXPIRY, "DATE OF EXPIRY" to DateLabel.EXPIRY, "EXPIRY" to DateLabel.EXPIRY,
        "EXPIRES ON" to DateLabel.EXPIRY, "EXPIRES" to DateLabel.EXPIRY, "EXPIRE" to DateLabel.EXPIRY,
        "EXP DATE" to DateLabel.EXPIRY, "END DATE" to DateLabel.EXPIRY, "ENDS ON" to DateLabel.EXPIRY,
        "DUE DATE" to DateLabel.EXPIRY, "NEXT DUE" to DateLabel.EXPIRY, "TILL" to DateLabel.EXPIRY,
        "UNTIL" to DateLabel.EXPIRY, "TO" to DateLabel.EXPIRY,
        "DATE OF ISSUE" to DateLabel.ISSUE, "ISSUE DATE" to DateLabel.ISSUE, "ISSUED ON" to DateLabel.ISSUE,
        "ISSUED" to DateLabel.ISSUE, "ISSUE" to DateLabel.ISSUE, "VALID FROM" to DateLabel.ISSUE,
        "FROM" to DateLabel.ISSUE, "START DATE" to DateLabel.ISSUE, "COMMENCEMENT" to DateLabel.ISSUE,
        "DATE OF TEST" to DateLabel.ISSUE, "TEST DATE" to DateLabel.ISSUE, "INSPECTION DATE" to DateLabel.ISSUE,
        "RECEIPT DATE" to DateLabel.ISSUE, "PAYMENT DATE" to DateLabel.ISSUE, "DATED" to DateLabel.ISSUE,
        "DATE" to DateLabel.ISSUE,
    ).sortedByDescending { it.first.length }

    private fun findDates(lines: List<String>): List<FoundDate> = buildList {
        lines.forEachIndexed { index, raw ->
            val line = repairDigits(raw)
            dateMatches(line).forEach { (start, date) ->
                val before = line.substring(0, start)
                // A label in a table sits on the line above when nothing on this one names the date.
                val label = nearestLabel(before) ?: if (before.isBlank() && index > 0) nearestLabel(repairDigits(lines[index - 1])) else null
                add(FoundDate(date, label))
            }
        }
    }

    /** O for 0, I or L for 1, S for 5 — inside date-shaped runs only, so words are left alone. */
    private fun repairDigits(line: String): String = DATE_LIKE.replace(line) { match ->
        match.value.map { char ->
            when (char) {
                'O' -> '0'
                'I', 'L', '|' -> '1'
                'S' -> '5'
                else -> char
            }
        }.joinToString("")
    }

    private fun dateMatches(line: String): List<Pair<Int, LocalDate>> {
        val found = mutableListOf<Pair<IntRange, LocalDate>>()
        fun take(regex: Regex, build: (MatchResult) -> LocalDate?) {
            regex.findAll(line).forEach { match ->
                if (found.none { it.first.first <= match.range.last && match.range.first <= it.first.last }) {
                    build(match)?.let { found += match.range to it }
                }
            }
        }
        take(ISO) { m -> dateOf(m.groupValues[3], m.groupValues[2], m.groupValues[1]) }
        take(DAY_MONTH_NAME) { m -> dateOf(m.groupValues[1], monthNumber(m.groupValues[2]), m.groupValues[3]) }
        take(MONTH_NAME_DAY) { m -> dateOf(m.groupValues[2], monthNumber(m.groupValues[1]), m.groupValues[3]) }
        take(NUMERIC) { m -> dateOf(m.groupValues[1], m.groupValues[2], m.groupValues[3]) }
        return found.sortedBy { it.first.first }.map { it.first.first to it.second }
    }

    private fun monthNumber(name: String): String {
        val letters = name.take(3).replace('0', 'O').replace('5', 'S').let { if (it == "JU1" || it == "JUI") "JUL" else it }
        return (MONTHS.indexOf(letters) + 1).toString()
    }

    private fun dateOf(day: String, month: String, year: String): LocalDate? {
        val y = year.toIntOrNull()?.let { if (year.length == 2) 2000 + it else it } ?: return null
        if (y !in 1990..2100) return null
        return runCatching { LocalDate.of(y, month.toInt(), day.toInt()) }.getOrNull()
    }

    /** The label ending closest to the end of [before]; on a tie, the longer one. */
    private fun nearestLabel(before: String): DateLabel? {
        var best: Pair<Int, DateLabel>? = null
        for ((word, kind) in DATE_LABELS) {
            val at = lastWord(before, word) ?: continue
            val end = at + word.length
            if (best == null || end > best.first) best = end to kind
        }
        return best?.second
    }

    /** Where [word] last appears in [text] as a whole word or phrase. */
    private fun lastWord(text: String, word: String): Int? {
        var from = text.length
        while (from >= 0) {
            val at = text.lastIndexOf(word, from)
            if (at < 0) return null
            val beforeOk = at == 0 || !text[at - 1].isLetter()
            val after = at + word.length
            val afterOk = after >= text.length || !text[after].isLetter()
            if (beforeOk && afterOk) return at
            from = at - 1
        }
        return null
    }

    /**
     * The issue and expiry dates from what was found. A labelled date is
     * trusted; without labels, a paper's expiry is its latest date, and only
     * when that date has not already come round.
     */
    private fun classify(dates: List<FoundDate>, today: LocalDate): Pair<LocalDate?, LocalDate?> {
        if (dates.isEmpty()) return null to null
        val expiry = dates.lastOrNull { it.label == DateLabel.EXPIRY }?.date
            ?: dates.map { it.date }.filter { it.isAfter(today) }.maxOrNull()
        val issued = dates.firstOrNull { it.label == DateLabel.ISSUE && (expiry == null || it.date.isBefore(expiry)) }?.date
            ?: dates.map { it.date }.distinct().takeIf { it.size == 2 }?.min()?.takeIf { expiry != null && it.isBefore(expiry) && !it.isAfter(today) }
        return issued to expiry
    }

    // -- Registration plates ----------------------------------------------------

    private val PLATE = Regex("(?<![A-Z0-9])([A-Z]{2})[\\s-]?([0-9]{1,2})[\\s-]?([A-Z]{0,3})[\\s-]?([0-9]{4})(?![0-9])")

    /** The RTO state and territory codes a registration starts with, so "NO 12 AB 1234" is not a plate. */
    private val STATE_CODES = setOf(
        "AN", "AP", "AR", "AS", "BR", "CG", "CH", "DD", "DL", "DN", "GA", "GJ", "HP", "HR", "JH", "JK", "KA", "KL",
        "LA", "LD", "MH", "ML", "MN", "MP", "MZ", "NL", "OD", "OR", "PB", "PY", "RJ", "SK", "TN", "TR", "TS", "UK",
        "UP", "WB",
    )

    /** Every registration the paper names, written without spaces. */
    private fun findPlates(upper: String): List<String> =
        PLATE.findAll(upper)
            .filter { it.groupValues[1] in STATE_CODES }
            .map { it.groupValues.drop(1).joinToString("") }
            .distinct()
            .toList()

    private fun compact(plate: String): String = plate.uppercase().filter { it.isLetterOrDigit() }

    // -- The paper's own number -------------------------------------------------

    private const val RC = "REGISTRATION_CERTIFICATE"
    const val LICENCE = "DRIVING_LICENCE"

    /**
     * An Indian licence number — state, RTO, year of issue, serial: "DL-1420110012345",
     * "MH12 20110012345". Read with the gaps and hyphens people and printers put in,
     * returned without them, as the server stores it.
     */
    private val LICENCE_NUMBER = Regex("(?<![A-Z0-9])([A-Z]{2})[\\s-]?([0-9]{2})[\\s-]?((?:19|20)[0-9]{2})[\\s-]?([0-9]{7})(?![0-9])")

    private fun findLicence(upper: String): String? =
        LICENCE_NUMBER.findAll(repairLicenceDigits(upper))
            .firstOrNull { it.groupValues[1] in STATE_CODES }
            ?.groupValues?.drop(1)?.joinToString("")

    /** O for 0 and I for 1 inside long digit runs, where a licence number's body sits. */
    private fun repairLicenceDigits(text: String): String = LICENCE_LIKE.replace(text) { match ->
        match.value.map { char -> if (char == 'O') '0' else if (char == 'I' || char == 'L') '1' else char }.joinToString("")
    }

    /** Starting at a digit, so the state code's letters ("DL", "OD") are never taken for digits. */
    private val LICENCE_LIKE = Regex("[0-9][0-9OIL\\s-]{9,}[0-9OIL]")

    private val GENERIC_NUMBER_LABELS = listOf("CERTIFICATE NO", "CERTIFICATE NUMBER", "DOCUMENT NO", "NUMBER", "NO")

    /** Labels printed before the number, per paper, most specific first. */
    private val NUMBER_LABELS: Map<String, List<String>> = mapOf(
        "INSURANCE" to listOf("POLICY NUMBER", "POLICY NO", "COVER NOTE NO", "CERTIFICATE NO", "CERTIFICATE NUMBER"),
        "POLLUTION_CERTIFICATE" to listOf("PUC CERTIFICATE NO", "PUCC NO", "CERTIFICATE SL NO", "CERTIFICATE NO", "CERTIFICATE NUMBER", "SERIAL NO", "SL NO"),
        "FITNESS_CERTIFICATE" to listOf("FITNESS CERTIFICATE NO", "CERTIFICATE NO", "CERTIFICATE NUMBER", "FC NO", "APPLICATION NO"),
        "PERMIT" to listOf("PERMIT NUMBER", "PERMIT NO", "AUTHORISATION NO", "AUTHORIZATION NO"),
        "ROAD_TAX" to listOf("RECEIPT NUMBER", "RECEIPT NO", "TRANSACTION NO", "CHALLAN NO", "BANK REF NO"),
    )

    private val SPACES = Regex("\\s+")

    private val NUMBER_VALUE = Regex("^[\\s:.#\\-]*([A-Z0-9][A-Z0-9/\\-]{4,39})")

    /** The value after the first label found; a registration plate is never taken for it. */
    private fun findNumber(lines: List<String>, labels: List<String>, plates: List<String>): String? {
        for (label in labels) {
            lines.forEachIndexed { index, line ->
                // "Policy No." and "Policy  No" read alike.
                val tidy = line.replace('.', ' ').replace(SPACES, " ")
                val at = lastWord(tidy, label) ?: return@forEachIndexed
                val rest = tidy.substring(at + label.length)
                val value = numberIn(rest) ?: lines.getOrNull(index + 1)?.let(::numberIn)
                if (value != null && compact(value) !in plates) return value
            }
        }
        return null
    }

    private fun numberIn(text: String): String? =
        NUMBER_VALUE.find(text)?.groupValues?.get(1)?.trimEnd('-', '/')?.takeIf { value -> value.count { it.isDigit() } >= 3 }

    // -- A licence's holder and classes ---------------------------------------------

    /** The vehicle classes a licence covers, as the RTO prints them, in order: "LMV, TRANS". */
    fun licenceClasses(text: String): String? {
        val upper = text.uppercase().replace(Regex("\\s*-\\s*"), "-")
        return LICENCE_CLASSES.mapNotNull { (code, shown) -> Regex("(?<![A-Z0-9-])${Regex.escape(code)}(?![A-Z0-9-])").find(upper)?.let { it.range.first to shown } }
            .sortedBy { it.first }
            .map { it.second }
            .distinct()
            .takeIf { it.isNotEmpty() }
            ?.joinToString(", ")
    }

    /** Most particular first, so "LMV-NT" is not read as "LMV". */
    private val LICENCE_CLASSES = listOf(
        "MCWOG" to "MCWOG", "MCWG" to "MCWG", "LMV-NT" to "LMV-NT", "LMV-TR" to "LMV-TR", "LMV" to "LMV", "HGMV" to "HGMV", "HPMV" to "HPMV",
        "HMV" to "HMV", "HTV" to "HTV", "MGV" to "MGV", "MPMV" to "MPMV", "LGV" to "LGV", "TRANSPORT" to "TRANS", "TRANS" to "TRANS",
        "TRAILER" to "TRAILER", "PSV" to "PSV", "INVCRG" to "INVCRG", "E-RICKSHAW" to "E-RICKSHAW", "3W-NT" to "3W-NT", "3W-TR" to "3W-TR",
    )

    /**
     * The holder's name on a licence: what follows "Name", where it is not a
     * parent's or husband's name, and reads as a name — letters, a few words.
     */
    fun holderName(text: String): String? {
        val lines = text.uppercase().lines().map { it.trim() }.filter { it.isNotEmpty() }
        lines.forEachIndexed { index, line ->
            val found = HOLDER_LABEL.find(line) ?: return@forEachIndexed
            if (RELATIVE_WORDS.any { it in line.substring(0, found.range.first + 1) }) return@forEachIndexed
            val rest = line.substring(found.range.last + 1).trim(' ', ':', '.', '-')
            val name = (rest.ifBlank { lines.getOrNull(index + 1).orEmpty() }).trim()
            if (looksLikeName(name)) return titled(name)
        }
        return null
    }

    private val HOLDER_LABEL = Regex("(?<![A-Z])NAME(?![A-Z])")
    private val RELATIVE_WORDS = listOf("S/O", "D/O", "W/O", "S/D/W", "SON", "DAUGHTER", "WIFE", "FATHER", "HUSBAND", "GUARDIAN", "MOTHER", "RELATION")
    private val NOT_NAME_WORDS = listOf("DATE", "BIRTH", "ISSUE", "VALID", "ADDRESS", "BLOOD", "LICENCE", "LICENSE", "DRIVING", "INDIA", "UNION", "STATE", "TRANSPORT", "AUTHORITY", "SIGNATURE")

    private fun looksLikeName(value: String): Boolean {
        val words = value.split(SPACES).filter { it.isNotEmpty() }
        return words.size in 1..5 && value.length in 3..60 && value.all { it.isLetter() || it == ' ' || it == '.' } &&
            NOT_NAME_WORDS.none { it in value }
    }

    /** A printed heading or name as people write it: letters and the usual joins kept, words capitalised. */
    fun titled(line: String): String? {
        val kept = line.filter { it.isLetterOrDigit() || it == ' ' || it == '&' || it == '.' || it == '-' }.trim(' ', '-', '.')
        if (kept.count { it.isLetter() } < 3) return null
        return kept.split(SPACES).joinToString(" ") { word -> word.lowercase().replaceFirstChar { it.uppercase() } }.take(160)
    }
}
