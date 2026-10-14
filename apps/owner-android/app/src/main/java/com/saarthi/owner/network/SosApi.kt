package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Roadside emergencies: a fleet's own drivers, or an association's members. */
class SosApi(private val api: OwnerApi) {

    @Serializable
    data class Person(val id: String = "", val name: String = "", val phone: String? = null)

    @Serializable
    data class Truck(val id: String = "", val registrationNumber: String = "")

    @Serializable
    data class Responder(
        val id: String,
        val registrationNumber: String = "",
        val driverName: String? = null,
        val driverPhone: String? = null,
        val sameFleet: Boolean = false,
        val distanceKm: Double? = null,
        val status: String = "",
    )

    @Serializable
    data class Incident(
        val id: String,
        val reference: String = "",
        val organizationName: String? = null,
        val type: String = "",
        val status: String = "",
        val latitude: Double? = null,
        val longitude: Double? = null,
        val address: String? = null,
        val description: String? = null,
        val contactPhone: String? = null,
        val searchRadiusMeters: Int? = null,
        val driver: Person? = null,
        val truck: Truck? = null,
        val triggeredAt: String = "",
        val resolvedAt: String? = null,
        val responderCount: Int = 0,
        val acknowledgedCount: Int = 0,
        val responders: List<Responder> = emptyList(),
    ) {
        val active: Boolean get() = status in ACTIVE
    }

    @Serializable
    private data class Expanded(val expanded: Boolean = false)

    /** Incidents still open, newest first. */
    suspend fun active(): List<Incident> =
        api.get("/sos?pageSize=20&status=${ACTIVE.joinToString(",")}", Page.serializer(Incident.serializer()))?.items.orEmpty()

    suspend fun get(id: String): Incident? = api.get("/sos/$id", Incident.serializer())

    suspend fun resolve(id: String, note: String) {
        api.post("/sos/$id/resolve", buildJsonObject { put("resolutionNote", note) }.toString(), Incident.serializer())
    }

    /** Ask more Saarthi trucks — the circle widens. */
    suspend fun expandSearch(id: String): Boolean =
        api.post("/sos/$id/expand-search", "{}", Expanded.serializer())?.expanded ?: false

    companion object {
        val ACTIVE = listOf("TRIGGERED", "BROADCASTING", "ACKNOWLEDGED", "HELP_ASSIGNED", "ASSISTANCE_ARRIVED")

        /** "Tyre", "Breakdown" — the kind of trouble, as a word. */
        fun typeWord(type: String): String = type.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
    }
}
