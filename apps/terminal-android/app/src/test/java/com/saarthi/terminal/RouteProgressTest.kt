package com.saarthi.terminal

import com.saarthi.terminal.domain.RouteFollower
import com.saarthi.terminal.domain.RoutePath
import com.saarthi.terminal.network.RouteDestinationDto
import com.saarthi.terminal.network.RouteDto
import com.saarthi.terminal.network.RoutePointDto
import com.saarthi.terminal.network.RouteStepDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The route follower, against the situations that used to get it wrong.
 *
 * Every case here is a real failure the previous "nearest manoeuvre point"
 * approach produced in a cab, not a synthetic edge case: an instruction that
 * kept pointing at a junction already passed, a distance that counted upwards, a
 * route that never noticed the driver had left it, and a destination that was
 * reached without anything on screen changing.
 */
class RouteProgressTest {

    /**
     * A route heading due east along a line of latitude.
     *
     * East-west rather than north-south on purpose: longitude degrees shrink
     * with latitude, so this exercises the projection's cosine correction. A bug
     * there would pass a north-south test and fail on every real road.
     */
    private fun straightRoute(
        points: Int = 21,
        spacingDegrees: Double = 0.001,
        steps: List<RouteStepDto> = emptyList(),
    ): RouteDto {
        val geometry = (0 until points).map { index ->
            RoutePointDto(latitude = 12.9716, longitude = 77.5946 + index * spacingDegrees)
        }
        return RouteDto(
            distanceKm = 2.2,
            durationMinutes = 6,
            summary = "Test Road",
            geometry = geometry,
            steps = steps,
            destination = RouteDestinationDto(
                name = "Test destination",
                latitude = geometry.last().latitude,
                longitude = geometry.last().longitude,
            ),
            etaAt = "2026-09-03T10:00:00Z",
        )
    }

    private fun step(
        longitudeOffset: Double,
        instruction: String,
        maneuver: String = "turn",
    ) = RouteStepDto(
        name = instruction,
        instruction = instruction,
        maneuver = maneuver,
        latitude = 12.9716,
        longitude = 77.5946 + longitudeOffset,
    )

    // -----------------------------------------------------------------------
    // Progress along the line
    // -----------------------------------------------------------------------

    @Test
    fun `the vehicle at the start has covered nothing`() {
        val path = RoutePath.of(straightRoute())!!
        val fix = path.locate(12.9716, 77.5946)

        assertEquals(0.0, fix.alongMetres, 1.0)
        assertTrue("should be on the line", fix.offRouteMetres < 1.0)
    }

    @Test
    fun `progress is measured along the road, not through the air`() {
        // An L-shaped route: east, then north. A vehicle at the corner has
        // covered the whole first leg, even though it is much closer to the
        // destination in a straight line than that distance suggests.
        val corner = RoutePointDto(12.9716, 77.6046)
        val route = RouteDto(
            distanceKm = 2.2,
            durationMinutes = 6,
            geometry = listOf(
                RoutePointDto(12.9716, 77.5946),
                corner,
                RoutePointDto(12.9816, 77.6046),
            ),
            destination = RouteDestinationDto("End", 12.9816, 77.6046),
            etaAt = "2026-09-03T10:00:00Z",
        )

        val path = RoutePath.of(route)!!
        val atCorner = path.locate(corner.latitude, corner.longitude)

        // ~1.085 km east at this latitude.
        assertEquals(1_085.0, atCorner.alongMetres, 40.0)
    }

    // -----------------------------------------------------------------------
    // The next manoeuvre
    // -----------------------------------------------------------------------

    @Test
    fun `a manoeuvre already passed is not offered again`() {
        val route = straightRoute(
            steps = listOf(
                step(0.002, "Turn left onto First Road"),
                step(0.016, "Turn right onto Second Road"),
            ),
        )
        val path = RoutePath.of(route)!!

        // Sitting just past the first junction. Under the old nearest-point
        // rule this returned "Turn left onto First Road" — the junction behind
        // the cab — for several hundred metres, with its distance counting up.
        val justPast = path.locate(12.9716, 77.5946 + 0.003)
        val next = path.nextStep(justPast.alongMetres)

        assertNotNull(next)
        assertEquals("Turn right onto Second Road", next!!.step.instruction)
    }

    @Test
    fun `the manoeuvre being driven through is still the next one`() {
        val route = straightRoute(
            steps = listOf(
                step(0.002, "Turn left onto First Road"),
                step(0.016, "Turn right onto Second Road"),
            ),
        )
        val path = RoutePath.of(route)!!

        // A metre or two past the manoeuvre point, which is where a fix taken
        // mid-junction lands. Dropping the instruction here is exactly when the
        // driver is looking up at it.
        val midTurn = path.locate(12.9716, 77.5946 + 0.00201)
        assertEquals(
            "Turn left onto First Road",
            path.nextStep(midTurn.alongMetres)!!.step.instruction,
        )
    }

