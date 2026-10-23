package com.saarthi.owner.ui.rides

import com.saarthi.owner.network.LiveRidesApi
import com.saarthi.owner.ui.map.MarkerState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

/** What a ride shared with family shows, and how its map names the rider. */
class LiveRidePhaseTest {

    private val now = Instant.parse("2026-10-23T10:00:00Z")

    private fun fix(recordedAt: String = "2026-10-23T09:59:30Z", speedKph: Double? = null) =
        LiveRidesApi.Position(latitude = 26.85, longitude = 80.95, speedKph = speedKph, recordedAt = recordedAt)

    private fun ride(status: String = LiveRidesApi.SHARING, position: LiveRidesApi.Position? = null, endedAt: String? = null) =
        LiveRidesApi.LiveRide(riderName = "Neha", registrationNumber = "UP32AB1234", status = status, endedAt = endedAt, position = position)

    @Test
    fun `sharing with no position yet waits for the first fix`() {
        assertEquals(LivePhase.WAITING, ride().phase())
    }

    @Test
    fun `sharing with a position is live`() {
        assertEquals(LivePhase.LIVE, ride(position = fix()).phase())
    }

    @Test
    fun `an ended ride is ended, and never shows a position`() {
        assertEquals(LivePhase.ENDED, ride(status = LiveRidesApi.ENDED).phase())
        assertEquals(LivePhase.ENDED, ride(status = LiveRidesApi.ENDED, position = fix()).phase())
        assertEquals(LivePhase.ENDED, ride(position = fix(), endedAt = "2026-10-23T09:00:00Z").phase())
        assertNull(ride(status = LiveRidesApi.ENDED, position = fix()).mapMarker(now))
    }

    @Test
    fun `the label names the rider, then the vehicle's number as painted`() {
        assertEquals("Neha · UP 32 AB 1234", liveRideLabel("Neha", "UP32AB1234"))
        assertEquals("Neha", liveRideLabel(" Neha Verma ", null))
        assertEquals("Neha", liveRideLabel("Neha", "  "))
        assertEquals("UP 32 AB 1234", liveRideLabel("", "UP32AB1234"))
    }

    @Test
    fun `the rider's disc moves, stops and goes grey by the owner's rule`() {
        assertEquals(MarkerState.MOVING, ride(position = fix(speedKph = 42.0)).mapMarker(now)?.state)
        assertEquals(MarkerState.IDLE, ride(position = fix(speedKph = 0.0)).mapMarker(now)?.state)
        assertEquals(MarkerState.OFFLINE, ride(position = fix(recordedAt = "2026-10-23T09:30:00Z", speedKph = 42.0)).mapMarker(now)?.state)
        assertEquals("Neha · UP 32 AB 1234", ride(position = fix()).mapMarker(now)?.label)
    }

    @Test
    fun `no position means no disc`() {
        assertNull(ride().mapMarker(now))
    }
}
