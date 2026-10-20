package com.saarthi.owner.ui.tracking

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.saarthi.owner.ui.map.MapVehicle
import com.saarthi.owner.ui.map.TrailRun
import com.saarthi.owner.ui.map.trailRuns
import com.saarthi.owner.ui.map.trailToneOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/**
 * Following one vehicle live, the same way whoever follows it — its owner, or
 * the person it is shared with: where it is, the trip it is on, the road it has
 * covered in the trail's colours, and what it measured last.
 */

/** The trip a followed vehicle is on, as its map marks it. */
@Immutable
data class FollowedTrip(
    val reference: String,
    val origin: String,
    val destination: String,
    val pickup: Pair<Double, Double>?,
    val drop: Pair<Double, Double>?,
    val route: List<Pair<Double, Double>>,
)

/** The figures the vehicle measured last; each null when it did not measure it. */
@Immutable
data class Readings(
    val recordedAt: String,
    val speedKph: Double? = null,
    val rpm: Double? = null,
    val engineLoad: Double? = null,
    val coolantTemperature: Double? = null,
    val fuelLevel: Double? = null,
    val batteryVoltage: Double? = null,
) {
    val any: Boolean get() = listOf(speedKph, rpm, engineLoad, coolantTemperature, fuelLevel, batteryVoltage).any { it != null }
}

/** One stored fix of the covered road, with the route state the server judged on it. */
@Immutable
data class Fix(val latitude: Double, val longitude: Double, val routeState: String?, val recordedAt: String)

/** One read of a followed vehicle. */
class FollowRead(
    val marker: MapVehicle?,
    val plate: String,
    val seenAt: String?,
    /** The trip the fixes belong to: when it changes, the road starts again. */
    val tripId: String?,
    val trip: FollowedTrip?,
    /** Fixes since the last one already held, or the whole road on a first read. */
    val fixes: List<Fix>,
    val readings: Readings?,
)

/** Where a followed vehicle's news comes from: the owner's own reads, or a share's. */
fun interface FollowSource {
    /** [since] is the time of the last fix already held; null asks for the whole road to draw. */
    suspend fun read(since: String?): FollowRead
}

/** What a followed vehicle's screens draw, kept current while they are open. */
@Immutable
data class Followed(
    val marker: MapVehicle?,
    val plate: String,
    val seenAt: String?,
    val trip: FollowedTrip?,
    val trail: List<TrailRun>,
    val readings: Readings?,
) {
    /** Nothing to put on a map: never reported, no road covered, no trip. */
    val empty: Boolean get() = marker == null && trail.isEmpty() && trip == null
}

private const val FOLLOW_MS = 10_000L

/** Fixes held before the older half is thinned, keeping the start of the road and all of its recent end. */
private const val MAX_FIXES = 3000

/**
 * Follow a vehicle: the whole road once, then only what is new every ten
 * seconds, starting the road again when the vehicle moves on to another trip.
 * A failed read keeps what is on screen; the next one tries again.
 */
@Composable
fun rememberFollowed(key: String, source: FollowSource): Followed? {
    var followed by remember(key) { mutableStateOf<Followed?>(null) }
    LaunchedEffect(key) {
        var fixes: List<Fix> = emptyList()
        var tripId: String? = null
        var held = false
        while (true) {
            var read = attempt { source.read(if (held) fixes.lastOrNull()?.recordedAt else null) }
            if (read != null && held && read.tripId != tripId) {
                // Another trip: its road from its own start, not appended to the last one's.
                read = attempt { source.read(null) }
                fixes = emptyList()
            }
            if (read != null) {
                fixes = if (held) merged(fixes, read.fixes) else read.fixes
                tripId = read.tripId
                held = true
                followed = Followed(
                    marker = read.marker,
                    plate = read.plate,
                    seenAt = read.seenAt,
                    trip = read.trip,
                    trail = trailRuns(fixes, at = { it.latitude to it.longitude }, toneOf = { trailToneOf(it.routeState) }),
                    readings = read.readings?.takeIf { it.any },
                )
            }
            delay(FOLLOW_MS)
        }
    }
    return followed
}

/** A read that fails is no read; being cancelled still cancels. */
internal suspend fun <T> attempt(read: suspend () -> T): T? = try {
    read()
} catch (failure: CancellationException) {
    throw failure
} catch (_: Exception) {
    null
}

/** The fixes held, with the newer of [fresh] after them; the server's ISO times sort as text. */
private fun merged(held: List<Fix>, fresh: List<Fix>): List<Fix> {
    val last = held.lastOrNull()?.recordedAt
    val all = held + fresh.filter { last == null || it.recordedAt > last }
    if (all.size <= MAX_FIXES) return all
    val half = all.size / 2
    return all.subList(0, half).filterIndexed { index, _ -> index % 2 == 0 } + all.subList(half, all.size)
}
