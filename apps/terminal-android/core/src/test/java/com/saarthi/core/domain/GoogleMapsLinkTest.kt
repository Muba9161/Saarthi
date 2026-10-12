package com.saarthi.core.domain

import com.saarthi.core.network.RoutePointDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** The link that hands a journey to Google Maps. */
class GoogleMapsLinkTest {

    @Test
    fun `navigates straight to the destination by road`() {
        assertEquals(
            "https://www.google.com/maps/dir/?api=1&destination=26.882600,81.030600" +
                "&travelmode=driving&dir_action=navigate",
            GoogleMapsLink.navigate(26.8826, 81.0306),
        )
    }

    @Test
    fun `writes coordinates the same on a phone set to Hindi or Bengali`() {
        val before = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("bn-IN"))
            assertTrue(GoogleMapsLink.navigate(26.8826, 81.0306).contains("destination=26.882600,81.030600"))
        } finally {
            Locale.setDefault(before)
        }
    }

    @Test
    fun `passes through stops on the way, at most three`() {
        val via = List(5) { RoutePointDto(26.85 + it / 100.0, 80.95) }
        val link = GoogleMapsLink.navigate(26.8826, 81.0306, via)
        val stops = java.net.URLDecoder.decode(link.substringAfter("&waypoints="), "UTF-8").split("|")
        assertEquals(listOf("26.850000,80.950000", "26.860000,80.950000", "26.870000,80.950000"), stops)
    }

    @Test
    fun `spreads the stops along the planned road by distance`() {
        // Eleven equal steps north: a quarter, half and three quarters fall on points 3, 6 and 9.
        val road = (0..11).map { RoutePointDto(26.80 + it * 0.01, 81.00) }
        assertEquals(listOf(road[3], road[6], road[9]), GoogleMapsLink.viaPoints(road))
    }

    @Test
    fun `weighs the stops by distance, not by how many points each stretch has`() {
        // A dense first kilometre and a sparse rest: the stops still land on the long stretch.
        val dense = (0..20).map { RoutePointDto(26.80 + it * 0.0005, 81.00) }
        val sparse = (1..9).map { RoutePointDto(26.81 + it * 0.01, 81.00) }
        val via = GoogleMapsLink.viaPoints(dense + sparse)
        assertTrue(via.all { it.latitude > 26.81 })
    }

    @Test
    fun `sends no stops for a trip drawn as a straight line`() {
        assertTrue(GoogleMapsLink.viaPoints(listOf(RoutePointDto(26.8, 80.9), RoutePointDto(26.9, 81.0))).isEmpty())
    }
}
