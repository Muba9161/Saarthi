package com.saarthi.owner.festive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class FestiveCalendarTest {

    /** The windows `festiveWindows()` in calendar.ts builds: two days before each day, one after (Eids two). */
    private val windows: List<FestiveWindow> = listOf(
        "diwali" to listOf("2026-11-08", "2027-10-29", "2028-10-17"),
        "guru-nanak-jayanti" to listOf("2026-11-24", "2027-11-14", "2028-11-02"),
        "christmas" to listOf("2026-12-25", "2027-12-25"),
        "new-year" to listOf("2027-01-01", "2028-01-01"),
        "makar-sankranti" to listOf("2027-01-14", "2028-01-15"),
        "republic-day" to listOf("2027-01-26", "2028-01-26"),
        "eid-al-fitr" to listOf("2027-03-10", "2028-02-27"),
        "holi" to listOf("2027-03-23", "2028-03-11"),
        "eid-al-adha" to listOf("2027-05-17", "2028-05-05"),
        "independence-day" to listOf("2027-08-15", "2028-08-15"),
        "raksha-bandhan" to listOf("2027-08-17", "2028-08-04"),
        "janmashtami" to listOf("2027-08-25", "2028-08-13"),
        "ganesh-chaturthi" to listOf("2027-09-04", "2028-08-23"),
        "onam" to listOf("2027-09-12", "2028-09-01"),
        "dussehra" to listOf("2027-10-09", "2028-09-27"),
    ).flatMap { (key, days) ->
        val tail = if (key.startsWith("eid-")) 2L else 1L
        days.map { day -> window(key, day, lead = 2, tail = tail) }
    }.sortedBy { it.start }

    private fun window(key: String, day: String, lead: Long = 2, tail: Long = 1): FestiveWindow {
        val date = LocalDate.parse(day)
        return FestiveWindow(key, day, date.minusDays(lead).toString(), date.plusDays(tail).toString())
    }

    private fun on(ymd: String): String? = activeWindowOn(ymd, windows)?.key

    @Test
    fun `nothing shows before a window opens or after it closes`() {
        assertNull(on("2026-11-20"))
        assertNull(on("2026-11-21"))
        assertNull(on("2026-11-26"))
    }

    @Test
    fun `Guru Nanak Jayanti shows from two days before until the day after`() {
        assertEquals("guru-nanak-jayanti", on("2026-11-22"))
        assertEquals("guru-nanak-jayanti", on("2026-11-24"))
        assertEquals("guru-nanak-jayanti", on("2026-11-25"))
    }

    @Test
    fun `the festival whose own day it is wins where two windows meet`() {
        assertEquals("independence-day", on("2027-08-15"))
    }

    @Test
    fun `the festival still to come wins over one that has passed`() {
        assertEquals("raksha-bandhan", on("2027-08-16"))
    }

    @Test
    fun `both Eids keep one more day`() {
        assertEquals("eid-al-fitr", on("2027-03-12"))
        assertNull(on("2027-03-13"))
        assertEquals("eid-al-adha", on("2027-05-19"))
        assertNull(on("2027-05-20"))
    }

    @Test
    fun `of two festivals still to come the nearer wins, of two passed the more recent`() {
        val near = window("a", "2030-01-10")
        val far = window("b", "2030-01-11")
        assertEquals("a", activeWindowOn("2030-01-09", listOf(far, near))?.key)
        assertEquals("a", activeWindowOn("2030-01-09", listOf(near, far))?.key)

        val older = window("c", "2030-02-01", tail = 3)
        val newer = window("d", "2030-02-02", tail = 3)
        assertEquals("d", activeWindowOn("2030-02-03", listOf(older, newer))?.key)
        assertEquals("d", activeWindowOn("2030-02-03", listOf(newer, older))?.key)
    }

    @Test
    fun `the wish is addressed by first name`() {
        assertEquals("Happy Gurpurab, Aarav!", greetingLine("Happy Gurpurab", "Aarav", "en-IN"))
        assertEquals("Happy Gurpurab, Aarav!", greetingLine("Happy Gurpurab", "  Aarav Kumar ", "en-IN"))
        assertEquals("Eid Mubarak، Zoya!", greetingLine("Eid Mubarak", "Zoya", "ur-IN"))
    }

    @Test
    fun `no name or an email-looking one leaves the wish alone`() {
        assertEquals("Happy Gurpurab", greetingLine("Happy Gurpurab", null, "en-IN"))
        assertEquals("Happy Gurpurab", greetingLine("Happy Gurpurab", "  ", "en-IN"))
        assertEquals("Happy Gurpurab", greetingLine("Happy Gurpurab", "owner@saarthi.local", "en-IN"))
    }

    @Test
    fun `a long first name is cut to twenty-four letters`() {
        val name = "A".repeat(30)
        assertEquals("Hi, ${"A".repeat(24)}!", greetingLine("Hi", name, "en-IN"))
    }

    @Test
    fun `the email stand-in for a missing first name is not a name to greet`() {
        assertEquals("Ravi", greetingName("Ravi", "Ravi Kumar"))
        assertEquals("Ravi", greetingName("Ravi", "Ravi"))
        // No names at all: the session shows the email as the full name.
        assertNull(greetingName("ravi", "ravi@example.com"))
        // A last name only: the first name is the email's first part.
        assertNull(greetingName("ravi", "Kumar"))
        assertNull(greetingName("", ""))
    }

    @Test
    fun `the calendar is fetched once a day, again in a new language, and whenever there is none`() {
        assertFalse(needsFetch(true, "2026-11-20", "hi", "2026-11-20", "hi"))
        assertTrue(needsFetch(true, "2026-11-19", "hi", "2026-11-20", "hi"))
        assertTrue(needsFetch(true, "2026-11-20", "hi", "2026-11-20", "ta"))
        assertTrue(needsFetch(false, "2026-11-20", "hi", "2026-11-20", "hi"))
        assertTrue(needsFetch(true, null, null, "2026-11-20", "en"))
    }

    @Test
    fun `colours read as opaque ARGB, anything else as null`() {
        assertEquals(0xFFF59E0BL, argbOf("#F59E0B"))
        assertEquals(0xFF1e3a8aL, argbOf("#1e3a8a"))
        assertNull(argbOf("F59E0"))
        assertNull(argbOf("#-12345"))
        assertNull(argbOf("#GGGGGG"))
    }

    @Test
    fun `the server's answer reads, an unknown motif draws nothing, and today's festival is picked`() {
        val raw = """
            {
              "locale": "hi-IN",
              "today": "2026-11-20",
              "signature": "VorldX Saarthi परिवार की ओर से",
              "windows": [
                { "key": "guru-nanak-jayanti", "day": "2026-11-24", "start": "2026-11-22", "end": "2026-11-25" },
                { "key": "christmas", "day": "2026-12-25", "start": "2026-12-23", "end": "2026-12-26" }
              ],
              "festivals": {
                "guru-nanak-jayanti": {
                  "key": "guru-nanak-jayanti",
                  "name": "Guru Nanak Jayanti",
                  "wish": "गुरपुरब की बधाई",
                  "kit": {
                    "motif": "toran",
                    "drop": "diya",
                    "band": { "a": "#F59E0B", "b": "#FFE7A3", "c": "#1E3A8A", "d": "#1E3A8A", "rope": "#1E3A8A", "leaf": "#2F855A" },
                    "cta": { "from": "#F9B949", "to": "#EE8A1A", "ink": "#2B1600" },
                    "glow": [{ "color": "#EE8A1A", "alpha": 0.36 }, { "color": "#2547A0", "alpha": 0.5 }],
                    "wishOnDark": "#FFD58A",
                    "wishOnLight": "#9A4A07",
                    "fx": "petals",
                    "fxColors": ["#F9B949", "#FFE7A3", "#FFFFFF"]
                  }
                },
                "christmas": {
                  "key": "christmas",
                  "name": "Christmas",
                  "wish": "क्रिसमस की शुभकामनाएँ",
                  "kit": {
                    "motif": "something-new",
                    "band": { "a": "#E23B3B", "b": "#F5C451", "c": "#2FA36B", "d": "#4F7BF0", "rope": "#4B5563", "leaf": "#2FA36B" },
                    "glow": [],
                    "wishOnDark": "#FFE2E2",
                    "fx": "glitter",
                    "fxColors": []
                  }
                }
              }
            }
        """.trimIndent()
        val calendar = FestiveJson.decodeFromString(FestiveCalendar.serializer(), raw)

        val gurpurab = calendar.festivals.getValue("guru-nanak-jayanti").kit
        assertEquals(FestiveMotif.TORAN, gurpurab.motif)
        assertEquals(FestiveDrop.DIYA, gurpurab.drop)
        assertEquals(FestiveFx.PETALS, gurpurab.fx)
        assertEquals(0.5f, gurpurab.glow[1].alpha)

        val christmas = calendar.festivals.getValue("christmas").kit
        assertNull(christmas.motif)
        assertNull(christmas.fx)

        assertNull(lookOn(calendar, "2026-11-20", null))
        val look = lookOn(calendar, "2026-11-24", greetingHiddenOn = "2026-11-23")!!
        assertEquals("guru-nanak-jayanti", look.festival.key)
        assertEquals("hi-IN", look.locale)
        assertFalse(look.greetingHidden)
        assertTrue(lookOn(calendar, "2026-11-24", greetingHiddenOn = "2026-11-24")!!.greetingHidden)

        // What is cached is read back the same.
        val again = FestiveJson.decodeFromString(
            FestiveCalendar.serializer(),
            FestiveJson.encodeToString(FestiveCalendar.serializer(), calendar),
        )
        assertEquals(calendar, again)
    }
}
