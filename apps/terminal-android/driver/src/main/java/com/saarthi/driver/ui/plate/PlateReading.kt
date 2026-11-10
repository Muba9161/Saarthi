package com.saarthi.driver.ui.plate

/**
 * Finding an Indian registration number in what the camera read.
 *
 * Pure Kotlin, no Android, so every rule here is unit-tested. The text
 * recogniser hands back whatever it saw — the plate, the dealer's sticker, the
 * "IND" strip, a slogan on the tailgate — and its letters are only mostly right:
 * an `O` for a `0`, a `B` for an `8`. Each position on a plate is either a
 * letter or a digit, so a misread can be put right by where it sits, which is
 * why this parses rather than matching one regex.
 *
 * Two shapes are read:
 *  - the ordinary plate, `MH 12 AB 1234` — state, RTO, series, number;
 *  - the Bharat series, `22 BH 1234 AA`.
 */
internal object PlateReading {

    /** State and union-territory codes, so `IN 01` off a sign is never a plate. */
    private val STATES = setOf(
        "AN", "AP", "AR", "AS", "BR", "CG", "CH", "DD", "DL", "DN", "GA", "GJ", "HP", "HR",
        "JH", "JK", "KA", "KL", "LA", "LD", "MH", "ML", "MN", "MP", "MZ", "NL", "OD", "OR",
        "PB", "PY", "RJ", "SK", "TG", "TN", "TR", "TS", "UA", "UK", "UP", "WB",
    )

    /** What the recogniser most often reads in place of a digit. */
    private val DIGIT_FOR = mapOf(
        'O' to '0', 'D' to '0', 'Q' to '0', 'I' to '1', 'L' to '1',
        'Z' to '2', 'S' to '5', 'G' to '6', 'B' to '8',
    )

    /** …and in place of a letter. */
    private val LETTER_FOR = mapOf(
        '0' to 'O', '1' to 'I', '2' to 'Z', '4' to 'A', '5' to 'S', '6' to 'G', '8' to 'B',
    )

    /**
     * More guesses than this and the "plate" is more invention than reading.
     *
     * Four, because a hand-painted or worn `5205` reads as `s2oS` on its own —
     * three guesses in the number, each pinned by its position. What a guess
     * can invent is still held to a real state code, the plate's shape, four
     * digits and three frames agreeing.
     */
    private const val MAX_CORRECTIONS = 4

    /**
     * The number on a plate is always read as four digits — `0007`, never `7`.
     *
     * Plates print it padded, and accepting fewer was how a plate half out of
     * the frame (`UP 65 EP 52…`) filled in as `UP 6 EPS 2`: the same partial
     * view agreed with itself frame after frame. With four required, a plate
     * that is not wholly in view fills in nothing.
     */
    private const val NUMBER_DIGITS = 4

    private class Candidate(val parts: List<String>, val corrections: Int, val whole: Boolean) {
        val length = parts.sumOf { it.length }
        val formatted get() = parts.joinToString(" ")
    }

    /** Fewest guesses, then a line that is nothing but the plate, then the longest. */
    private val BEST = compareBy<Candidate>(
        { it.corrections },
        { !it.whole },
        { -it.length },
    )

    /**
     * The plate in [lines] — top to bottom, as the recogniser found them —
     * formatted `MH 12 AB 1234`, or null when none of it is a plate.
     *
     * Adjacent lines are also tried joined, because autos, buses and trucks
     * carry the number on two rows: `MH 12` above `AB 1234`.
     */
    fun read(lines: List<String>): String? {
        val split = lines.map { line -> pieces(line).map(::normalise).filter { it.isNotEmpty() } }
            .filter { it.isNotEmpty() }
        // Only the end of one row may join the start of the next: pieces a
        // symbol cut apart stay apart.
        val texts = split.flatten() + split.zipWithNext { above, below -> above.last() + below.first() }
        return texts.flatMap(::candidatesIn).minWithOrNull(BEST)?.formatted
    }

    /**
     * A line cut at any symbol a plate does not carry. Such a symbol is a
     * character the recogniser could not read (`@` for a scrawled `E`); dropping
     * it would glue what is either side into a plate that is not there.
     */
    private fun pieces(line: String): List<String> = line.split(FOREIGN)

