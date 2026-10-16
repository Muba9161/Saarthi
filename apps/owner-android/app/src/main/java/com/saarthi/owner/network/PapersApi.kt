package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.time.LocalDate

/**
 * A vehicle's papers.
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

    /** Whether the vehicle's papers can go to Saarthi's reviewers, and what stands in the way. */
    @Serializable
    data class Review(val case: ReviewCase? = null, val readiness: Readiness = Readiness())

    @Serializable
    data class ReviewCase(val status: String = "")

    @Serializable
    data class Readiness(
        val ready: Boolean = false,
        val missing: List<Gap> = emptyList(),
        val invalid: List<Gap> = emptyList(),
    )

    /** A required paper that is absent, or present but not usable, and why. */
    @Serializable
    data class Gap(val documentType: String = "", val label: String = "", val reason: String? = null)

    @Serializable
    private data class Created(val id: String = "")

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

    /**
     * File a paper into its folder. The expiry is required for every vehicle
     * paper, as on the web; the number and issue date are kept when given.
     */
    suspend fun uploadPaper(
        vehicleId: String,
        documentType: String,
        number: String?,
        issuedOn: LocalDate?,
        expiresOn: LocalDate,
        file: OwnerApi.Upload,
    ) {
        val fields = buildMap {
            put("ownerType", "TRUCK")
            put("ownerId", vehicleId)
            put("documentType", documentType)
            put("expiryDate", expiresOn.toString())
            number?.trim()?.takeIf { it.isNotEmpty() }?.let { put("documentNumber", it.take(80)) }
            issuedOn?.let { put("issueDate", it.toString()) }
        }
        api.upload("/documents", fields, "file", file, Created.serializer())
    }

    /** Add an outside photograph of the vehicle, shown in its Photos folder. */
    suspend fun uploadPhoto(vehicleId: String, file: OwnerApi.Upload) {
        val fields = mapOf("ownerType" to "VEHICLE", "ownerId" to vehicleId, "purpose" to "VEHICLE_EXTERIOR")
        api.upload("/media", fields, "file", file, Created.serializer())
    }

    suspend fun deletePhoto(photoId: String) {
        api.delete("/media/$photoId")
    }

    /** Where the vehicle's review stands; null when this account cannot read it. */
    suspend fun review(vehicleId: String): Review? = api.get("/verification/subject/truck/$vehicleId", Review.serializer())

    /** Hand the vehicle's papers to Saarthi's reviewers. */
    suspend fun sendForReview(vehicleId: String) {
        val body = buildJsonObject {
            put("subjectType", "TRUCK")
            put("subjectId", vehicleId)
        }
        api.post("/verification", body.toString(), Created.serializer())
    }

    /** Enter the Secure PIN: the web's own unlock, for this sign-in only. */
    suspend fun unlock(pin: String) {
        api.post(
            "/security/unlock/pin",
            api.json.encodeToString(UnlockRequest.serializer(), UnlockRequest(pin)),
            Unlocked.serializer(),
        )
    }

    companion object {
        const val KIND_PAPER = "PAPER"
        const val KIND_PHOTOS = "PHOTOS"
        const val KIND_QR = "QR"
        const val KIND_OTHER = "OTHER"

        const val ACCESS_FULL = "FULL"
        const val ACCESS_LOCKED = "LOCKED"
        const val ACCESS_OWNERSHIP_REQUIRED = "OWNERSHIP_REQUIRED"

        /** What the web checks before offering the same buttons. */
        const val CAN_UPLOAD_PAPERS = "documents.upload"
        const val CAN_UPLOAD_PHOTOS = "media.upload"
        const val CAN_DELETE_PHOTOS = "media.delete"
        const val CAN_SEND_FOR_REVIEW = "verification.submit"
        const val CAN_READ_REVIEW = "verification.read"
        const val PHOTOS_FEATURE = "media.library"
    }
}
