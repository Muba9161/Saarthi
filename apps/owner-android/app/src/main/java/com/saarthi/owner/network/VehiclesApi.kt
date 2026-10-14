package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import java.time.Duration
import java.time.Instant

/** The business's vehicles, as the web app's Fleet page lists them. */
class VehiclesApi(private val api: OwnerApi) {

    @Serializable
    data class Driver(val id: String = "", val name: String = "")

    @Serializable
    data class LastLocation(
        val latitude: Double? = null,
        val longitude: Double? = null,
        val speedKph: Double? = null,
        val heading: Double? = null,
        val recordedAt: String? = null,
    )

    @Serializable
    data class DocumentHealth(val total: Int = 0, val expired: Int = 0, val expiringSoon: Int = 0)

    @Serializable
    data class Ownership(val status: String = "", val verifiedAt: String? = null, val note: String? = null)

    @Serializable
    data class Vehicle(
        val id: String,
        val registrationNumber: String = "",
        val vehicleType: String = "TRUCK",
        val truckType: String? = null,
        val category: String? = null,
        val typeLabel: String = "",
        val categoryLabel: String? = null,
        val manufacturer: String? = null,
        val model: String? = null,
        val status: String = "",
        val currentDriver: Driver? = null,
        val currentTripId: String? = null,
        val lastLocation: LastLocation? = null,
        val documentHealth: DocumentHealth = DocumentHealth(),
        val odometerKm: Double? = null,
        val capacityTons: Double? = null,
        val passengerCapacity: Int? = null,
        /** Whether the owner has shown it is theirs — sharing waits for it. */
        val ownership: Ownership? = null,
    ) {
        val ownershipConfirmed: Boolean get() = ownership?.status == "VERIFIED"

        /** The most specific word for its shape — the web app's `vehicleArtType`. */
        val artType: String
            get() = when {
                category != null -> category
                vehicleType == "TRUCK" && truckType != null && truckType != "OTHER" -> truckType
                else -> vehicleType
            }

        /** Where it is right now, as far as its last report says. */
        fun motion(now: Instant = Instant.now()): Motion {
            if (status == "MAINTENANCE") return Motion.SERVICE
            val at = lastLocation?.recordedAt?.let { runCatching { Instant.parse(it) }.getOrNull() }
                ?: return Motion.OFFLINE
            val minutes = Duration.between(at, now).toMinutes()
            return when {
                minutes > OFFLINE_AFTER_MINUTES -> Motion.OFFLINE
                (lastLocation.speedKph ?: 0.0) > MOVING_KPH -> Motion.MOVING
                else -> Motion.IDLE
            }
        }

        /** Minutes since the last report, for "Idle 18m". */
        fun minutesSinceReport(now: Instant = Instant.now()): Long? =
            lastLocation?.recordedAt?.let { runCatching { Instant.parse(it) }.getOrNull() }
                ?.let { Duration.between(it, now).toMinutes().coerceAtLeast(0) }
    }

    enum class Motion { MOVING, IDLE, OFFLINE, SERVICE }

    suspend fun get(id: String): Vehicle? = api.get("/fleet/vehicles/$id", Vehicle.serializer())

    suspend fun list(): List<Vehicle> =
        api.get("/fleet/vehicles?pageSize=200", Page.serializer(Vehicle.serializer()))?.items.orEmpty()

    private companion object {
        /** Older than this, a vehicle is shown offline rather than idle. */
        const val OFFLINE_AFTER_MINUTES = 15L
        const val MOVING_KPH = 3.0
    }
}
