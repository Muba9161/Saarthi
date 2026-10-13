package com.saarthi.owner.network

import kotlinx.serialization.Serializable

/** The business's drivers, as the web app's Drivers page lists them. */
class DriversApi(private val api: OwnerApi) {

    @Serializable
    data class TruckRef(val id: String = "", val registrationNumber: String = "")

    @Serializable
    data class DocumentHealth(val expired: Int = 0, val expiringSoon: Int = 0)

    @Serializable
    data class Driver(
        val id: String,
        val fullName: String = "",
        val phone: String? = null,
        val availability: String = "",
        val verificationStatus: String = "",
        val currentTruck: TruckRef? = null,
        val overallScore: Int? = null,
        val totalTrips: Int = 0,
        val experienceYears: Int = 0,
        val documentHealth: DocumentHealth = DocumentHealth(),
    )

    suspend fun list(): List<Driver> =
        api.get("/drivers?pageSize=200", Page.serializer(Driver.serializer()))?.items.orEmpty()
}
