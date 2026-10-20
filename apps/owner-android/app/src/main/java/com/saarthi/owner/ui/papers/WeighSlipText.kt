package com.saarthi.owner.ui.papers

/**
 * A weighbridge slip (kanta parchi) read on the phone: the load's net weight,
 * printed as such or worked out from the gross and tare weighings.
 */
internal object WeighSlipText {

    /** The net weight in kilograms, or null when the slip does not say it plainly. */
    fun netKg(text: String): Double? {
        val lines = text.uppercase().lines().map { it.trim() }.filter { it.isNotEmpty() }
        weightAfter(lines, NET_LABELS)?.let { return it }
        val gross = weightAfter(lines, GROSS_LABELS)
        val tare = weightAfter(lines, TARE_LABELS)
        return if (gross != null && tare != null && gross > tare) gross - tare else null
    }

    private val NET_LABELS = listOf("NET WEIGHT", "NETT WEIGHT", "NET WT", "NETT WT", "NET", "NETT")
    private val GROSS_LABELS = listOf("GROSS WEIGHT", "GROSS WT", "GROSS", "FIRST WEIGHT", "1ST WEIGHT")
    private val TARE_LABELS = listOf("TARE WEIGHT", "TARE WT", "TARE", "SECOND WEIGHT", "2ND WEIGHT")

    /** A loaded truck's weight, in kilograms. */
    private val KG = 1.0..200_000.0

    private val NOT_WEIGHTS = Regex("[0-9]{1,4}[/.\\-][0-9A-Z]{1,9}[/.\\-][0-9]{2,4}|[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?")
    private val WEIGHT = Regex("(?<![0-9.,])([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.([0-9]{1,3}))?\\s*(KGS?|TONNES?|TONS?|MT|T)?(?![A-Z0-9])")

    /** The first weight after the strongest label: a tonnes figure (marked, or printed to three decimals) is turned into kilograms. */
    private fun weightAfter(lines: List<String>, labels: List<String>): Double? {
        for (label in labels) {
            val words = Regex("(?<![A-Z])${Regex.escape(label)}(?![A-Z])")
            lines.forEachIndexed { index, line ->
                val found = words.find(line) ?: return@forEachIndexed
                val rest = line.substring(found.range.last + 1).let { if (it.none(Char::isDigit)) lines.getOrNull(index + 1).orEmpty() else it }
                val match = WEIGHT.find(NOT_WEIGHTS.replace(rest, " ")) ?: return@forEachIndexed
                val whole = match.groupValues[1].replace(",", "")
                val decimals = match.groupValues[2]
                val value = "$whole${if (decimals.isEmpty()) "" else ".$decimals"}".toDoubleOrNull() ?: return@forEachIndexed
                val unit = match.groupValues[3]
                val tonnes = unit.startsWith("T") || unit == "MT" || (unit.isEmpty() && decimals.length == 3 && value < 100)
                val kg = if (tonnes) value * 1000 else value
                if (kg in KG) return kg
            }
        }
        return null
    }
}
