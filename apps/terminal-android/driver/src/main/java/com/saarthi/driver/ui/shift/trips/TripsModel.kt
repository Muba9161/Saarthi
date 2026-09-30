package com.saarthi.driver.ui.shift.trips

import com.saarthi.core.network.DriverTripDto
import com.saarthi.core.network.TerminalTripDto

/**
 * Statuses that mean a vehicle has set off and not yet finished.
 *
 * The server's own list (`UNDERWAY_TRIP_STATUSES` in `dispatch.service.ts`),
 * so this screen and the fleet agree on what "under way" is.
 */
private val UnderwayStatuses = setOf("STARTED", "IN_TRANSIT", "DELAYED", "EMERGENCY", "ARRIVED", "UNLOADING")

/** The one status that means a trip is done. Cancelled and drafted trips are not finished trips. */
private const val FINISHED_STATUS = "COMPLETED"

/** How many recent trips the summary's bars draw — the design's six columns. */
private const val SUMMARY_BARS = 6

/**
 * The trip on the road now, pieced together from what the server has said.
 *
 * Every field is nullable because each can genuinely be unknown — a trip the
 * driver started without a dispatch has no destination — and the card drops
 * what it does not have rather than filling it in.
 */
internal data class OpenTrip(
    val reference: String?,
    val origin: String?,
    val destination: String?,
    val plannedKm: Double?,
    val startedAt: String?,
    val registration: String?,
)

/**
 * Everything the Trips tab draws, worked out once from the server's answers.
 *
 * [bars] always has the design's six slots, oldest trip first and newest last;
 * a null slot is an empty column, so the newest trip sits at the right-hand end
 * however few there are. Each value is a fraction of the longest of them.
 */
internal data class TripsBoard(
    val open: OpenTrip?,
    val finished: List<DriverTripDto>,
    /** Distance Saarthi measured across the finished trips; null when it measured none. */
    val measuredKm: Double?,
    val measuredCount: Int,
    val bars: List<Float?>,
) {
    val isEmpty: Boolean get() = open == null && finished.isEmpty()
}

/**
 * Sort the driver's trips into the one under way and the ones finished.
 *
 * The trip under way exists only while the server says [active]; its details
 * come from the fleet's dispatch first and the driver's own trip record second.
 * The summary counts measured distances only — a planned figure is a promise,
 * not kilometres driven, so it never reaches the total.
 */
internal fun tripsBoard(
    trips: List<DriverTripDto>,
    active: Boolean,
    dispatch: TerminalTripDto?,
    sessionStartedAt: String?,
    registration: String?,
): TripsBoard {
    val record = when {
        !active -> null
        dispatch != null -> trips.firstOrNull { it.id == dispatch.id }
        else -> trips.firstOrNull { it.status in UnderwayStatuses }
    }
    val open = if (active) {
        OpenTrip(
            reference = dispatch?.reference?.ifBlank { null } ?: record?.reference?.ifBlank { null },
            origin = dispatch?.originAddress?.ifBlank { null } ?: record?.fromLabel?.ifBlank { null },
            destination = dispatch?.destinationAddress?.ifBlank { null } ?: record?.toLabel?.ifBlank { null },
            plannedKm = dispatch?.plannedDistanceKm ?: record?.takeIf { it.distanceIsPlanned }?.distanceKm,
            startedAt = record?.startedAt ?: sessionStartedAt,
            registration = registration ?: record?.registrationNumber,
        )
    } else {
        null
    }

    val finished = trips.filter { it.status == FINISHED_STATUS && it.id != record?.id }
    val measured = finished.mapNotNull { trip -> trip.distanceKm?.takeUnless { trip.distanceIsPlanned } }
    // The list arrives newest first; the bars read left to right, oldest to newest.
    val recent = measured.take(SUMMARY_BARS).reversed()
    val longest = recent.maxOrNull()?.takeIf { it > 0.0 }
    val bars = List<Float?>(SUMMARY_BARS - recent.size) { null } +
        recent.map { km -> longest?.let { (km / it).toFloat() } ?: 0f }

    return TripsBoard(
        open = open,
        finished = finished,
        measuredKm = if (measured.isEmpty()) null else measured.sum(),
        measuredCount = measured.size,
        bars = bars,
    )
}
