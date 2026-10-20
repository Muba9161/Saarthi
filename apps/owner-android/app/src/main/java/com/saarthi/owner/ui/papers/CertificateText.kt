package com.saarthi.owner.ui.papers

import java.time.LocalDate

/** What a business's certificate says: a GST registration (REG-06), an Udyam certificate, a company's incorporation. */
internal data class ReadBusiness(
    val gstin: String? = null,
    /** The Udyam number or the company's CIN. */
    val registrationNumber: String? = null,
    val foundedYear: Int? = null,
    /** The trade name where one is printed, else the legal name. */
    val name: String? = null,
) {
    val foundAnything: Boolean get() = gstin != null || registrationNumber != null || foundedYear != null || name != null
}

/**
 * Business certificates read on the phone. A GSTIN is only taken when its
 * check character proves it — the same rule the web and the server hold it to
 * — so a misread is left blank rather than filled in wrong.
 */
internal object CertificateText {

    fun read(text: String, today: LocalDate = LocalDate.now()): ReadBusiness {
        val upper = text.uppercase()
        val lines = upper.lines().map { it.trim() }.filter { it.isNotEmpty() }
        return ReadBusiness(
            gstin = gstinIn(upper),
            registrationNumber = UDYAM.find(upper.replace(" ", ""))?.value ?: CIN.find(upper.replace(" ", ""))?.value,
            foundedYear = foundedIn(lines)?.year?.takeIf { it in FIRST_YEAR..today.year },
            name = nameIn(lines),
        )
    }

    // -- GSTIN ---------------------------------------------------------------------

    private const val ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    private val GSTIN = Regex("^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")

    /** Where a GSTIN has digits ('9'), letters ('A') and its fixed 'Z'; the rest may be either. */
    private const val SHAPE = "99AAAAA9999A*Z*"

    fun checkCharacter(first14: String): Char? {
        if (first14.length != 14) return null
        var sum = 0
        first14.forEachIndexed { index, char ->
            val value = ALPHABET.indexOf(char).takeIf { it >= 0 } ?: return null
            val product = value * (if (index % 2 == 0) 1 else 2)
            sum += product / 36 + product % 36
        }
        return ALPHABET[(36 - sum % 36) % 36]
    }

    /** Shaped right, for a real state (01–38, or 97 and 99 for the centre's own codes), with the right check character. */
    fun isGstin(value: String): Boolean {
        if (!GSTIN.matches(value)) return false
        val state = value.take(2).toInt()
        return (state in 1..38 || state == 97 || state == 99) && checkCharacter(value.take(14)) == value[14]
    }

    /**
     * Each fifteen-character run of a line, its letters and digits put back
     * where OCR swaps them, kept only when it checks out. The entity number is
     * nearly always a digit, so a misread "I" there is tried as a "1" first.
     */
    private fun gstinIn(upper: String): String? =
        upper.lines().asSequence()
            .map { line -> line.filter { it.isLetterOrDigit() } }
            .flatMap { run -> (0..run.length - 15).asSequence().map { start -> run.substring(start, start + 15) } }
            .flatMap { window -> sequenceOf(repair(window, entityAsDigit = true), repair(window, entityAsDigit = false)) }
            .firstOrNull(::isGstin)

    private fun repair(candidate: String, entityAsDigit: Boolean): String = candidate.mapIndexed { index, char ->
        when (SHAPE[index]) {
            '9' -> DIGIT_FOR[char] ?: char
            'A' -> LETTER_FOR[char] ?: char
            'Z' -> if (char == '2') 'Z' else char
            else -> if (entityAsDigit) DIGIT_FOR[char] ?: char else char
        }
    }.joinToString("")

    private val DIGIT_FOR = mapOf('O' to '0', 'D' to '0', 'I' to '1', 'L' to '1', 'S' to '5', 'B' to '8', 'Z' to '2', 'G' to '6')
    private val LETTER_FOR = mapOf('0' to 'O', '1' to 'I', '5' to 'S', '8' to 'B', '2' to 'Z', '6' to 'G')

    // -- Registration and founding ------------------------------------------------------

    private val UDYAM = Regex("UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}")
    private val CIN = Regex("[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}")
    private const val FIRST_YEAR = 1800

    /** The day the business began, as an incorporation or Udyam certificate prints it (a GST "date of liability" is not it). */
    private val FOUNDED_LABELS = listOf("DATE OF INCORPORATION", "INCORPORATED ON", "DATE OF COMMENCEMENT", "COMMENCEMENT OF PRODUCTION", "COMMENCEMENT OF BUSINESS")

    private fun foundedIn(lines: List<String>): LocalDate? {
        for (label in FOUNDED_LABELS) {
            lines.forEachIndexed { index, line ->
                if (label !in line) return@forEachIndexed
                val rest = line.substringAfter(label)
                (PaperText.datesIn(rest).firstOrNull() ?: lines.getOrNull(index + 1)?.let { PaperText.datesIn(it).firstOrNull() })?.let { return it }
            }
        }
        return null
    }

    // -- Name -----------------------------------------------------------------------------

    /** Trade name first: the name customers know the business by. */
    private val NAME_LABELS = listOf("TRADE NAME", "NAME OF ENTERPRISE", "NAME OF THE ENTERPRISE", "NAME OF THE COMPANY", "NAME OF COMPANY", "LEGAL NAME")
    private val NOT_A_NAME = listOf("IF ANY", "NOT APPLICABLE", "N/A", "NA")

    private fun nameIn(lines: List<String>): String? {
        for (label in NAME_LABELS) {
            lines.forEachIndexed { index, line ->
                if (label !in line) return@forEachIndexed
                val rest = line.substringAfter(label).replace("IF ANY", "").trim(' ', ':', '.', '-', ',')
                val value = (rest.ifBlank { lines.getOrNull(index + 1).orEmpty() }).removePrefix("M/S").trim(' ', '.', ':')
                if (value.isNotBlank() && NOT_A_NAME.none { value == it } && value.count(Char::isLetter) >= 3) {
                    return PaperText.titled(value)
                }
            }
        }
        return null
    }
}
