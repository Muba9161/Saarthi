package com.saarthi.owner.ui.tracking

import com.saarthi.owner.ui.map.MarkerState
import com.saarthi.owner.ui.map.OverlayInk
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

/** Where a no-trip road starts, and how a vehicle's disc is coloured — both as the web's map does it. */
class FollowWindowTest {

    private val india = ZoneId.of("Asia/Kolkata")

    @Test
    fun `in the evening the road starts at midnight`() {
        // 18:30 IST: midnight is earlier than twelve hours back.
        val now = Instant.parse("2026-10-20T13:00:00Z")
        assertEquals("2026-10-19T18:30:00Z", dayStart(now, india))
    }

    @Test
    fun `just after midnight the road still reaches back twelve hours`() {
        // 01:00 IST: twelve hours back is earlier than midnight.
        val now = Instant.parse("2026-10-19T19:30:00Z")
        assertEquals("2026-10-19T07:30:00Z", dayStart(now, india))
    }

    @Test
    fun `a disc takes its status colour, and grey once the vehicle stops reporting`() {
        assertEquals(0xFF1D4ED8.toInt(), OverlayInk.vehicle(MarkerState.MOVING, "ON_TRIP"))
        assertEquals(0xFF15803D.toInt(), OverlayInk.vehicle(MarkerState.IDLE, "AVAILABLE"))
        assertEquals(0xFFB45309.toInt(), OverlayInk.vehicle(MarkerState.IDLE, "MAINTENANCE"))
        assertEquals(0xFF94A3B8.toInt(), OverlayInk.vehicle(MarkerState.OFFLINE, "ON_TRIP"))
        assertEquals(0xFFB91C1C.toInt(), OverlayInk.vehicle(MarkerState.ALERT, "AVAILABLE"))
        // A status the web does not name, and no status at all.
        assertEquals(0xFF334155.toInt(), OverlayInk.vehicle(MarkerState.IDLE, "SOMETHING_NEW"))
        assertEquals(0xFF64748B.toInt(), OverlayInk.vehicle(MarkerState.IDLE, null))
    }
}