    /** Everything that is not a letter, a digit or a plate's own separators. */
    private val FOREIGN = Regex("""[^\p{L}\p{N}\s.\-•·]""")

    /** Upper case, letters and digits only: spaces, dots, dashes and the `•` on some plates go. */
    fun normalise(text: String): String = text.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }

    private fun candidatesIn(text: String): List<Candidate> = buildList {
        for (start in text.indices) {
            // At least one series letter: a plate without one is too rare to be
            // worth what `MH 12 2000` off a shop sign would cost.
            for (rto in 1..2) for (series in 1..3) {
                standard(text, start, rto, series)?.let(::add)
            }
            bharat(text, start)?.let(::add)
        }
    }

    /** `MH 12 AB 1234` with the given RTO and series lengths, read from [start]. */
    private fun standard(text: String, start: Int, rto: Int, series: Int): Candidate? {
        val end = start + 2 + rto + series + NUMBER_DIGITS
        if (end > text.length) return null
        val reader = Reader(text, start)
        val state = reader.letters(2) ?: return null
        if (state !in STATES) return null
        // Only Delhi writes a one-digit RTO (`DL 3C AB 1234`); everywhere else
        // pads it, so `UP 6S` is `UP 65` with a misread 5, not RTO 6 and an S.
        if (rto == 1 && state != "DL") return null
        val parts = listOf(
            state,
            reader.digits(rto) ?: return null,
            reader.letters(series) ?: return null,
            reader.digits(NUMBER_DIGITS)?.takeIf { it != "0000" } ?: return null,
        )
        if (parts[1].all { it == '0' }) return null
        return reader.candidate(parts, whole = start == 0 && end == text.length)
    }

    /** `22 BH 1234 AA` — two-digit year, BH, four digits, one or two letters. */
    private fun bharat(text: String, start: Int): Candidate? {
        for (suffix in 2 downTo 1) {
            val end = start + 8 + suffix
            if (end > text.length) continue
            val reader = Reader(text, start)
            val year = reader.digits(2) ?: continue
            if (reader.letters(2) != "BH") continue
            val parts = listOf(year, "BH", reader.digits(NUMBER_DIGITS) ?: continue, reader.letters(suffix) ?: continue)
            return reader.candidate(parts, whole = start == 0 && end == text.length) ?: continue
        }
        return null
    }

    /** Walks [text] from [start], converting each part to the class its position demands. */
    private class Reader(private val text: String, private var at: Int) {
        private var corrections = 0

        fun letters(count: Int): String? = take(count, Char::isLetter, LETTER_FOR)
        fun digits(count: Int): String? = take(count, Char::isDigit, DIGIT_FOR)

        fun candidate(parts: List<String>, whole: Boolean): Candidate? =
            Candidate(parts, corrections, whole).takeIf { corrections <= MAX_CORRECTIONS }

        private fun take(count: Int, fits: (Char) -> Boolean, fix: Map<Char, Char>): String? {
            val out = StringBuilder(count)
            repeat(count) {
                val char = text[at++]
                out.append(
                    when {
                        fits(char) -> char
                        else -> fix[char]?.also { corrections++ } ?: return null
                    },
                )
            }
            return out.toString()
        }
    }
}

/**
 * Agreement across frames before a reading is trusted.
 *
 * One frame can misread a smudged `8` as a `B` and still look like a plate;
 * three frames rarely misread it the same way. A reading is accepted once it has
 * been seen [needed] times in the last [window] frames that held any plate.
 */
internal class PlateConsensus(private val needed: Int = 3, private val window: Int = 6) {
    private val recent = ArrayDeque<String>()

    /** Records one frame's reading; returns the plate once enough frames agree. */
    fun offer(plate: String?): String? {
        if (plate == null) return null
        recent.addLast(plate)
        while (recent.size > window) recent.removeFirst()
        return plate.takeIf { reading -> recent.count { it == reading } >= needed }
    }

    /** How many recent frames read [plate] — enough to show it, before enough to trust it. */
    fun seen(plate: String): Int = recent.count { it == plate }
}
