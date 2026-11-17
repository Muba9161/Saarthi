package com.saarthi.owner.ui.rides

import com.saarthi.owner.network.LiveRidesApi
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class LiveRideSummaryTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun ended(summary: String) = """
        {
            "riderName": "Rohit",
            "registrationNumber": "UP78DB8133",
            "status": "ENDED",
            "startedAt": "2026-11-16T09:22:00Z",
            "endedAt": "2026-11-16T10:03:00Z",
            "position": null,
            "trail": [],
            "summary": $summary
        }
    """.trimIndent()

    @Test
    fun `formatDuration formats minutes and hours properly`() {
        assertEquals("0 min", LiveRideSummaryHelper.formatDuration(0))
        assertEquals("41 min", LiveRideSummaryHelper.formatDuration(41))
        assertEquals("1h", LiveRideSummaryHelper.formatDuration(60))
        assertEquals("1h 15m", LiveRideSummaryHelper.formatDuration(75))
    }

    @Test
    fun `reads the summary the server recorded`() {
        val summary = json.decodeFromString<LiveRidesApi.LiveRide>(
            ended(
                """{ "distanceKm": 14.2, "durationMinutes": 41, "avgSpeedKph": 20.8, "maxSpeedKph": 52,
                    "startedAt": "2026-11-16T09:22:00Z", "endedAt": "2026-11-16T10:03:00Z" }""",
            ),
        ).summary!!
        assertEquals(14.2, summary.distanceKm!!, 0.01)
        assertEquals(41, summary.durationMinutes)
        assertEquals(20.8, summary.avgSpeedKph!!, 0.01)
        assertEquals(52.0, summary.maxSpeedKph!!, 0.01)
    }

    @Test
    fun `keeps a figure that was never recorded as absent, not zero`() {
        val summary = json.decodeFromString<LiveRidesApi.LiveRide>(
            ended(
                """{ "distanceKm": null, "durationMinutes": 41, "avgSpeedKph": null, "maxSpeedKph": null,
                    "startedAt": "2026-11-16T09:22:00Z", "endedAt": "2026-11-16T10:03:00Z" }""",
            ),
        ).summary!!
        assertNull(summary.distanceKm)
        assertNull(summary.avgSpeedKph)
        assertNull(summary.maxSpeedKph)
        assertEquals(41, summary.durationMinutes)
    }

    @Test
    fun `reads when the summary is removed, and shows none without a readable time`() {
        val timed = json.decodeFromString<LiveRidesApi.LiveRide>(
            ended("""{ "distanceKm": 3.1, "durationMinutes": 12, "shownUntil": "2026-11-16T10:08:00Z" }"""),
        ).summary!!
        assertEquals(Instant.parse("2026-11-16T10:08:00Z"), LiveRideSummaryHelper.shownUntil(timed))

        val untimed = LiveRidesApi.Summary(distanceKm = 3.1, durationMinutes = 12, shownUntil = "soon")
        assertNull(LiveRideSummaryHelper.shownUntil(untimed))
        assertNull(LiveRideSummaryHelper.shownUntil(LiveRidesApi.Summary()))
    }
}
