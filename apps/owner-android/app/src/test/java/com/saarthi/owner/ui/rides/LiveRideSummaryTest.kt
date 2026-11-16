package com.saarthi.owner.ui.rides

import com.saarthi.owner.network.LiveRidesApi
import com.saarthi.owner.ui.tracking.Fix
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveRideSummaryTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `resolves server summary directly when present`() {
        val serverSummary = LiveRidesApi.Summary(
            distanceKm = 14.2,
            durationMinutes = 41,
            avgSpeedKph = 20.8,
            maxSpeedKph = 52.0,
            startedAt = "2026-11-16T09:22:00Z",
            endedAt = "2026-11-16T10:03:00Z",
            startPoint = LiveRidesApi.SummaryPoint(26.4815, 80.2900),
            endPoint = LiveRidesApi.SummaryPoint(26.4815, 80.2661),
        )

        val ride = LiveRidesApi.LiveRide(
            riderName = "Rohit",
            status = LiveRidesApi.ENDED,
            startedAt = "2026-11-16T09:22:00Z",
            endedAt = "2026-11-16T10:03:00Z",
            summary = serverSummary,
        )

        val resolved = LiveRideSummaryHelper.resolveRideSummary(ride, emptyList())
        assertEquals(14.2, resolved.distanceKm, 0.01)
        assertEquals(41, resolved.durationMinutes)
        assertEquals(20.8, resolved.avgSpeedKph, 0.01)
        assertEquals(52.0, resolved.maxSpeedKph, 0.01)
        assertEquals(26.4815, resolved.startPoint?.latitude ?: 0.0, 0.0001)
        assertEquals(80.2661, resolved.endPoint?.longitude ?: 0.0, 0.0001)
    }

    @Test
    fun `computes fallback summary from GPS fixes when server summary is missing`() {
        val ride = LiveRidesApi.LiveRide(
            riderName = "Rohit",
            status = LiveRidesApi.ENDED,
            startedAt = "2026-11-16T09:22:00Z",
            endedAt = "2026-11-16T10:03:00Z",
            summary = null,
        )

        val fixes = listOf(
            Fix(latitude = 26.4815, longitude = 80.2900, routeState = null, recordedAt = "2026-11-16T09:22:00Z"),
            Fix(latitude = 26.4815, longitude = 80.2800, routeState = null, recordedAt = "2026-11-16T09:30:00Z"),
            Fix(latitude = 26.4815, longitude = 80.2661, routeState = null, recordedAt = "2026-11-16T10:03:00Z"),
        )

        val resolved = LiveRideSummaryHelper.resolveRideSummary(ride, fixes)
        assertTrue(resolved.distanceKm > 2.0)
        assertEquals(41, resolved.durationMinutes)
        assertTrue(resolved.avgSpeedKph > 0.0)
        assertNotNull(resolved.startPoint)
        assertEquals(26.4815, resolved.startPoint?.latitude ?: 0.0, 0.0001)
        assertEquals(80.2661, resolved.endPoint?.longitude ?: 0.0, 0.0001)
    }

    @Test
    fun `formatDuration formats minutes and hours properly`() {
        assertEquals("41 min", LiveRideSummaryHelper.formatDuration(41))
        assertEquals("1 min", LiveRideSummaryHelper.formatDuration(1))
        assertEquals("1h", LiveRideSummaryHelper.formatDuration(60))
        assertEquals("1h 15m", LiveRideSummaryHelper.formatDuration(75))
        assertEquals("2h 30m", LiveRideSummaryHelper.formatDuration(150))
    }

    @Test
    fun `deserializes summary from json payload`() {
        val rawJson = """
            {
                "riderName": "Rohit",
                "registrationNumber": "UP-78-DB-8133",
                "status": "ENDED",
                "startedAt": "2026-11-16T09:22:00Z",
                "endedAt": "2026-11-16T10:03:00Z",
                "position": null,
                "trail": [],
                "summary": {
                    "distanceKm": 14.2,
                    "durationMinutes": 41,
                    "avgSpeedKph": 20.8,
                    "maxSpeedKph": 52.0,
                    "startedAt": "2026-11-16T09:22:00Z",
                    "endedAt": "2026-11-16T10:03:00Z",
                    "startPoint": { "latitude": 26.4815, "longitude": 80.2900 },
                    "endPoint": { "latitude": 26.4815, "longitude": 80.2661 }
                }
            }
        """.trimIndent()

        val decoded = json.decodeFromString<LiveRidesApi.LiveRide>(rawJson)
        assertEquals("Rohit", decoded.riderName)
        assertEquals("UP-78-DB-8133", decoded.registrationNumber)
        assertEquals("ENDED", decoded.status)
        assertNotNull(decoded.summary)
        assertEquals(14.2, decoded.summary?.distanceKm ?: 0.0, 0.01)
        assertEquals(41, decoded.summary?.durationMinutes ?: 0)
        assertEquals(20.8, decoded.summary?.avgSpeedKph ?: 0.0, 0.01)
        assertEquals(52.0, decoded.summary?.maxSpeedKph ?: 0.0, 0.01)
    }
}
