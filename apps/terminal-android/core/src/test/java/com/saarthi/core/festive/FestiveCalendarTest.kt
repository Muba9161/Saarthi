package com.saarthi.core.festive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime
import java.util.Locale

/**
 * The app must pick the same festival as the web on every day, so these mirror
 * `packages/shared/src/festive/festive.test.ts` and the dates in `calendar.ts`.
 */
class FestiveCalendarTest {

    /** A window as `festiveWindows` builds it: two days before the day, until one day after. */
    private fun window(key: String, day: String, extraTail: Long = 0): FestiveWindowDto {
        val date = LocalDate.parse(day)
        return FestiveWindowDto(
            key = key,
            day = day,
            start = date.minusDays(2).toString(),
            end = date.plusDays(1 + extraTail).toString(),
        )
    }

    private val windows = listOf(
        window("diwali", "2026-11-08"),
        window("guru-nanak-jayanti", "2026-11-24"),
        window("christmas", "2026-12-25"),
        window("new-year", "2027-01-01"),
        window("eid-al-fitr", "2027-03-10", extraTail = 1),
        window("independence-day", "2027-08-15"),
        window("raksha-bandhan", "2027-08-17"),
        window("janmashtami", "2027-08-25"),
    ).sortedBy { it.start }

    private fun activeOn(ymd: String) = FestiveCalendar.activeWindowOn(ymd, windows)?.key

    @Test
    fun `the festival whose own day it is wins over one still to come`() {
        assertEquals("independence-day", activeOn("2027-08-15"))
    }

    @Test
    fun `the day after, the festival still to come wins over the one that passed`() {
        assertEquals("raksha-bandhan", activeOn("2027-08-16"))
        assertEquals("raksha-bandhan", activeOn("2027-08-17"))
        assertEquals("raksha-bandhan", activeOn("2027-08-18"))
        assertNull(activeOn("2027-08-19"))
    }

    @Test
    fun `a festival shows from two days before until the day after`() {
        assertNull(activeOn("2026-11-20"))
        assertNull(activeOn("2026-11-21"))
        assertEquals("guru-nanak-jayanti", activeOn("2026-11-22"))
        assertEquals("guru-nanak-jayanti", activeOn("2026-11-24"))
        assertEquals("guru-nanak-jayanti", activeOn("2026-11-25"))
        assertNull(activeOn("2026-11-26"))
    }

    @Test
    fun `eid shows one day longer`() {
        assertEquals("eid-al-fitr", activeOn("2027-03-12"))
        assertNull(activeOn("2027-03-13"))
    }

    @Test
    fun `between two passed festivals the most recent wins, between two to come the nearest`() {
        val overlapping = listOf(
            FestiveWindowDto("first", day = "2027-05-10", start = "2027-05-01", end = "2027-05-20"),
            FestiveWindowDto("second", day = "2027-05-12", start = "2027-05-01", end = "2027-05-20"),
        )
        assertEquals("first", FestiveCalendar.activeWindowOn("2027-05-05", overlapping)?.key)
        assertEquals("second", FestiveCalendar.activeWindowOn("2027-05-15", overlapping)?.key)
        assertEquals("second", FestiveCalendar.activeWindowOn("2027-05-15", overlapping.reversed())?.key)
    }

    @Test
    fun `no windows means no festival`() {
        assertNull(FestiveCalendar.activeWindowOn("2026-11-24", emptyList()))
    }

    @Test
    fun `the server's answer is read, ignoring what the apps do not draw`() {
        val calendar = FestiveCalendar.parse(SERVER_ANSWER)
        assertNotNull(calendar)
        val look = FestiveCalendar.lookOn(calendar!!, LocalDate.parse("2026-11-24"))!!

        assertEquals("guru-nanak-jayanti", look.key)
        assertEquals("Happy Gurpurab", look.wish)
        assertEquals("from everyone at VorldX Saarthi", look.signature)
        assertEquals(0xFFFFD58A.toInt(), look.wishOnDark)
        assertEquals(0xFF9A4A07.toInt(), look.wishOnLight)
        val band = look.band!!
        assertEquals(FestiveMotif.TORAN, band.motif)
        assertEquals(FestiveDrop.DIYA, band.drop)
        assertEquals(0xFFF59E0B.toInt(), band.a)
        assertEquals(0xFF1E3A8A.toInt(), band.rope)
    }

