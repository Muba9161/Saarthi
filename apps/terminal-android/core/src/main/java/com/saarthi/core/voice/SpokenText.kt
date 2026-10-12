package com.saarthi.core.voice

import java.util.Locale

/**
 * An answer, made fit to be read aloud.
 *
 * Saarthi writes the way the web chat shows it — **bold** for the one thing
 * that matters, a short list, now and then a link — and a speech engine reads
 * that markup out: "asterisk asterisk insurance expired asterisk asterisk".
 * And it answers in the language it was asked in, which an Indian English
 * voice cannot read: handed Devanagari, it skips it or spells it.
 */
object SpokenText {

    /** The words of [answer], without the markup around them. */
    fun of(answer: String): String =
        answer
            .replace(LINK, "$1")
            .lineSequence()
            .map { line -> line.replace(LIST_MARK, "").replace(HEADING, "") }
            .filter { it.isNotBlank() }
            .joinToString("\n")
            .replace(EMPHASIS, "")
            .trim()

    /**
     * The voice to read [text] in, from the script it is written in.
     *
     * The first letter outside the Latin alphabet decides. Hinglish in Latin
     * letters stays with the Indian English voice, which reads it naturally;
     * Hindi, Marathi and Dogri share Devanagari, and the Hindi voice reads all
     * three.
     */
    fun localeOf(text: String): Locale {
        for (letter in text) {
            when (Character.UnicodeBlock.of(letter)) {
                Character.UnicodeBlock.DEVANAGARI -> return Locale.forLanguageTag("hi-IN")
                Character.UnicodeBlock.BENGALI -> return Locale.forLanguageTag("bn-IN")
                Character.UnicodeBlock.GUJARATI -> return Locale.forLanguageTag("gu-IN")
                Character.UnicodeBlock.TAMIL -> return Locale.forLanguageTag("ta-IN")
                Character.UnicodeBlock.MALAYALAM -> return Locale.forLanguageTag("ml-IN")
                else -> Unit
            }
        }
        return INDIAN_ENGLISH
    }

    val INDIAN_ENGLISH: Locale = Locale.forLanguageTag("en-IN")

    /** `[text](url)` — keep the text. */
    private val LINK = Regex("""\[([^\]]+)]\([^)]*\)""")

    /** `- `, `* `, `• ` or `1. ` opening a line. */
    private val LIST_MARK = Regex("""^\s*(?:[-*•]|\d+[.)])\s+""")

    /** `#`s opening a heading. */
    private val HEADING = Regex("""^\s*#{1,6}\s+""")

    /** `**`, `__`, a lone `*` or `_` around a word, and backticks. */
    private val EMPHASIS = Regex("""\*\*|__|(?<=\s|^)[*_](?=\S)|(?<=\S)[*_](?=\s|$|[.,!?])|`""")
}
