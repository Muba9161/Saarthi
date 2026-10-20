package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate

/** The business's drivers, as the web app's Drivers page lists them. */
class DriversApi(private val api: OwnerApi) {

    @Serializable
    data class TruckRef(val id: String = "", val registrationNumber: String = "")

    @Serializable
    data class DocumentHealth(val expired: Int = 0, val expiringSoon: Int = 0)

    @Serializable
    data class Driver(
        val id: String,
        /** The person's own account: the owner's own driver profile carries the owner's id. */
        val userId: String = "",
        val fullName: String = "",
        val email: String? = null,
        val phone: String? = null,
        val availability: String = "",
        val verificationStatus: String = "",
        val currentTruck: TruckRef? = null,
        val overallScore: Int? = null,
        val totalTrips: Int = 0,
        val totalDistanceKm: Double = 0.0,
        val experienceYears: Int = 0,
        val licenseNumber: String? = null,
        val licenseExpiryDate: String? = null,
        val licenseClass: String? = null,
        val documentHealth: DocumentHealth = DocumentHealth(),
    )

    /** One of a driver's papers, as `GET /documents/owner/driver/:id` lists it. */
    @Serializable
    data class Paper(
        val id: String,
        val documentType: String = "",
        val documentTypeLabel: String = "",
        val documentNumber: String? = null,
        val expiryDate: String? = null,
        /** `VALID`, `EXPIRING_SOON`, `EXPIRED`, `PENDING`… as the server judges it. */
        val validity: String = "",
        val verificationStatus: String = "",
        val fileName: String = "",
        val mimeType: String? = null,
    )

    /** A driver to add, as the web's add-driver form sends one. */
    class NewDriver(
        val firstName: String,
        val lastName: String,
        val email: String,
        val phone: String,
        val licenceNumber: String,
        val licenceExpiry: LocalDate?,
        val experienceYears: Int,
    )

    /** The new driver, and the one-time link they open to set their own password. */
    @Serializable
    data class Added(val driver: Driver, val setupUrl: String = "")

    suspend fun list(): List<Driver> =
        api.get("/drivers?pageSize=200", Page.serializer(Driver.serializer()))?.items.orEmpty()

    suspend fun get(id: String): Driver? = api.get("/drivers/$id", Driver.serializer())

    suspend fun add(driver: NewDriver): Added? {
        val body = buildJsonObject {
            put("firstName", driver.firstName.trim())
            put("lastName", driver.lastName.trim())
            put("email", driver.email.trim())
            put("phone", driver.phone.trim())
            put("licenseNumber", driver.licenceNumber.trim())
            driver.licenceExpiry?.let { put("licenseExpiryDate", it.toString()) }
            put("experienceYears", driver.experienceYears)
        }
        return api.post("/drivers", body.toString(), Added.serializer())
    }

    /** Take a driver off the business. Their own account and trip history stay. */
    suspend fun remove(id: String) {
        api.delete("/drivers/$id")
    }

    suspend fun papers(id: String): List<Paper> =
        api.get("/documents/owner/driver/$id?pageSize=100", Page.serializer(Paper.serializer()))?.items.orEmpty()

    /** Who can be put on a vehicle: verified, and not already on one — the server's own rule. */
    suspend fun assignable(): List<Driver> =
        api.get("/drivers?assigned=false&verificationStatus=VERIFIED&pageSize=100", Page.serializer(Driver.serializer()))?.items.orEmpty()

    /** The signed-in person's own driver profile in this business, if they have one. */
    @Serializable
    data class SelfDriver(
        val id: String,
        val licenseNumber: String = "",
        val verificationStatus: String = "",
        val currentTruckId: String? = null,
    ) {
        val verified: Boolean get() = verificationStatus == VERIFIED
    }

    @Serializable
    private data class SessionView(val driver: SelfDriver? = null)

    suspend fun mine(): SelfDriver? = api.get("/auth/me", SessionView.serializer())?.driver

    /**
     * Add the owner to their own driver list — "assign to yourself". Returns the
     * existing profile when there is one. A new one starts unverified, so it
     * can drive only once the licence is verified.
     */
    suspend fun addMyself(licenceNumber: String, licenceExpiry: LocalDate?): SelfDriver? {
        val body = buildJsonObject {
            put("licenseNumber", licenceNumber.trim())
            licenceExpiry?.let { put("licenseExpiryDate", it.toString()) }
        }
        return api.post("/drivers/me", body.toString(), SelfDriver.serializer())
    }

    companion object {
        const val VERIFIED = "VERIFIED"

        /** The server's `DRIVERS_MANAGE`: adding a driver, including yourself. */
        const val CAN_MANAGE = "drivers.manage"
    }
}
