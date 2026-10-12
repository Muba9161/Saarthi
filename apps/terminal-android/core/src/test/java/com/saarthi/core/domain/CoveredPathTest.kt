package com.saarthi.core.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The trail colour judged on the phone, which must agree with
 * `packages/shared/src/domain/route-trail.ts` on the server.
 */
class CoveredPathTest {

    @Test
    fun `amber and red both count as off the planned road`() {
        assertTrue(RouteState.ALTERNATE.offRoute)
        assertTrue(RouteState.OFF_ROUTE.offRoute)
        assertFalse(RouteState.ON_ROUTE.offRoute)
        assertFalse(RouteState.NO_TRIP.offRoute)
    }

    @Test
    fun `reads a state this build has not met as the neutral colour`() {
        assertEquals(RouteState.ALTERNATE, RouteState.parse("ALTERNATE"))
        assertEquals(RouteState.NO_TRIP, RouteState.parse("SOMETHING_NEW"))
    }

    @Test
    fun `gives the driver the benefit of the doubt with nothing to compare`() {
        assertTrue(RouteTrail.stillHeadingThere(null, 12_000.0))
    }

    @Test
    fun `allows a bend, but not driving away`() {
        assertTrue(RouteTrail.stillHeadingThere(10_000.0, 10_000.0 + RouteTrail.ALTERNATE_AWAY_METRES))
        assertFalse(RouteTrail.stillHeadingThere(10_000.0, 10_000.0 + RouteTrail.ALTERNATE_AWAY_METRES + 1))
    }
}
