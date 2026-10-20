package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * An owner driving their own vehicle, through their own sign-in rather than a
 * paired cab phone: their trips, the phone's fixes while a trip runs, handing
 * navigation to Google Maps, slips paid on the road, and SOS.
 *
 * Each call is one the server already makes for drivers, so a trip driven from
 * here reads on the fleet's screens exactly as one driven from Humsafar.
 */
class DrivingApi(private val api: OwnerApi) {

    /** One phone fix, as `POST /tracking/locations` takes it. A real fix is `DEVICE`, never the default `MOCK`. */
    @Serializable
    data class Fix(
        val truckId: String,
        val latitude: Double,
        val longitude: Double,
        val speedKph: Double,
        val heading: Double,
        val accuracy: Double? = null,
        val altitude: Double? = null,
        val timestamp: String,
        val source: String = "DEVICE",
    )

    @Serializable
    private data class Batch(val locations: List<Fix>)

    @Serializable
    private data class Accepted(val accepted: Int = 0)

    @Serializable
    private data class Created(val id: String)

    /** The trips this person drives that are not over yet, oldest first. */
    suspend fun myTrips(driverId: String): List<TripsApi.Trip> =
        api.get(
            "/trips?driverId=$driverId&activeOnly=true&pageSize=$MAX_TRIPS&sortBy=createdAt&sortOrder=asc",
            Page.serializer(TripsApi.Trip.serializer()),
        )?.items.orEmpty()

    /** Send fixes the phone gathered; the server files them against the vehicle's trip. */
    suspend fun report(fixes: List<Fix>) {
        if (fixes.isEmpty()) return
        api.post("/tracking/locations/batch", api.json.encodeToString(Batch.serializer(), Batch(fixes)), Accepted.serializer())
    }

    /** Navigation handed to Google Maps (or taken back): an off-route stretch towards the destination is then another road, not a deviation. */
    suspend fun handOff(tripId: String, toGoogleMaps: Boolean) {
        val body = buildJsonObject { if (toGoogleMaps) put("app", "GOOGLE_MAPS") else put("app", JsonNull) }
        api.postNoReply("/trips/$tripId/navigation", body.toString())
    }

    class Slip(
        val vehicleId: String,
        val category: String,
        val amount: Double,
        val vendor: String?,
        val notes: String?,
        val latitude: Double?,
        val longitude: Double?,
        val photo: OwnerApi.Upload,
    )

    /** A slip paid on the road, with its photo; filed against the trip under way. */
    suspend fun fileSlip(slip: Slip) {
        val fields = buildMap {
            put("truckId", slip.vehicleId)
            put("category", slip.category)
            put("amount", slip.amount.toString())
            slip.vendor?.ifBlank { null }?.let { put("vendorName", it.take(120)) }
            slip.notes?.ifBlank { null }?.let { put("notes", it.take(300)) }
            slip.latitude?.let { put("latitude", it.toString()) }
            slip.longitude?.let { put("longitude", it.toString()) }
        }
        api.upload("/fleet/expenses", fields, "file", slip.photo, Created.serializer())
    }

    companion object {
        /** A driver's own trips past this are a dispatcher's problem, not a list to scroll. */
        private const val MAX_TRIPS = 20

        /** The permission a driver profile brings, without which none of this is offered. */
        const val CAN_DRIVE = "trips.drive"
        const val CAN_SOS = "sos.trigger"
    }
}
