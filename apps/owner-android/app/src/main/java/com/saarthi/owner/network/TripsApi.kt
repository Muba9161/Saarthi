package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder
import java.time.Instant

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
        /** Where the trip may go next, as the server's state machine has it; only on the full read. */
        val allowedTransitions: List<String> = emptyList(),
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

        /** Not on the road yet: the vehicle and driver can still be changed. */
        val beforeDeparture: Boolean get() = status == "DRAFT" || status == "ASSIGNED" || status == "LOADING"
    }

    /** A place a trip starts or ends at, as the server's address takes it. */
    class Place(val label: String?, val address: String, val city: String?, val latitude: Double, val longitude: Double)

    /** A new trip, as the web's create-trip dialog sends it. */
    class NewTrip(
        val truckId: String,
        val driverId: String?,
        val from: Place,
        val to: Place,
        val leavesAt: Instant?,
        val arrivesBy: Instant?,
        val price: Double?,
        val notes: String?,
    )

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

    /** The road a vehicle has covered since [from] (an ISO instant), whatever trip it was on. */
    suspend fun travelledSince(truckId: String, from: String, limit: Int = TRAIL_LIMIT): TrackHistory =
        api.get(
            "/tracking/trucks/$truckId/history?from=${java.net.URLEncoder.encode(from, "UTF-8")}&limit=$limit&simplify=true",
            TrackHistory.serializer(),
        ) ?: TrackHistory()

    /**
     * The business's trips, a page at a time: newest first, narrowed by what
     * was typed (a reference, plate, driver or place) and by [statuses].
     */
    suspend fun list(page: Int, search: String, statuses: List<String>, pageSize: Int = PAGE_SIZE): Page<Trip> {
        val query = buildList {
            add("page=$page")
            add("pageSize=$pageSize")
            add("sortBy=createdAt")
            add("sortOrder=desc")
            search.trim().takeIf { it.isNotEmpty() }?.let { add("search=" + URLEncoder.encode(it, "UTF-8")) }
            if (statuses.isNotEmpty()) add("status=" + statuses.joinToString(","))
        }.joinToString("&")
        return api.get("/trips?$query", Page.serializer(Trip.serializer())) ?: Page()
    }

    suspend fun create(trip: NewTrip): Trip? {
        val body = buildJsonObject {
            put("truckId", trip.truckId)
            trip.driverId?.let { put("driverId", it) }
            put("origin", trip.from.json())
            put("destination", trip.to.json())
            trip.leavesAt?.let { put("plannedStartAt", it.toString()) }
            trip.arrivesBy?.let { put("plannedArrivalAt", it.toString()) }
            trip.price?.let { put("price", it) }
            trip.notes?.trim()?.takeIf { it.isNotEmpty() }?.let { put("notes", it.take(2000)) }
        }
        return api.post("/trips", body.toString(), Trip.serializer())
    }

    /** Another vehicle or driver for a trip that has not left yet. */
    suspend fun reassign(tripId: String, truckId: String?, driverId: String?): Trip? {
        val body = buildJsonObject {
            truckId?.let { put("truckId", it) }
            driverId?.let { put("driverId", it) }
        }
        return api.patch("/trips/$tripId", body.toString(), Trip.serializer())
    }

    /**
     * Move a trip on, as the driver would. Finishing a delivery or starting a
     * ride that has a customer's handover code needs that code.
     */
    suspend fun transition(
        tripId: String,
        status: String,
        handoverCode: String? = null,
        note: String? = null,
        latitude: Double? = null,
        longitude: Double? = null,
    ): Trip? {
        val body = buildJsonObject {
            put("status", status)
            handoverCode?.let { put("handoverCode", it) }
            note?.ifBlank { null }?.let { put("note", it.take(500)) }
            if (latitude != null && longitude != null) {
                put("latitude", latitude)
                put("longitude", longitude)
            }
        }
        return api.post("/trips/$tripId/transition", body.toString(), Trip.serializer())
    }

    private fun Place.json(): JsonObject = buildJsonObject {
        label?.trim()?.takeIf { it.isNotEmpty() }?.let { put("label", it.take(120)) }
        put("addressLine", address.take(300))
        city?.let { put("city", it.take(120)) }
        put("latitude", latitude)
        put("longitude", longitude)
    }

    companion object {
        const val PAGE_SIZE = 20

        /** The server's `TRIPS_MANAGE`: creating, reassigning and moving trips. */
        const val CAN_MANAGE = "trips.manage"

        /** Still running, for the list's first filter. */
        val ACTIVE = listOf("ASSIGNED", "LOADING", "STARTED", "IN_TRANSIT", "DELAYED", "ARRIVED", "UNLOADING", "EMERGENCY", "SUSPENDED")

        /** The web trip page asks for the same. */
        private const val TRAIL_LIMIT = 1500

        /** The server's `MOVING_TRIP_STATUSES`, plus a pause on the way. */
        private val UNDERWAY = setOf("STARTED", "IN_TRANSIT", "DELAYED", "EMERGENCY", "SUSPENDED")
        private val REACHED = setOf("ARRIVED", "UNLOADING", "COMPLETED")
    }
}
