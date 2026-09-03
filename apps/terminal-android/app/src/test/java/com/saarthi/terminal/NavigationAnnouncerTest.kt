package com.saarthi.terminal

import com.saarthi.terminal.domain.NavigationAnnouncer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the terminal says out loud, and — mostly — what it does not.
 *
 * A navigator that talks too much gets muted, and a muted navigator is a driver
 * reading a screen at speed. So nearly every case here is about silence: the
 * same turn announced once per band and not again, nothing repeated after a
 * re-route, nothing said at all about a route the driver is only looking at.
 */
class NavigationAnnouncerTest {

    private val announcer = NavigationAnnouncer()

    private fun input(
        stepMetres: Int,
        speedKph: Double = 50.0,
        instruction: String? = "Turn left onto NH 48",
        nowMs: Long = 0L,
        journeyKey: String? = "pump",
        routeKey: String? = "pump-r1",
        arrived: Boolean = false,
        rerouting: Boolean = false,
        rerouteFailed: Boolean = false,
    ) = NavigationAnnouncer.Input(
        journeyKey = journeyKey,
        routeKey = routeKey,
        destinationName = "Bharat Petroleum",
        routeDistanceKm = 12.0,
        routeDurationMinutes = 20,
        instruction = instruction,
        maneuver = "turn",
        modifier = "left",
        roadName = "NH 48",
        stepMetres = stepMetres,
        speedKph = speedKph,
        rerouting = rerouting,
        rerouteFailed = rerouteFailed,
        arrived = arrived,
        nowMs = nowMs,
    )

    /** Get the opening line out of the way — every journey starts with it. */
    private fun open(nowMs: Long = 0L): String? =
        announcer.next(input(stepMetres = 5_000, nowMs = nowMs))

    // -----------------------------------------------------------------------
    // Opening
    // -----------------------------------------------------------------------

    @Test
    fun `the first thing said is where the driver is going`() {
        val cue = open()

        assertNotNull(cue)
        assertTrue(cue!!, cue.contains("Bharat Petroleum"))
        assertTrue(cue, cue.contains("12 kilometres"))
        assertTrue(cue, cue.contains("20 minutes"))
    }

    @Test
    fun `the opening is said once`() {
        open()
        // Still far from any manoeuvre, so there is nothing else to say.
        assertNull(announcer.next(input(stepMetres = 5_000, nowMs = 10_000)))
    }

    @Test
    fun `nothing is said when there is no route`() {
        assertNull(announcer.next(input(stepMetres = 0, journeyKey = null, routeKey = null)))
    }

    // -----------------------------------------------------------------------
    // Turns
    // -----------------------------------------------------------------------

    @Test
    fun `a turn is announced once per band, in order`() {
        open()

        // 50 km/h → far ≈ 1250 m, approach ≈ 417 m, imminent ≈ 125 m.
        val far = announcer.next(input(stepMetres = 1_000, nowMs = 10_000))
        assertNotNull(far)
        assertTrue(far!!, far.startsWith("In 1 kilometre"))

        // Same band again — silence.
        assertNull(announcer.next(input(stepMetres = 900, nowMs = 20_000)))

        val approach = announcer.next(input(stepMetres = 400, nowMs = 30_000))
        assertNotNull(approach)
        assertTrue(approach!!, approach.startsWith("In 400 metres"))

        assertNull(announcer.next(input(stepMetres = 350, nowMs = 40_000)))

        val imminent = announcer.next(input(stepMetres = 100, nowMs = 50_000))
        assertEquals("Turn left onto NH 48", imminent)

        // And never again for this turn.
        assertNull(announcer.next(input(stepMetres = 60, nowMs = 60_000)))
    }

    @Test
    fun `joining close to a turn skips straight to the useful cue`() {
        open()

        // The route's first manoeuvre is already 300 m away. Working through
        // "in 1.2 kilometres" first would be describing a junction the driver
        // has nearly reached.
        val cue = announcer.next(input(stepMetres = 300, nowMs = 10_000))

        assertNotNull(cue)
        assertTrue(cue!!, cue.startsWith("In 300 metres"))
    }

    @Test
    fun `the next turn gets its own announcements`() {
        open()
        announcer.next(input(stepMetres = 100, nowMs = 10_000))

        val next = announcer.next(
            input(stepMetres = 400, nowMs = 20_000, instruction = "Turn right onto Ring Road"),
        )

        assertNotNull(next)
        assertTrue(next!!, next.contains("turn right onto Ring Road"))
    }

    @Test
    fun `the warning distance scales with speed`() {
        val slow = NavigationAnnouncer()
        val fast = NavigationAnnouncer()

        slow.next(input(stepMetres = 5_000, speedKph = 20.0))
        fast.next(input(stepMetres = 5_000, speedKph = 100.0))

        // 250 m is nine seconds at 100 km/h — the instruction has to come now.
        // At 20 km/h it is forty-five seconds away, which is a heads-up.
        val fastCue = fast.next(input(stepMetres = 250, speedKph = 100.0, nowMs = 10_000))
        val slowCue = slow.next(input(stepMetres = 250, speedKph = 20.0, nowMs = 10_000))

        assertEquals("Turn left onto NH 48", fastCue)
        assertTrue(slowCue!!, slowCue.startsWith("In 250 metres"))
    }

