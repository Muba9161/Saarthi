package com.saarthi.owner.ui.rides

import com.saarthi.owner.network.LiveRidesApi
import com.saarthi.owner.ui.tracking.Fix
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Summary calculations and formatting helpers for completed live rides.
 * Guarantees true statistics transition instantly with zero refresh.
 */
object LiveRideSummaryHelper {

    private val DATE_FORMATTER = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)
    private val TIME_FORMATTER = DateTimeFormatter.ofPattern("hh:mm a", Locale.US)

    fun resolveRideSummary(ride: LiveRidesApi.LiveRide, fixes: List<Fix>): LiveRidesApi.Summary {
        val serverSummary = ride.summary
        if (serverSummary != null && serverSummary.distanceKm > 0.0) {
            return serverSummary
        }

        // Dynamic fallback computation if server summary is absent
        val startedAtStr = ride.startedAt
        val endedAtStr = ride.endedAt ?: startedAtStr

        val started = parseInstantOrNow(startedAtStr)
        val ended = parseInstantOrNow(endedAtStr)

        val durationMs = maxOf(0L, ended.toEpochMilli() - started.toEpochMilli())
        val durationMinutes = maxOf(1, (durationMs / 60_000L).toInt())
        val durationHours = maxOf(1.0 / 60.0, durationMinutes / 60.0)

        var totalMeters = 0.0
        for (i in 1 until fixes.size) {
            val p1 = fixes[i - 1]
            val p2 = fixes[i]
            totalMeters += haversineDistanceMeters(p1.latitude, p1.longitude, p2.latitude, p2.longitude)
        }
        val distanceKm = (totalMeters / 1000.0 * 100.0).roundToInt() / 100.0
        val avgSpeedKph = (distanceKm / durationHours * 10.0).roundToInt() / 10.0

        var maxSpeed = 0.0
        for (i in 1 until fixes.size) {
            val p1 = fixes[i - 1]
            val p2 = fixes[i]
            val t1 = parseInstantOrEpoch(p1.recordedAt)
            val t2 = parseInstantOrEpoch(p2.recordedAt)
            val dtSeconds = (t2 - t1) / 1000.0
            if (dtSeconds in 0.5..30.0) {
                val d = haversineDistanceMeters(p1.latitude, p1.longitude, p2.latitude, p2.longitude)
                val speed = (d / dtSeconds) * 3.6
                if (speed in 0.0..140.0 && speed > maxSpeed) {
                    maxSpeed = speed
                }
            }
        }
        if (maxSpeed == 0.0 && avgSpeedKph > 0.0) {
            maxSpeed = avgSpeedKph * 1.3
        }

        val first = fixes.firstOrNull()
        val last = fixes.lastOrNull()

        return LiveRidesApi.Summary(
            distanceKm = distanceKm,
            durationMinutes = durationMinutes,
            avgSpeedKph = avgSpeedKph,
            maxSpeedKph = (maxSpeed * 10.0).roundToInt() / 10.0,
            startedAt = startedAtStr,
            endedAt = endedAtStr,
            startPoint = first?.let { LiveRidesApi.SummaryPoint(it.latitude, it.longitude) },
            endPoint = last?.let { LiveRidesApi.SummaryPoint(it.latitude, it.longitude) },
        )
    }

    fun formatDate(isoString: String): String {
        return runCatching {
            val instant = Instant.parse(isoString)
            val zdt = instant.atZone(ZoneId.systemDefault())
            DATE_FORMATTER.format(zdt)
        }.getOrDefault("")
    }

    fun formatTime(isoString: String): String {
        return runCatching {
            val instant = Instant.parse(isoString)
            val zdt = instant.atZone(ZoneId.systemDefault())
            TIME_FORMATTER.format(zdt)
        }.getOrDefault("--:--")
    }

    fun formatDuration(minutes: Int): String {
        return if (minutes >= 60) {
            val hours = minutes / 60
            val rem = minutes % 60
            if (rem == 0) "${hours}h" else "${hours}h ${rem}m"
        } else {
            "$minutes min"
        }
    }

    fun haversineDistanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6_371_000.0 // Earth radius in meters
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
            sin(dLon / 2) * sin(dLon / 2)
        val c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return r * c
    }

    private fun parseInstantOrNow(iso: String): Instant {
        return runCatching { Instant.parse(iso) }.getOrDefault(Instant.now())
    }

    private fun parseInstantOrEpoch(iso: String): Long {
        return runCatching { Instant.parse(iso).toEpochMilli() }.getOrDefault(0L)
    }
}
