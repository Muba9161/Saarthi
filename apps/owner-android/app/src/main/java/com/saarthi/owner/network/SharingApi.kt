package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant

/**
 * Sharing a vehicle with people outside the business, from both sides.
 *
 * The owner invites up to three people by the email their Saarthi account is
 * on, and can stop sharing at any time. The person it is shared with accepts
 * or declines, follows the vehicle, logs trips, fill-ups and servicing
 * against it, and looks at its papers. What they see is the server's
 * allowlist (`shared-vehicle.view.ts`): never finance or the full RC, and the
 * papers to look at only, as the vehicle's driver sees them.
 */
class SharingApi(private val api: OwnerApi) {

    // -- The owner's side ------------------------------------------------------

    @Serializable
    data class SharedWith(val name: String = "", val email: String = "")

    @Serializable
    data class Share(val id: String, val status: String = "", val sharedWith: SharedWith = SharedWith(), val invitedAt: String = "")

    suspend fun shares(vehicleId: String): List<Share> =
        api.get("/fleet/sharing/vehicles/$vehicleId/shares", ListSerializer(Share.serializer())).orEmpty()

    /** Invite somebody by the email their own Saarthi account is on. */
    suspend fun share(vehicleId: String, email: String) {
        api.post("/fleet/sharing/vehicles/$vehicleId/shares", buildJsonObject { put("email", email.trim()) }.toString(), Share.serializer())
    }

    /** Stop sharing: the owner ending a share, or the person leaving one. */
    suspend fun end(shareId: String) {
        api.delete("/fleet/sharing/shares/$shareId")
    }

    // -- Shared with me ----------------------------------------------------------

    /** A vehicle somebody has offered to share, waiting for an answer. */
    @Serializable
    data class Invitation(
        val shareId: String,
        val registrationNumber: String = "",
        val typeLabel: String = "",
        val ownerName: String = "",
        val invitedBy: String = "",
        val invitedAt: String = "",
    )

    @Serializable
    data class Position(
        val latitude: Double,
        val longitude: Double,
        val speedKph: Double? = null,
        val heading: Double? = null,
        val recordedAt: String = "",
    )

    /** `SharedVehicleView`: what a person a vehicle is shared with may see of it. */
    @Serializable
    data class SharedVehicle(
        val shareId: String,
        val vehicleId: String = "",
        val registrationNumber: String = "",
        val vehicleType: String = "",
        val typeLabel: String = "",
        val truckType: String? = null,
        val category: String? = null,
        val categoryLabel: String? = null,
        val manufacturer: String? = null,
        val model: String? = null,
        val status: String = "",
        val odometerKm: Double = 0.0,
        val capacityTons: Double? = null,
        val passengerCapacity: Int? = null,
        val documentHealth: VehiclesApi.DocumentHealth = VehiclesApi.DocumentHealth(),
        val ownerName: String = "",
        val currentDriverName: String? = null,
        val lastLocation: Position? = null,
        val sharedSince: String = "",
    ) {
        val makeAndModel: String? get() = listOfNotNull(manufacturer, model).joinToString(" ").ifBlank { null }

        /**
         * The shared vehicle in the owner's vehicle shape, so its card, row,
         * figures and map disc are drawn by the very code that draws the owner's
         * own — only the fields the shared view carries are filled.
         */
        fun asVehicle(): VehiclesApi.Vehicle = VehiclesApi.Vehicle(
            id = vehicleId,
            registrationNumber = registrationNumber,
            vehicleType = vehicleType.ifBlank { "TRUCK" },
            truckType = truckType,
            category = category,
            typeLabel = typeLabel,
            categoryLabel = categoryLabel,
            manufacturer = manufacturer,
            model = model,
            status = status,
            currentDriver = currentDriverName?.let { VehiclesApi.Driver(name = it) },
            lastLocation = lastLocation?.let { VehiclesApi.LastLocation(it.latitude, it.longitude, it.speedKph, it.heading, it.recordedAt.ifBlank { null }) },
            documentHealth = documentHealth,
            odometerKm = odometerKm,
            capacityTons = capacityTons,
            passengerCapacity = passengerCapacity,
        )
    }

    @Serializable
    data class SharedWithMe(val invitations: List<Invitation> = emptyList(), val vehicles: List<SharedVehicle> = emptyList())

    @Serializable
    data class Trip(
        val id: String,
        val reference: String = "",
        val status: String = "",
        val origin: String = "",
        val destination: String = "",
        val plannedDistanceKm: Double? = null,
        val actualDistanceKm: Double? = null,
        val plannedStartAt: String? = null,
        val startedAt: String? = null,
        val arrivedAt: String? = null,
        val createdAt: String = "",
    )

    @Serializable
    data class Fuel(
        val id: String,
        val quantityLitres: Double = 0.0,
        val pricePerUnit: Double = 0.0,
        val totalCost: Double = 0.0,
        val odometerKm: Double? = null,
        val stationName: String? = null,
        val recordedAt: String = "",
    )

    @Serializable
    data class Maintenance(
        val id: String,
        val type: String = "",
        val title: String = "",
        val status: String = "",
        val cost: Double? = null,
        val odometerKm: Double? = null,
        val serviceProvider: String? = null,
        val scheduledAt: String? = null,
        val completedAt: String? = null,
        val createdAt: String = "",
    )

    suspend fun sharedWithMe(): SharedWithMe =
        api.get("/fleet/sharing/shared-with-me", SharedWithMe.serializer()) ?: SharedWithMe()

