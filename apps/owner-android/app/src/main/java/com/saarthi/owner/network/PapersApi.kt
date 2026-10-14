package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A vehicle's papers, and the people its owner has shared it with. */
class PapersApi(private val api: OwnerApi) {

    @Serializable
    data class Paper(
        val id: String,
        val ownerId: String = "",
        val documentType: String = "",
        val documentTypeLabel: String = "",
        val documentNumber: String? = null,
        val expiryDate: String? = null,
        val validity: String = "",
        val daysRemaining: Int? = null,
        val verificationStatus: String = "",
    ) {
        /** The number with all but the last four hidden — enough to tell papers apart. */
        val maskedNumber: String?
            get() = documentNumber?.takeIf { it.length > 4 }?.let { "••••" + it.takeLast(4) } ?: documentNumber

        val expired: Boolean get() = (daysRemaining ?: 1) < 0 || validity == "EXPIRED"
        /** Turned down when it was checked — as good as missing until it is uploaded again. */
        val rejected: Boolean get() = validity == "REJECTED"
        /** Uploaded, not yet checked. */
        val pending: Boolean get() = validity == "PENDING_VERIFICATION"
        val dueSoon: Boolean get() = !expired && !rejected && (daysRemaining ?: Int.MAX_VALUE) <= DUE_SOON_DAYS
    }

    @Serializable
    data class SharedWith(val name: String = "", val email: String = "")

    @Serializable
    data class Share(val id: String, val status: String = "", val sharedWith: SharedWith = SharedWith(), val invitedAt: String = "")

    suspend fun forVehicle(vehicleId: String): List<Paper> =
        api.get("/documents/owner/TRUCK/$vehicleId?pageSize=50", Page.serializer(Paper.serializer()))?.items.orEmpty()

    suspend fun shares(vehicleId: String): List<Share> =
        api.get("/fleet/sharing/vehicles/$vehicleId/shares", ListSerializer(Share.serializer())).orEmpty()

    /** Invite somebody by the email their own Saarthi account is on. */
    suspend fun share(vehicleId: String, email: String) {
        api.post("/fleet/sharing/vehicles/$vehicleId/shares", buildJsonObject { put("email", email.trim()) }.toString(), Share.serializer())
    }

    suspend fun unshare(shareId: String) {
        api.delete("/fleet/sharing/shares/$shareId")
    }

    companion object {
        const val DUE_SOON_DAYS = 30
        const val MAX_SHARES = 3
    }
}
