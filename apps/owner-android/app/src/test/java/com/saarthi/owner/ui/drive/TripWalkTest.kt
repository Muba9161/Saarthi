package com.saarthi.owner.ui.drive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The driver's buttons walked through the trip machine, one real step at a time. */
class TripWalkTest {

    @Test
    fun `start walks a draft through assigned`() {
        assertEquals(listOf("ASSIGNED", "STARTED"), TripWalk.path("DRAFT", "STARTED"))
        assertEquals(listOf("STARTED"), TripWalk.path("LOADING", "STARTED"))
    }

    @Test
    fun `arrived goes through in transit, the way the server's own walk does`() {
        assertEquals(listOf("IN_TRANSIT", "ARRIVED"), TripWalk.path("STARTED", "ARRIVED"))
        assertEquals(listOf("ARRIVED"), TripWalk.path("DELAYED", "ARRIVED"))
        assertEquals(listOf("IN_TRANSIT", "ARRIVED"), TripWalk.path("SUSPENDED", "ARRIVED"))
    }

    @Test
    fun `complete from the road arrives first`() {
        assertEquals(listOf("ARRIVED", "COMPLETED"), TripWalk.path("IN_TRANSIT", "COMPLETED"))
        assertEquals(listOf("COMPLETED"), TripWalk.path("UNLOADING", "COMPLETED"))
        assertEquals(emptyList<String>(), TripWalk.path("COMPLETED", "COMPLETED"))
    }

    @Test
    fun `there is no way back from an ended trip`() {
        assertNull(TripWalk.path("COMPLETED", "STARTED"))
        assertNull(TripWalk.path("CANCELLED", "ARRIVED"))
    }

    @Test
    fun `a trip ended short says how far short, and one ended at the gate says nothing`() {
        val kanpur = 26.45 to 80.35
        assertEquals(
            "Ended early by the driver, 22.2 km short of Kanpur.",
            TripWalk.endedEarlyNote(26.25 to 80.35, kanpur, "Kanpur"),
        )
        assertNull(TripWalk.endedEarlyNote(26.4505 to 80.3505, kanpur, "Kanpur"))
        assertNull(TripWalk.endedEarlyNote(null, kanpur, "Kanpur"))
    }
}
