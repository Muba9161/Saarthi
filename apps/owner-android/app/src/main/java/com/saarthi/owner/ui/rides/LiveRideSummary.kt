package com.saarthi.owner.ui.rides

import com.saarthi.owner.network.LiveRidesApi
import java.time.Instant

/** Formatting and timing for the summary an ended live ride shows. */
object LiveRideSummaryHelper {

    fun formatDuration(minutes: Int): String {
        if (minutes < 60) return "$minutes min"
        val hours = minutes / 60
        val rest = minutes % 60
        return if (rest == 0) "${hours}h" else "${hours}h ${rest}m"
    }

    /**
     * When the summary is removed, or null when the server gave no time it
     * could be read as — in which case it is not shown at all, rather than
     * kept on screen for good.
     */
    fun shownUntil(summary: LiveRidesApi.Summary): Instant? =
        summary.shownUntil?.let { runCatching { Instant.parse(it) }.getOrNull() }
}
