package com.saarthi.owner.network

import com.saarthi.owner.R
import com.saarthi.owner.ui.common.Words
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
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

        /** Free to take new work: nothing running on it, and not in the workshop. A driver being attached does not make it busy. */
        val freeForWork: Boolean get() = currentTripId == null && status in FREE_STATUSES

        /** Why the vehicle is not free, in a word. */
        val busyWord: String
            get() = when {
                status == "MAINTENANCE" -> Words.get(R.string.net_vehicle_busy_service)
                status == "SUSPENDED" -> Words.get(R.string.net_vehicle_busy_suspended)
                currentTripId != null || status in TRIP_STATUSES -> Words.get(R.string.net_vehicle_busy_on_trip)
                else -> Words.get(R.string.net_vehicle_busy)
            }

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


    /**
     * The vehicle's latest reading, as its plan shows it: everything a tracker
     * measures with live telemetry, otherwise what the driver's phone measured.
     */
    @Serializable
    data class Reading(
        val recordedAt: String = "",
        val metrics: List<String> = emptyList(),
        /** Figures invented rather than measured — never to be shown as the vehicle's. */
        val simulatedMetrics: List<String> = emptyList(),
        val speedKph: Double? = null,
        val rpm: Double? = null,
        val engineLoad: Double? = null,
        val coolantTemperature: Double? = null,
        val fuelLevel: Double? = null,
        val batteryVoltage: Double? = null,
    ) {
        /** [value] when the vehicle measured [metric], else null. */
        fun measured(metric: String, value: Double?): Double? =
            value?.takeIf { metric in metrics && metric !in simulatedMetrics }
    }

    suspend fun reading(id: String): Reading? = api.get("/telemetry/vehicles/$id/latest", Reading.serializer())

    suspend fun list(): List<Vehicle> =
        api.get("/fleet/vehicles?pageSize=200", Page.serializer(Vehicle.serializer()))?.items.orEmpty()

    /**
     * Set who drives this vehicle. The server takes only a verified driver who
     * is not already on another vehicle, and not while the vehicle is archived
     * or in the workshop — and says which in its refusal.
     */
    suspend fun assignDriver(vehicleId: String, driverId: String) {
        api.post("/trucks/$vehicleId/assign-driver", buildJsonObject { put("driverId", driverId) }.toString(), JsonObject.serializer())
    }

    suspend fun unassignDriver(vehicleId: String) {
        api.post("/trucks/$vehicleId/unassign-driver", "{}", JsonObject.serializer())
    }

    companion object {
        /** A vehicle's status in a word, as the fleet's list says it. */
        fun statusWord(status: String): String = when (status) {
            "AVAILABLE" -> Words.get(R.string.net_vehicle_status_available)
            "ASSIGNED" -> Words.get(R.string.net_vehicle_status_assigned)
            "ON_TRIP" -> Words.get(R.string.net_vehicle_status_on_trip)
            "LOADING" -> Words.get(R.string.net_vehicle_status_loading)
            "UNLOADING" -> Words.get(R.string.net_vehicle_status_unloading)
            "IDLE" -> Words.get(R.string.net_vehicle_status_idle)
            "OFFLINE" -> Words.get(R.string.net_vehicle_status_offline)
            "MAINTENANCE" -> Words.get(R.string.net_vehicle_status_maintenance)
            "EMERGENCY" -> Words.get(R.string.net_vehicle_status_emergency)
            "SUSPENDED" -> Words.get(R.string.net_vehicle_status_suspended)
            else -> status.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
        }

        /** Statuses in which a vehicle can take new work — a bid, a trip. */
        private val FREE_STATUSES = setOf("AVAILABLE", "IDLE", "ASSIGNED")
        private val TRIP_STATUSES = setOf("ON_TRIP", "LOADING", "UNLOADING")

        /** The server's `TRUCKS_ASSIGN`: setting and clearing a vehicle's driver. */
        const val CAN_ASSIGN_DRIVER = "fleet.trucks.assign"

        /** Older than this, a vehicle is shown offline rather than idle. */
        const val OFFLINE_AFTER_MINUTES = 15L
        const val MOVING_KPH = 3.0
    }
}