    @Test
    fun `departing is never offered as an instruction`() {
        val route = straightRoute(
            steps = listOf(
                step(0.0, "Head east on Test Road", maneuver = "depart"),
                step(0.010, "Turn left onto First Road"),
            ),
        )
        val path = RoutePath.of(route)!!

        assertEquals(1, path.steps.size)
        assertEquals("Turn left onto First Road", path.steps.first().step.instruction)
    }

    // -----------------------------------------------------------------------
    // Leaving the route
    // -----------------------------------------------------------------------

    @Test
    fun `one bad fix does not count as leaving the route`() {
        val follower = RouteFollower(straightRoute())

        // A single multipath fix a few hundred metres off the line. In a city
        // this happens several times a minute, and re-routing on it would burn
        // the fleet's routing budget and replace a correct instruction with a
        // wrong one.
        val stray = follower.update(12.9756, 77.5966)!!

        assertTrue("should be measurably off the line", stray.offRouteMetres > 100)
        assertFalse("but not yet believed", stray.offRoute)
    }

    @Test
    fun `sustained divergence is treated as leaving the route`() {
        val follower = RouteFollower(straightRoute())

        var last = follower.update(12.9756, 77.5966)!!
        assertFalse(last.offRoute)
        last = follower.update(12.9757, 77.5968)!!
        assertFalse(last.offRoute)
        last = follower.update(12.9758, 77.5970)!!

        assertTrue("three consecutive fixes off the line", last.offRoute)
    }

    @Test
    fun `rejoining the route clears the off-route state immediately`() {
        val follower = RouteFollower(straightRoute())

        repeat(3) { index -> follower.update(12.9756 + index * 0.0001, 77.5966) }
        val back = follower.update(12.9716, 77.5966)!!

        assertFalse("a driver back on the route is not still off it", back.offRoute)
    }

    // -----------------------------------------------------------------------
    // Arrival
    // -----------------------------------------------------------------------

    @Test
    fun `reaching the destination is detected`() {
        val route = straightRoute()
        val follower = RouteFollower(route)

        follower.update(12.9716, 77.5946)
        val arrived = follower.update(
            route.destination.latitude,
            route.destination.longitude,
        )!!

        assertTrue(arrived.arrived)
        assertEquals(0, arrived.remainingMetres.coerceAtMost(30))
    }

    @Test
    fun `parking near a destination pin counts as arriving`() {
        // A pump mapped in the middle of a forecourt, with the truck stopped at
        // the entrance ~40 m short. The route's own end is not reached, and the
        // driver has plainly arrived.
        val route = straightRoute()
        val follower = RouteFollower(route)

        follower.update(12.9716, 77.5946)
        val nearby = follower.update(
            route.destination.latitude + 0.00036,
            route.destination.longitude,
        )!!

        assertTrue(nearby.arrived)
    }

    @Test
    fun `a journey under way has not arrived`() {
        val follower = RouteFollower(straightRoute())
        val underWay = follower.update(12.9716, 77.5966)!!

        assertFalse(underWay.arrived)
        assertTrue(underWay.remainingMetres > 100)
    }

    // -----------------------------------------------------------------------
    // What is left
    // -----------------------------------------------------------------------

    @Test
    fun `remaining distance falls as the vehicle moves`() {
        val follower = RouteFollower(straightRoute())

        val start = follower.update(12.9716, 77.5946)!!
        val later = follower.update(12.9716, 77.5966)!!

        assertTrue(
            "remaining should fall: ${start.remainingMetres} -> ${later.remainingMetres}",
            later.remainingMetres < start.remainingMetres,
        )
        assertTrue(later.fraction > start.fraction)
    }

    @Test
    fun `progress does not rewind on a noisy fix`() {
        val follower = RouteFollower(straightRoute())

        follower.update(12.9716, 77.5966)
        val forward = follower.update(12.9716, 77.5968)!!
        // A fix that projects slightly back down the line — routine where two
        // segments run close together. The distance to the next turn must not
        // start counting up.
        val noisy = follower.update(12.9716, 77.59679)!!

        assertTrue(noisy.remainingMetres <= forward.remainingMetres)
    }

    @Test
    fun `a route with no usable geometry reports nothing rather than guessing`() {
        val degenerate = RouteDto(
            distanceKm = 1.0,
            durationMinutes = 3,
            geometry = listOf(RoutePointDto(12.9716, 77.5946)),
            destination = RouteDestinationDto("Somewhere", 12.98, 77.60),
            etaAt = "2026-09-03T10:00:00Z",
        )

        assertEquals(null, RoutePath.of(degenerate))
        assertEquals(null, RouteFollower(degenerate).update(12.9716, 77.5946))
    }
}
