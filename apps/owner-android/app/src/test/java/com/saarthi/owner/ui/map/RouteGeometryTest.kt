package com.saarthi.owner.ui.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RouteGeometryTest {

    private val straight = listOf(19.0 to 73.0, 19.0 to 73.2)

    @Test
    fun `a two-point route splits where the vehicle stands, not at an end`() {
        val split = splitRoute(straight, latitude = 19.001, longitude = 73.05)!!

        assertEquals(19.0 to 73.0, split.behind.first())
        assertEquals(19.0 to 73.2, split.ahead.last())
        // Both halves meet on the route itself, a quarter of the way along.
        val (lat, lng) = split.behind.last()
        assertEquals(19.0, lat, 1e-9)
        assertEquals(73.05, lng, 1e-6)
        assertEquals(split.behind.last(), split.ahead.first())
    }

    @Test
    fun `the nearest segment wins on a route with a bend`() {
        val bend = listOf(19.0 to 73.0, 19.0 to 73.1, 19.1 to 73.1)

        val split = splitRoute(bend, latitude = 19.05, longitude = 73.101)!!

        assertEquals(listOf(19.0 to 73.0, 19.0 to 73.1), split.behind.dropLast(1))
        assertEquals(listOf(19.1 to 73.1), split.ahead.drop(1))
        assertEquals(19.05, split.behind.last().first, 1e-6)
    }

    @Test
    fun `a position past either end clamps to it`() {
        val before = splitRoute(straight, latitude = 19.0, longitude = 72.9)!!
        val after = splitRoute(straight, latitude = 19.0, longitude = 73.4)!!

        assertEquals(listOf(19.0 to 73.0, 19.0 to 73.0), before.behind)
        assertEquals(listOf(19.0 to 73.2, 19.0 to 73.2), after.ahead)
    }

    @Test
    fun `no usable segment gives no split`() {
        assertNull(splitRoute(emptyList(), 19.0, 73.0))
        assertNull(splitRoute(listOf(19.0 to 73.0), 19.0, 73.0))
        assertNull(splitRoute(listOf(19.0 to 73.0, 19.0 to 73.0), 19.0, 73.0))
    }

    @Test
    fun `fixes become runs that join where the colour changes`() {
        val fixes = listOf(
            Triple(1.0, 1.0, "ON_ROUTE"),
            Triple(2.0, 2.0, "ON_ROUTE"),
            Triple(3.0, 3.0, "OFF_ROUTE"),
            Triple(4.0, 4.0, "OFF_ROUTE"),
            Triple(5.0, 5.0, "ON_ROUTE"),
        )

        val runs = trailRuns(fixes, at = { it.first to it.second }, toneOf = { trailToneOf(it.third) })

        assertEquals(
            listOf(
                TrailRun(listOf(1.0 to 1.0, 2.0 to 2.0), TrailTone.ON_ROUTE),
                TrailRun(listOf(2.0 to 2.0, 3.0 to 3.0, 4.0 to 4.0), TrailTone.OFF_ROUTE),
                TrailRun(listOf(4.0 to 4.0, 5.0 to 5.0), TrailTone.ON_ROUTE),
            ),
            runs,
        )
    }

    @Test
    fun `a lone first fix still starts the next run, and an unknown state reads as no trip`() {
        val fixes = listOf(Triple(1.0, 1.0, "ALTERNATE"), Triple(2.0, 2.0, null), Triple(3.0, 3.0, "SOMETHING_NEW"))

        val runs = trailRuns(fixes, at = { it.first to it.second }, toneOf = { trailToneOf(it.third) })

        assertEquals(listOf(TrailRun(listOf(1.0 to 1.0, 2.0 to 2.0, 3.0 to 3.0), TrailTone.NO_TRIP)), runs)
    }

    @Test
    fun `nothing to draw from fewer than two fixes`() {
        assertEquals(emptyList<TrailRun>(), trailRuns(emptyList<Pair<Double, Double>>(), { it }, { TrailTone.ON_ROUTE }))
        assertEquals(emptyList<TrailRun>(), trailRuns(listOf(1.0 to 1.0), { it }, { TrailTone.ON_ROUTE }))
    }
}
