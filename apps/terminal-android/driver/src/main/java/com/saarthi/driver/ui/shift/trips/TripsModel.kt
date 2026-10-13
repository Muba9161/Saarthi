package com.saarthi.driver.ui.shift.trips

import com.saarthi.core.network.DriverTripDto
import com.saarthi.core.network.TerminalTripDto
import com.saarthi.core.network.TripQueueDto

/**
 * Statuses that mean a vehicle has set off and not yet finished.
 *
 * The server's own list (`UNDERWAY_TRIP_STATUSES` in `dispatch.service.ts`),
 * so this screen and the fleet agree on what "under way" is.
 */
private val UnderwayStatuses = setOf("STARTED", "IN_TRANSIT", "DELAYED", "EMERGENCY", "ARRIVED", "UNLOADING")

/** The one status that means a trip is done. Cancelled and drafted trips are not finished trips. */
private const val FINISHED_STATUS = "COMPLETED"

/** A driver's trip waiting for the vehicle to be free. */
private const val QUEUED_STATUS = "DRAFT"

/** How many recent trips the summary's bars draw — the design's six columns. */
private const val SUMMARY_BARS = 6

/** Where a trip stands, as the card labels it. */
internal enum class TripStage {
    /** On the road now. */
    UNDER_WAY,
    /** Holds the vehicle and has not started: it is the next thing to drive. */
    UP_NEXT,
    /** A trip the driver added while another held the vehicle; it starts after. */
    QUEUED,
}

/**
 * A trip that is not finished, pieced together from what the server has said.
 *
 * Every field is nullable because each can genuinely be unknown — a trip the
 * driver started without a dispatch has no destination — and the card drops
 * what it does not have rather than filling it in.
 */
internal data class OpenTrip(
    val id: String?,
    val reference: String?,
    val origin: String?,
    val destination: String?,
    val plannedKm: Double?,
    val startedAt: String?,
    val registration: String?,
    val stage: TripStage,
    /**
     * The fleet dispatched it, rather than the driver adding it.
     *
     * A fleet trip always comes first — the server queues a driver's trip
     * behind it — and the card says so, so a driver never wonders which of two
     * trips to drive.
     */
    val fromFleet: Boolean,
    /** Its place in the driver's own order, from 1 — null for a trip outside it. */
    val position: Int? = null,
)

/**
 * Everything the Trips tab draws, worked out once from the server's answers.
 *
 * [bars] always has the design's six slots, oldest trip first and newest last;
 * a null slot is an empty column, so the newest trip sits at the right-hand end
 * however few there are. Each value is a fraction of the longest of them.
 */
internal data class TripsBoard(
    /** The trip under way, or the fleet's trip next to start. */
    val current: OpenTrip?,
    /** The driver's own trips that have not started, in the order they will run. */
    val queued: List<OpenTrip>,
    val finished: List<DriverTripDto>,
    /** Distance Saarthi measured across the finished trips; null when it measured none. */
    val measuredKm: Double?,
    val measuredCount: Int,
    val bars: List<Float?>,
) {
    val isEmpty: Boolean get() = current == null && queued.isEmpty() && finished.isEmpty()
    val hasOpen: Boolean get() = current != null || queued.isNotEmpty()
}

/**
 * Sort the driver's trips into the one holding the vehicle, the ones queued
 * behind it, and the ones finished.
 *
 * The trip under way exists only while the server says [active]; its details
 * come from the fleet's dispatch first and the driver's own trip record second.
 * A dispatch that has not started is the trip up next. The summary counts
 * measured distances only — a planned figure is a promise, not kilometres
 * driven, so it never reaches the total.
 */
internal fun tripsBoard(
    trips: List<DriverTripDto>,
    active: Boolean,
    dispatch: TerminalTripDto?,
    sessionStartedAt: String?,
    registration: String?,
    queue: TripQueueDto?,
): TripsBoard {
    // The driver's own trip waiting for Start is the head of their queue, shown there and only there.
    val headOfQueue = dispatch != null && !dispatch.underway && queue?.trips?.any { it.id == dispatch.id } == true
    val record = when {
        dispatch != null -> trips.firstOrNull { it.id == dispatch.id }
        active -> trips.firstOrNull { it.status in UnderwayStatuses }
        else -> null
    }
    val current = if ((active || dispatch != null) && !headOfQueue) {
        OpenTrip(
            id = dispatch?.id ?: record?.id,
            reference = dispatch?.reference?.ifBlank { null } ?: record?.reference?.ifBlank { null },
            origin = dispatch?.originAddress?.ifBlank { null } ?: record?.fromLabel?.ifBlank { null },
            destination = dispatch?.destinationAddress?.ifBlank { null } ?: record?.toLabel?.ifBlank { null },
            plannedKm = dispatch?.plannedDistanceKm ?: record?.takeIf { it.distanceIsPlanned }?.distanceKm,
            startedAt = if (active) record?.startedAt ?: sessionStartedAt else null,
            registration = registration ?: record?.registrationNumber,
            stage = if (active) TripStage.UNDER_WAY else TripStage.UP_NEXT,
            fromFleet = !(dispatch?.driverCreated ?: record?.driverCreated ?: false),
        )
    } else {
        null
    }

    val queued = queue?.trips?.filter { it.id != current?.id }?.map { trip ->
        OpenTrip(
            id = trip.id,
            reference = trip.reference?.ifBlank { null },
            origin = trip.fromLabel?.ifBlank { null },
            destination = trip.toLabel?.ifBlank { null },
            plannedKm = trip.plannedDistanceKm,
            startedAt = null,
            registration = registration,
            stage = if (trip.upNext) TripStage.UP_NEXT else TripStage.QUEUED,
            fromFleet = false,
            position = trip.position,
        )
    } ?: trips
        // Until the queue has answered: the driver's queued trips in the order they were added.
        .filter { it.status == QUEUED_STATUS && it.driverCreated && it.id != current?.id }
        .sortedBy { it.createdAt }
        .map { trip ->
            OpenTrip(
                id = trip.id,
                reference = trip.reference?.ifBlank { null },
                origin = trip.fromLabel?.ifBlank { null },
                destination = trip.toLabel?.ifBlank { null },
                plannedKm = trip.takeIf { it.distanceIsPlanned }?.distanceKm,
                startedAt = null,
                registration = trip.registrationNumber,
                stage = TripStage.QUEUED,
                fromFleet = false,
            )
        }

    val finished = trips.filter { it.status == FINISHED_STATUS && it.id != current?.id }
    val measured = finished.mapNotNull { trip -> trip.distanceKm?.takeUnless { trip.distanceIsPlanned } }
    // The list arrives newest first; the bars read left to right, oldest to newest.
    val recent = measured.take(SUMMARY_BARS).reversed()
    val longest = recent.maxOrNull()?.takeIf { it > 0.0 }
    val bars = List<Float?>(SUMMARY_BARS - recent.size) { null } +
        recent.map { km -> longest?.let { (km / it).toFloat() } ?: 0f }

    return TripsBoard(
        current = current,
        queued = queued,
        finished = finished,
        measuredKm = if (measured.isEmpty()) null else measured.sum(),
        measuredCount = measured.size,
        bars = bars,
    )
}
