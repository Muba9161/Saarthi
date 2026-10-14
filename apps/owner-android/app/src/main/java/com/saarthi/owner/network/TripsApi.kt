package com.saarthi.owner.network

import kotlinx.serialization.Serializable

/** A fleet's trips, as the web app's Trips pages read them. */
class TripsApi(private val api: OwnerApi) {

    @Serializable
    data class Point(val latitude: Double, val longitude: Double)

    @Serializable
    data class TripDriver(val id: String = "", val name: String = "", val phone: String? = null)

    @Serializable
    data class TripTruck(val id: String = "", val registrationNumber: String = "", val truckType: String? = null)

    @Serializable
    data class Trip(
        val id: String,
        val reference: String = "",
        val status: String = "",
        val truck: TripTruck? = null,
        val driver: TripDriver? = null,
        val originAddress: String = "",
        val destinationAddress: String = "",
        val plannedDistanceKm: Double? = null,
        val actualDistanceKm: Double? = null,
        val actualStartAt: String? = null,
        val plannedArrivalAt: String? = null,
        val etaAt: String? = null,
        val delayMinutes: Int = 0,
        val progressPercent: Int = 0,
        val plannedRoute: List<Point> = emptyList(),
        val currentLocation: Point? = null,
    ) {
        /** Kilometres still to go, from the plan and how far along it is. */
        val remainingKm: Double?
            get() = plannedDistanceKm?.let { it * (100 - progressPercent.coerceIn(0, 100)) / 100.0 }

        val late: Boolean get() = delayMinutes > 0
    }

    suspend fun get(id: String): Trip? = api.get("/trips/$id", Trip.serializer())
}