    /** Answer an invitation; accepting adds the vehicle to Shared with me. */
    suspend fun respond(shareId: String, accept: Boolean) {
        api.postNoReply("/fleet/sharing/shares/$shareId/${if (accept) "accept" else "decline"}")
    }

    suspend fun vehicle(shareId: String): SharedVehicle? =
        api.get("/fleet/sharing/shares/$shareId/vehicle", SharedVehicle.serializer())

    suspend fun trips(shareId: String): List<Trip> =
        api.get("/fleet/sharing/shares/$shareId/trips", ListSerializer(Trip.serializer())).orEmpty()

    suspend fun fuel(shareId: String): List<Fuel> =
        api.get("/fleet/sharing/shares/$shareId/fuel", ListSerializer(Fuel.serializer())).orEmpty()

    /** The vehicle's papers, to look at only: the driver's wallet, with the RC masked and no QR sticker. */
    suspend fun papers(shareId: String): PapersApi.Wallet =
        api.get("/fleet/sharing/shares/$shareId/papers", PapersApi.Wallet.serializer()) ?: PapersApi.Wallet()

    suspend fun downloadPaper(shareId: String, paperId: String, into: java.io.File) =
        api.download("/fleet/sharing/shares/$shareId/papers/$paperId/download", into)

    suspend fun photo(shareId: String, photoId: String, thumbnail: Boolean): ByteArray? =
        api.image("/api/v1/fleet/sharing/shares/$shareId/papers/photos/$photoId?variant=${if (thumbnail) "thumb" else "original"}")

    @Serializable
    data class TrailPoint(
        val latitude: Double,
        val longitude: Double,
        val speedKph: Double = 0.0,
        val recordedAt: String = "",
        val routeState: String = "NO_TRIP",
    )

    @Serializable
    data class LiveTrip(
        val id: String,
        val reference: String = "",
        val status: String = "",
        val origin: String = "",
        val destination: String = "",
        val originLatitude: Double? = null,
        val originLongitude: Double? = null,
        val destinationLatitude: Double? = null,
        val destinationLongitude: Double? = null,
        val plannedRoute: List<TripsApi.Point> = emptyList(),
        val startedAt: String? = null,
    )

    /** Only figures the vehicle measured, and only those its owner's plan shows the owner. */
    @Serializable
    data class Reading(
        val recordedAt: String = "",
        val speedKph: Double? = null,
        val rpm: Double? = null,
        val engineLoad: Double? = null,
        val coolantTemperature: Double? = null,
        val fuelLevel: Double? = null,
        val batteryVoltage: Double? = null,
    )

    /** `SharedVehicleLive`: the trip it is on, the road covered (since [from] when given), its readings. */
    @Serializable
    data class Live(val trip: LiveTrip? = null, val trail: List<TrailPoint> = emptyList(), val reading: Reading? = null)

    suspend fun live(shareId: String, from: String?): Live =
        api.get(
            "/fleet/sharing/shares/$shareId/live" + (from?.let { "?from=${java.net.URLEncoder.encode(it, "UTF-8")}" } ?: ""),
            Live.serializer(),
        ) ?: Live()

    suspend fun maintenance(shareId: String): List<Maintenance> =
        api.get("/fleet/sharing/shares/$shareId/maintenance", ListSerializer(Maintenance.serializer())).orEmpty()

    /** Log a trip in the vehicle: where from and to, with an optional note. */
    suspend fun addTrip(shareId: String, origin: PlacesApi.Place, destination: PlacesApi.Place, notes: String?) {
        val body = buildJsonObject {
            put("origin", origin.toAddressJson())
            put("destination", destination.toAddressJson())
            notes?.ifBlank { null }?.let { put("notes", it.take(2000)) }
        }
        api.post("/fleet/sharing/shares/$shareId/trips", body.toString(), Trip.serializer())
    }

    /** Log a fill-up; the server works out the total. */
    suspend fun addFuel(shareId: String, litres: Double, pricePerLitre: Double, odometerKm: Double?, station: String?) {
        val body = buildJsonObject {
            put("quantityLitres", litres)
            put("pricePerUnit", pricePerLitre)
            odometerKm?.let { put("odometerKm", it) }
            station?.ifBlank { null }?.let { put("stationName", it.take(160)) }
        }
        api.post("/fleet/sharing/shares/$shareId/fuel", body.toString(), Fuel.serializer())
    }

    /** Log work on the vehicle: done already, or booked for later. */
    suspend fun addMaintenance(
        shareId: String,
        type: String,
        title: String,
        cost: Double?,
        odometerKm: Double?,
        workshop: String?,
        on: Instant,
        done: Boolean,
    ) {
        val body = buildJsonObject {
            put("type", type)
            put("title", title.take(160))
            cost?.let { put("cost", it) }
            odometerKm?.let { put("odometerKm", it) }
            workshop?.ifBlank { null }?.let { put("serviceProvider", it.take(160)) }
            put(if (done) "performedAt" else "scheduledAt", on.toString())
        }
        api.post("/fleet/sharing/shares/$shareId/maintenance", body.toString(), Maintenance.serializer())
    }

    companion object {
        /** The server's `VEHICLES_UPDATE`: with [FEATURE], what sharing a vehicle needs. */
        const val CAN_SHARE = "fleet.trucks.update"

        const val MAX_SHARES = 3

        /** The plan feature the web gates sharing on. */
        const val FEATURE = "fleet.sharing"
    }
}
