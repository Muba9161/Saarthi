package com.saarthi.owner.network

import kotlinx.serialization.Serializable

/** A fleet's trips, as the web app's Trips pages read them. */
class TripsApi(private val api: OwnerApi) {

    @Serializable
    data class Point(val latitude: Double, val longitude: Double)

    /** Where the vehicle last reported itself, and when. */
    @Serializable
    data class Position(
        val latitude: Double,
        val longitude: Double,
        val speedKph: Double? = null,
        val recordedAt: String? = null,
    )

    @Serializable
    data class TripDriver(
        val id: String = "",
        val name: String = "",
        val phone: String? = null,
        val overallScore: Int? = null,
    )

    @Serializable
    data class TripTruck(
        val id: String = "",
        val registrationNumber: String = "",
        val truckType: String? = null,
        val capacityTons: Double? = null,
    )

    /** The marketplace order a trip carries. */
    @Serializable
    data class TripOrder(val id: String = "", val reference: String = "", val materialName: String = "", val customerName: String = "")

    /** A planned stop: the origin, the destination, or one between. */
    @Serializable
    data class Stop(
        val id: String = "",
        val type: String = "",
        val name: String = "",
        val address: String? = null,
        val sequence: Int = 0,
        val plannedArrival: String? = null,
        val actualArrival: String? = null,
        /** When the vehicle's GPS put it at the stop, and took it away. */
        val reachedAt: String? = null,
        val leftAt: String? = null,
        val status: String = "",
    )

    /** One line of the trip's own record: departed, a delay, a note. */
    @Serializable
    data class Event(val id: String = "", val type: String = "", val description: String? = null, val createdAt: String = "")

    /**
     * One trip as the server shapes it for the caller. The list carries the
     * summary; `GET /trips/:id` adds the route, stops and events. A customer
     * reads the delivery end and the route but never the driver's phone, so
     * [TripDriver.phone] is null for it.
     */
    @Serializable
    data class Trip(
        val id: String,
        val reference: String = "",
        val status: String = "",
        val truck: TripTruck? = null,
        val driver: TripDriver? = null,
        val order: TripOrder? = null,
        val originAddress: String = "",
        val originLatitude: Double? = null,
        val originLongitude: Double? = null,
        val destinationAddress: String = "",
        val destinationLatitude: Double? = null,
        val destinationLongitude: Double? = null,
        val plannedDistanceKm: Double? = null,
        val actualDistanceKm: Double? = null,
        val plannedDurationMin: Int? = null,
        val actualDurationMin: Int? = null,
        val plannedStartAt: String? = null,
        val actualStartAt: String? = null,
        val plannedArrivalAt: String? = null,
        val actualArrivalAt: String? = null,
        val etaAt: String? = null,
        val delayMinutes: Int = 0,
        val progressPercent: Int = 0,
        val price: Double? = null,
        /** Beyond fuel; null when nothing was recorded, which is not a spend of zero. */
        val expenses: Double? = null,
        /** A run the vehicle made on its own account, such as to a pump or a workshop. */
        val adHoc: Boolean = false,
        val driverCreated: Boolean = false,
        val navigationHandoff: String? = null,
        val topSpeedKph: Double? = null,
        val averageSpeedKph: Double? = null,
        val harshBrakingCount: Int = 0,
        val harshAccelerationCount: Int = 0,
        val startOdometerKm: Double? = null,
        val endOdometerKm: Double? = null,
        val notes: String? = null,
        val plannedRoute: List<Point> = emptyList(),
        val currentLocation: Position? = null,
        val stops: List<Stop> = emptyList(),
        val events: List<Event> = emptyList(),
        val createdAt: String = "",
    ) {
        /** Kilometres still to go, from the plan and how far along it is. */
        val remainingKm: Double?
            get() = plannedDistanceKm?.let { it * (100 - progressPercent.coerceIn(0, 100)) / 100.0 }

        val late: Boolean get() = delayMinutes > 0

        /** Out on the road between the pickup and the drop. */
        val underway: Boolean get() = status in UNDERWAY

        /** At the drop or done: the whole route is behind it. */
        val reachedDrop: Boolean get() = status in REACHED

        /** Over, one way or the other; the vehicle has moved on to other work. */
        val closed: Boolean get() = status == "COMPLETED" || status == "CANCELLED"
    }

    /** One stored fix on a trip's travelled path, with how it stood against the route. */
    @Serializable
    data class TrackPoint(
        val latitude: Double,
        val longitude: Double,
        val speedKph: Double? = null,
        val recordedAt: String = "",
        val routeState: String? = null,
    )

    @Serializable
    data class TrackHistory(val points: List<TrackPoint> = emptyList(), val totalDistanceKm: Double = 0.0)

    suspend fun get(id: String): Trip? = api.get("/trips/$id", Trip.serializer())

    /** A vehicle's trips, newest first, a page at a time. */
    suspend fun forVehicle(truckId: String, page: Int, pageSize: Int = PAGE_SIZE): Page<Trip> =
        api.get(
            "/trips?truckId=$truckId&page=$page&pageSize=$pageSize&sortBy=createdAt&sortOrder=desc",
            Page.serializer(Trip.serializer()),
        ) ?: Page()

    /**
     * The path a trip actually drove, as the web's trip page draws it: thinned
     * by the server to [limit] fixes while keeping every change of colour.
     *
     * A plan feature, and the plan's retention window applies, so an older trip
     * can come back empty; a plan without stored history is refused.
     */
    suspend fun travelled(truckId: String, tripId: String, limit: Int = TRAIL_LIMIT): TrackHistory =
        api.get(
            "/tracking/trucks/$truckId/history?tripId=$tripId&limit=$limit&simplify=true",
            TrackHistory.serializer(),
        ) ?: TrackHistory()

    companion object {
        const val PAGE_SIZE = 20

        /** The web trip page asks for the same. */
        private const val TRAIL_LIMIT = 1500

        /** The server's `MOVING_TRIP_STATUSES`, plus a pause on the way. */
        private val UNDERWAY = setOf("STARTED", "IN_TRANSIT", "DELAYED", "EMERGENCY", "SUSPENDED")
        private val REACHED = setOf("ARRIVED", "UNLOADING", "COMPLETED")
    }
}