    @Test
    fun `nothing shows on a day with no window, or for a festival the answer does not describe`() {
        val calendar = FestiveCalendar.parse(SERVER_ANSWER)!!
        assertNull(FestiveCalendar.lookOn(calendar, LocalDate.parse("2026-11-20")))
        assertNull(FestiveCalendar.lookOn(calendar, LocalDate.parse("2026-12-25")))
    }

    @Test
    fun `a motif this build does not know keeps the wish and drops the garland`() {
        val calendar = FestiveCalendar.parse(SERVER_ANSWER.replace("\"toran\"", "\"fireworks\""))!!
        val look = FestiveCalendar.lookOn(calendar, LocalDate.parse("2026-11-24"))!!
        assertEquals("Happy Gurpurab", look.wish)
        assertNull(look.band)
    }

    @Test
    fun `an unreadable answer is no calendar rather than an error`() {
        assertNull(FestiveCalendar.parse(null))
        assertNull(FestiveCalendar.parse(""))
        assertNull(FestiveCalendar.parse("{not json"))
        assertNull(FestiveCalendar.parse("[]"))
    }

    @Test
    fun `the wish is addressed by first name`() {
        val look = look(locale = "en-IN")
        assertEquals("Happy Gurpurab, Ravi", look.greeting("Ravi Kumar"))
        assertEquals("Happy Gurpurab, Ravi", look.greeting("  Ravi   Kumar "))
        assertEquals("Happy Gurpurab, " + "A".repeat(24), look.greeting("A".repeat(30)))
    }

    @Test
    fun `without a usable name the wish stands alone`() {
        val look = look(locale = "en-IN")
        assertEquals("Happy Gurpurab", look.greeting(null))
        assertEquals("Happy Gurpurab", look.greeting(""))
        assertEquals("Happy Gurpurab", look.greeting("   "))
        assertEquals("Happy Gurpurab", look.greeting("ravi@example.com"))
    }

    @Test
    fun `urdu takes the arabic comma`() {
        assertEquals("Happy Gurpurab، Ravi", look(locale = "ur-IN").greeting("Ravi"))
    }

    @Test
    fun `colours are read only as #RRGGBB`() {
        assertEquals(0xFFFFD58A.toInt(), FestiveCalendar.parseColor("#FFD58A"))
        assertEquals(0xFF000000.toInt(), FestiveCalendar.parseColor("#000000"))
        assertNull(FestiveCalendar.parseColor("FFD58A"))
        assertNull(FestiveCalendar.parseColor("#FFF"))
        assertNull(FestiveCalendar.parseColor("#GGGGGG"))
    }

    @Test
    fun `the language sent is language and region only`() {
        assertEquals("hi-IN", festiveLocale(Locale.forLanguageTag("hi-IN")))
        assertEquals("en-IN", festiveLocale(Locale.forLanguageTag("en-IN-u-mu-celsius")))
        assertEquals("doi", festiveLocale(Locale.forLanguageTag("doi")))
        assertEquals("en", festiveLocale(Locale.ROOT))
    }

    @Test
    fun `the day is checked again just after local midnight`() {
        assertEquals(61_000L, millisUntilNextLocalDay(LocalDateTime.parse("2026-11-20T23:59:00")))
        assertEquals(86_401_000L, millisUntilNextLocalDay(LocalDateTime.parse("2026-11-20T00:00:00")))
    }

    private fun look(locale: String) = FestiveLook(
        key = "guru-nanak-jayanti",
        wish = "Happy Gurpurab",
        signature = "",
        locale = locale,
        band = null,
        wishOnDark = 0,
        wishOnLight = 0,
    )

    private companion object {
        /** `GET /api/v1/festive?locale=en-IN` on 2026-11-20, cut to two festivals. */
        const val SERVER_ANSWER = """
        {
          "locale": "en-IN",
          "today": "2026-11-20",
          "signature": "from everyone at VorldX Saarthi",
          "windows": [
            { "key": "guru-nanak-jayanti", "day": "2026-11-24", "start": "2026-11-22", "end": "2026-11-25" },
            { "key": "christmas", "day": "2026-12-25", "start": "2026-12-23", "end": "2026-12-26" }
          ],
          "festivals": {
            "guru-nanak-jayanti": {
              "key": "guru-nanak-jayanti",
              "name": "Guru Nanak Jayanti",
              "wish": "Happy Gurpurab",
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
            }
          }
        }
        """
    }
}
