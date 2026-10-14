package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A truck association: its members' emergencies on the roads it covers. */
class AssociationApi(private val api: OwnerApi) {

    @Serializable
    data class Stats(val alertsReceived: Int = 0, val alertsResolved: Int = 0, val avgResponseMinutes: Double? = null)

    @Serializable
    data class Area(val label: String = "", val district: String = "", val radiusKm: Double = 0.0)

    @Serializable
    data class Association(
        val id: String,
        val name: String = "",
        val district: String = "",
        val emergencyPhone: String? = null,
        val memberTruckCount: Int = 0,
        val acceptingAlerts: Boolean = true,
        val coverageAreas: List<Area> = emptyList(),
        val stats: Stats = Stats(),
    )

    @Serializable
    data class Overview(
        val open: Int = 0,
        val critical: Int = 0,
        val unacknowledged: Int = 0,
        val responding: Int = 0,
        val resolvedToday: Int = 0,
        val activeVehiclesInArea: Int = 0,
    )

    @Serializable
    data class Alert(
        val id: String,
        val reference: String = "",
        val severity: String = "",
        val status: String = "",
        val incidentType: String = "",
        val vehicleRegistration: String? = null,
        val fleetName: String? = null,
        val latitude: Double? = null,
        val longitude: Double? = null,
        val address: String? = null,
        val description: String? = null,
        val driverName: String? = null,
        val driverPhone: String? = null,
        val contactPhone: String? = null,
        val distanceKm: Double? = null,
        val ageMinutes: Long = 0,
        val overdue: Boolean = false,
        val responderCount: Int = 0,
        val outcome: String? = null,
        val notifiedAt: String = "",
        /** Who has said they are going. Only an alert read on its own carries it, not the list. */
        val responders: List<Responder> = emptyList(),
    ) {
        val open: Boolean get() = status in setOf("NOTIFIED", "ACKNOWLEDGED", "RESPONDING", "ESCALATED")

        /** Whether [userId] has already said they are on the way. */
        fun isGoing(userId: String): Boolean = responders.any { it.userId == userId && it.completedAt == null }
    }

    @Serializable
    data class Responder(val id: String = "", val userId: String? = null, val status: String = "", val completedAt: String? = null)

    suspend fun me(): Association? = api.get("/associations/me", Association.serializer())

    suspend fun overview(): Overview? = api.get("/associations/alerts/overview", Overview.serializer())

    suspend fun alerts(): List<Alert> =
        api.get("/associations/alerts?pageSize=50", Page.serializer(Alert.serializer()))?.items.orEmpty()

    suspend fun get(id: String): Alert? = api.get("/associations/alerts/$id", Alert.serializer())

    suspend fun acknowledge(id: String): Alert? = api.post("/associations/alerts/$id/acknowledge", "{}", Alert.serializer())

    /** "I'm going" — the signed-in member puts themselves down as responding. */
    suspend fun respond(id: String, userId: String) {
        val body = buildJsonObject {
            put("kind", "MEMBER")
            put("userId", userId)
        }
        api.post("/associations/alerts/$id/responders", body.toString(), Alert.serializer())
    }

    suspend fun resolve(id: String, outcome: String): Alert? =
        api.post("/associations/alerts/$id/resolve", buildJsonObject { put("outcome", outcome) }.toString(), Alert.serializer())
}
