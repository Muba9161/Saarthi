package com.saarthi.core.voice

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

/** An answer as the web chat writes it, made fit to be read aloud. */
class SpokenTextTest {

    @Test
    fun `bold, lists and headings are read as their words`() {
        val answer = """
            ## Your vehicle
            Your **insurance has expired**.
            - Fitness: valid till 12 Mar
            * PUC: *expiring soon*
            1. Call the office
        """.trimIndent()

        assertEquals(
            "Your vehicle\nYour insurance has expired.\nFitness: valid till 12 Mar\nPUC: expiring soon\nCall the office",
            SpokenText.of(answer),
        )
    }

    @Test
    fun `a link is read as its text`() {
        assertEquals("Open Papers to see it.", SpokenText.of("Open [Papers](/papers) to see it."))
    }

    @Test
    fun `figures and ordinary punctuation survive`() {
        assertEquals("Diesel is ₹95.36 a litre, 2 km away.", SpokenText.of("Diesel is ₹95.36 a litre, 2 km away."))
    }

    @Test
    fun `the voice follows the script of the answer`() {
        assertEquals(Locale.forLanguageTag("hi-IN"), SpokenText.localeOf("आपकी गाड़ी ठीक है।"))
        assertEquals(Locale.forLanguageTag("ta-IN"), SpokenText.localeOf("உங்கள் வாகனம் சரியாக உள்ளது"))
        assertEquals(Locale.forLanguageTag("bn-IN"), SpokenText.localeOf("আপনার গাড়ি ঠিক আছে"))
        // Hinglish in Latin letters is the Indian English voice's to read.
        assertEquals(SpokenText.INDIAN_ENGLISH, SpokenText.localeOf("Aapki gaadi theek hai, RJ14EF3344"))
    }
}
