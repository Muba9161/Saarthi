package com.saarthi.core.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The fatigue tally, which nothing on the platform measured before.
 *
 * Worth testing to this depth because of what it is for: a driver deciding
 * whether to push on to the next town. Every case below is a thing that
 * actually happens to a phone in a lorry — a toll queue, a tunnel, the app
 * being killed overnight, a clock correction — and each one used to be an
 * opportunity to put a wrong number in front of that decision.
 */
class DrivingHoursTest {

    private val minute = 60_000L
    private val hour = 60 * minute

    private fun driving(state: DrivingHours.State, forMs: Long, stepMs: Long = 5 * minute) =
        (1..(forMs / stepMs)).fold(state) { acc, _ ->
            DrivingHours.advance(acc, speedKph = 60.0, nowMs = acc.atMs!! + stepMs)
        }

    private fun stopped(state: DrivingHours.State, forMs: Long, stepMs: Long = 5 * minute) =
        (1..(forMs / stepMs)).fold(state) { acc, _ ->
            DrivingHours.advance(acc, speedKph = 0.0, nowMs = acc.atMs!! + stepMs)
        }

    @Test
    fun `the first reading only sets the clock`() {
        val first = DrivingHours.advance(DrivingHours.reset(), speedKph = 60.0, nowMs = 1_000)
        // Nothing is known about the time before the first reading, so nothing
        // is counted for it.
        assertEquals(0, first.stintMs)
        assertEquals(0, first.todayMs)
        // Long, not Int: `atMs` is nullable so it boxes, and a boxed Integer
        // never equals a boxed Long however equal the numbers look.
        assertEquals(1_000L, first.atMs)
    }

    @Test
    fun `counts time at the wheel`() {
        var state = DrivingHours.advance(DrivingHours.reset(), 60.0, nowMs = 0)
        state = driving(state, forMs = 2 * hour)

        assertEquals(2 * hour, state.stintMs)
        assertEquals(2 * hour, state.todayMs)
        assertNull(state.restingSinceMs)
        assertEquals(DrivingHours.Advice.NONE, state.advice)
    }

    @Test
    fun `warns before the break is due, not at it`() {
        var state = DrivingHours.advance(DrivingHours.reset(), 60.0, nowMs = 0)
        state = driving(state, forMs = 4 * hour + 35 * minute)

        // Half an hour of notice, so a driver can reach somewhere to stop
        // rather than being told once they are already over.
        assertEquals(DrivingHours.Advice.BREAK_SOON, state.advice)
    }

    @Test
    fun `says a break is due at five hours`() {
        var state = DrivingHours.advance(DrivingHours.reset(), 60.0, nowMs = 0)
        state = driving(state, forMs = 5 * hour)

        assertEquals(DrivingHours.Advice.BREAK_DUE, state.advice)
    }

    @Test
    fun `a proper break clears the stint but not the day`() {
        var state = DrivingHours.advance(DrivingHours.reset(), 60.0, nowMs = 0)
        state = driving(state, forMs = 5 * hour)
        state = stopped(state, forMs = 35 * minute)

        assertEquals(0, state.stintMs)
        // A break is not a new day.
        assertEquals(5 * hour, state.todayMs)
        assertEquals(DrivingHours.Advice.NONE, state.advice)
    }

    @Test
    fun `a toll queue is not a break`() {
        var state = DrivingHours.advance(DrivingHours.reset(), 60.0, nowMs = 0)
        state = driving(state, forMs = 5 * hour)
        // Eight minutes at a barrier. Resetting a five-hour stint for this would
        // make the whole measure meaningless.
        state = stopped(state, forMs = 8 * minute, stepMs = 2 * minute)

        assertEquals(5 * hour, state.stintMs)
        assertEquals(DrivingHours.Advice.BREAK_DUE, state.advice)
    }

    @Test
    fun `the day's limit outranks the stint`() {
        var state = DrivingHours.advance(DrivingHours.reset(), 60.0, nowMs = 0)
        state = driving(state, forMs = 5 * hour)
        state = stopped(state, forMs = 35 * minute)
        state = driving(state, forMs = 5 * hour)

        // Over both. The day is what gets said, because that one ends with
        // parking rather than a cup of tea.
        assertEquals(DrivingHours.Advice.SHIFT_DUE, state.advice)
    }

    @Test
    fun `an unobserved gap counts as neither driving nor rest`() {
        var state = DrivingHours.advance(DrivingHours.reset(), 60.0, nowMs = 0)
        state = driving(state, forMs = 4 * hour)

        // The app was closed for six hours. That is not six hours of driving,
        // and it is not a break either — it is unknown.
        val after = DrivingHours.advance(state, speedKph = 0.0, nowMs = state.atMs!! + 6 * hour)

        assertEquals(4 * hour, after.stintMs)
        assertEquals(4 * hour, after.todayMs)
    }

    @Test
    fun `a clock correction does not invent driving`() {
        var state = DrivingHours.advance(DrivingHours.reset(), 60.0, nowMs = 10 * hour)
        state = driving(state, forMs = hour)
        val before = state.stintMs

        val corrected = DrivingHours.advance(state, speedKph = 60.0, nowMs = state.atMs!! - hour)
        assertEquals(before, corrected.stintMs)
    }

    @Test
    fun `absent speed is treated as stopped, never as driving`() {
        var state = DrivingHours.advance(DrivingHours.reset(), null, nowMs = 0)
        state = DrivingHours.advance(state, speedKph = null, nowMs = 30 * minute)

        // A vehicle that is not reporting is not known to be moving, and
        // counting it as driving would inflate a fatigue figure.
        assertEquals(0, state.stintMs)
    }

    @Test
    fun `formats for a screen`() {
        assertEquals("45m", DrivingHours.format(45 * minute))
        assertEquals("4h 20m", DrivingHours.format(4 * hour + 20 * minute))
        assertEquals("0m", DrivingHours.format(0))
    }
}