    @Test
    fun `two sentences are not stacked back to back`() {
        // The opening line lands at t=0; a far cue a second later would be the
        // app talking over itself.
        open(nowMs = 0L)
        assertNull(announcer.next(input(stepMetres = 1_000, nowMs = 1_000)))

        // Once there has been a pause, it speaks.
        assertNotNull(announcer.next(input(stepMetres = 1_000, nowMs = 6_000)))
    }

    @Test
    fun `the imminent instruction is never held back for politeness`() {
        open(nowMs = 0L)

        // Immediately after the opening line, and still spoken: this is the one
        // cue the driver is about to act on.
        val cue = announcer.next(input(stepMetres = 90, nowMs = 500))
        assertEquals("Turn left onto NH 48", cue)
    }

    // -----------------------------------------------------------------------
    // Re-routing and arrival
    // -----------------------------------------------------------------------

    @Test
    fun `leaving the route is announced once`() {
        open()

        val first = announcer.next(input(stepMetres = 400, nowMs = 10_000, rerouting = true))
        assertNotNull(first)
        assertTrue(first!!, first.contains("Finding a new way"))

        assertNull(announcer.next(input(stepMetres = 400, nowMs = 20_000, rerouting = true)))
    }

    @Test
    fun `a new route to the same place does not repeat the destination`() {
        open()
        announcer.next(input(stepMetres = 400, nowMs = 10_000, rerouting = true))

        val afterReroute = announcer.next(
            input(
                stepMetres = 400,
                nowMs = 30_000,
                routeKey = "pump-r2",
                instruction = "Turn right onto Service Road",
            ),
        )

        assertNotNull(afterReroute)
        // The driver knows where they are going. They have just taken a wrong
        // turn; being told the destination and total distance again would be
        // the app rubbing it in.
        assertTrue(afterReroute!!, !afterReroute.contains("Heading to"))
        assertTrue(afterReroute, afterReroute.contains("turn right onto Service Road"))
    }

    @Test
    fun `a genuinely new journey does open again`() {
        open()

        val newJourney = announcer.next(
            input(
                stepMetres = 5_000,
                nowMs = 60_000,
                journeyKey = "workshop",
                routeKey = "workshop-r1",
            ),
        )

        assertNotNull(newJourney)
        assertTrue(newJourney!!, newJourney.contains("Heading to"))
    }

    @Test
    fun `arriving is announced once`() {
        open()

        val arrival = announcer.next(input(stepMetres = 0, nowMs = 60_000, arrived = true))
        assertNotNull(arrival)
        assertTrue(arrival!!, arrival.contains("arrived at Bharat Petroleum"))

        assertNull(announcer.next(input(stepMetres = 0, nowMs = 70_000, arrived = true)))
    }

    @Test
    fun `giving up on re-routing is explained, not repeated`() {
        open()

        val failure = announcer.next(input(stepMetres = 400, nowMs = 10_000, rerouteFailed = true))
        assertNotNull(failure)
        assertTrue(failure!!, failure.contains("cannot find a route"))

        assertNull(announcer.next(input(stepMetres = 400, nowMs = 20_000, rerouteFailed = true)))
    }

    // -----------------------------------------------------------------------
    // Wording
    // -----------------------------------------------------------------------

    @Test
    fun `an instruction reads correctly after a distance`() {
        open()
        val cue = announcer.next(input(stepMetres = 400, nowMs = 10_000))

        // "In 400 metres, turn left…" — not "In 400 metres, Turn left…".
        assertEquals("In 400 metres, turn left onto NH 48", cue)
    }

    @Test
    fun `an acronym keeps its capitals`() {
        open()
        val cue = announcer.next(
            input(stepMetres = 400, nowMs = 10_000, instruction = "NH 48 continues ahead"),
        )

        assertEquals("In 400 metres, NH 48 continues ahead", cue)
    }

    @Test
    fun `a step with no instruction is described from its manoeuvre`() {
        open()
        val cue = announcer.next(input(stepMetres = 100, nowMs = 10_000, instruction = null))

        // A router occasionally emits a step with no text. Silence at a junction
        // is worse than an assembled instruction.
        assertEquals("Turn left onto NH 48", cue)
    }

    @Test
    fun `distances are rounded to something a person can hear`() {
        open()
        val cue = announcer.next(input(stepMetres = 412, nowMs = 10_000))

        // Not "four hundred and twelve metres", which takes longer to say than
        // the driver has to act on it.
        assertTrue(cue!!, cue.startsWith("In 400 metres"))
    }

    @Test
    fun `stopping navigation clears everything`() {
        open()
        announcer.next(input(stepMetres = 100, nowMs = 10_000))

        announcer.reset()

        val cue = announcer.next(input(stepMetres = 5_000, nowMs = 20_000))
        assertNotNull(cue)
        assertTrue(cue!!, cue.contains("Heading to"))
    }
}
