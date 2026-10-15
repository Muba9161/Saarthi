package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File

/**
 * A vehicle's papers, and the people its owner has shared it with.
 *
 * The papers arrive as one wallet — `vehicle-papers.service.ts` on the
 * server — filed into the same folders the web's Documents tab and the
 * driver's app use, so a vehicle whose papers came from the RTO register
 * rather than a scanner still has them. The files themselves are opened
 * through the routes the web uses, each with its own access check and audit.
 */
class PapersApi(private val api: OwnerApi) {

    /** Every folder, uploaded paper, photograph and the RC, in one answer. */
    @Serializable
    data class Wallet(
        val folders: List<Folder> = emptyList(),
        val documents: List<Paper> = emptyList(),
        val photos: List<Photo> = emptyList(),
        val rc: VirtualRc? = null,
    )

    /** One folder: a paper type, or the photographs, the QR sticker or other files. */
    @Serializable
    data class Folder(
        /** A document type code, or `PHOTOS`, `QR`, `OTHER`. */
        val id: String,
        val kind: String = KIND_PAPER,
        val label: String = "",
        val mandatory: Boolean = false,
        /** `MISSING`, `OPTIONAL`, `VALID`, `EXPIRING_SOON`, `EXPIRED`, `REJECTED` or `ON_FILE`; null for photographs and the sticker. */
        val status: String? = null,
        val documentIds: List<String> = emptyList(),
        val count: Int = 0,
        /** The date the RTO register gives for this paper, when it gives one. */
        val registerValidUntil: String? = null,
    )

    /** An uploaded file. */
    @Serializable
    data class Paper(
        val id: String,
        val documentType: String = "",
        val title: String? = null,
        val number: String? = null,
        val expiryDate: String? = null,
        val verificationStatus: String = "",
        /** Days until expiry; negative once expired, null with no expiry recorded. */
        val daysToExpiry: Int? = null,
        val mimeType: String? = null,
        val sizeBytes: Long? = null,
    )

    @Serializable
    data class Photo(val id: String, val caption: String? = null, val mimeType: String = "", val hasThumbnail: Boolean = false)

    /**
     * The RC as the RTO register holds it, cut to what this account may see:
     * whole only once ownership is verified and the Secure PIN entered, as on
     * the web. [access] says which, and so why anything is masked.
     */
    @Serializable
    data class VirtualRc(
        val registrationNumber: String,
        val retrievedAt: String = "",
        val dataAsOf: String? = null,
        val verified: Boolean = false,
        val registrationDate: String? = null,
        val registrationStatus: String? = null,
        val ownerName: String? = null,
        val maker: String? = null,
        val model: String? = null,
        val variant: String? = null,
        val vehicleClass: String? = null,
        val vehicleCategory: String? = null,
        val bodyType: String? = null,
        val fuelType: String? = null,
        val color: String? = null,
        val emissionNorms: String? = null,
        val manufacturedOn: String? = null,
        val chassisNumber: String? = null,
        val engineNumber: String? = null,
        val rto: String? = null,
        val seatingCapacity: Int? = null,
        val grossVehicleWeight: Double? = null,
        val unladenWeight: Double? = null,
        val financer: String? = null,
        val insurer: String? = null,
        val insurancePolicyNumber: String? = null,
        val insuranceValidUntil: String? = null,
        val puccNumber: String? = null,
        val puccValidUntil: String? = null,
        val fitnessValidUntil: String? = null,
        val taxValidUntil: String? = null,
        val permitNumber: String? = null,
        val permitType: String? = null,
        val permitValidUntil: String? = null,
        val nationalPermitValidUntil: String? = null,
        val blacklistStatus: String? = null,
        val lookupId: String = "",
        val access: String = "",
        /** A stored RC certificate exists; it downloads only with [ACCESS_FULL]. */
        val pdfAvailable: Boolean = false,
    )

    /** The vehicle's windscreen sticker. */
    @Serializable
    data class Sticker(val shortLabel: String = "", val imageUrl: String = "")

    @Serializable
    data class SharedWith(val name: String = "", val email: String = "")

    @Serializable
    data class Share(val id: String, val status: String = "", val sharedWith: SharedWith = SharedWith(), val invitedAt: String = "")

    @Serializable
    private data class UnlockRequest(val pin: String)

    @Serializable
    private data class Unlocked(val unlockedUntil: String = "")

    suspend fun wallet(vehicleId: String): Wallet =
        api.get("/fleet/vehicles/$vehicleId/papers", Wallet.serializer()) ?: Wallet()

    /** An uploaded paper, saved to [into] for a viewer app. */
    suspend fun downloadPaper(paperId: String, into: File) = api.download("/documents/$paperId/download", into)

    /** The stored RC certificate, saved to [into]. The server refuses unless access is full. */
    suspend fun downloadRc(lookupId: String, into: File) = api.download("/vehicles/lookups/$lookupId/document", into)

    suspend fun photo(photoId: String, thumbnail: Boolean): ByteArray? =
        api.image("/api/v1/media/$photoId/file?variant=${if (thumbnail) "thumb" else "original"}")

    /** The vehicle's QR sticker, issued on first ask exactly as the web's panel does. */
    suspend fun sticker(vehicleId: String): Sticker? = api.get("/qr/subject/VEHICLE/$vehicleId", Sticker.serializer())

    suspend fun stickerImage(sticker: Sticker): ByteArray? = sticker.imageUrl.takeIf { it.isNotBlank() }?.let { api.image(it) }

    /** Enter the Secure PIN: the web's own unlock, for this sign-in only. */
    suspend fun unlock(pin: String) {
        api.post(
            "/security/unlock/pin",
            api.json.encodeToString(UnlockRequest.serializer(), UnlockRequest(pin)),
            Unlocked.serializer(),
        )
    }

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
        const val MAX_SHARES = 3

        const val KIND_PAPER = "PAPER"
        const val KIND_PHOTOS = "PHOTOS"
        const val KIND_QR = "QR"
        const val KIND_OTHER = "OTHER"

        const val ACCESS_FULL = "FULL"
        const val ACCESS_LOCKED = "LOCKED"
        const val ACCESS_OWNERSHIP_REQUIRED = "OWNERSHIP_REQUIRED"
    }
}
