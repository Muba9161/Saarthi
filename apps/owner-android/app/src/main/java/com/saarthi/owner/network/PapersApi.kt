package com.saarthi.owner.network

import com.saarthi.owner.R
import com.saarthi.owner.ui.common.Words
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import java.time.LocalDate
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger

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

    /** A vehicle's QR sticker or a driver's badge (`VEHICLE`, `DRIVER`), issued on first ask exactly as the web's panel does. */
    suspend fun sticker(subjectId: String, subjectType: String = "VEHICLE"): Sticker? =
        api.get("/qr/subject/$subjectType/$subjectId", Sticker.serializer())

    suspend fun stickerImage(sticker: Sticker): ByteArray? = sticker.imageUrl.takeIf { it.isNotBlank() }?.let { api.image(it) }

    /**
     * File a paper for [ownerId] — a vehicle (`TRUCK`) or a driver (`DRIVER`).
     * Every vehicle paper needs its expiry, as on the web; the number, issue
     * date and an optional expiry are kept when given. A second upload of the
     * same paper replaces the first on the server, as a new version.
     */
    suspend fun uploadPaper(
        ownerId: String,
        documentType: String,
        number: String?,
        issuedOn: LocalDate?,
        expiresOn: LocalDate?,
        file: OwnerApi.Upload,
        ownerType: String = OWNER_VEHICLE,
    ) {
        val fields = buildMap {
            put("ownerType", ownerType)
            put("ownerId", ownerId)
            put("documentType", documentType)
            expiresOn?.let { put("expiryDate", it.toString()) }
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

    /*
     * The 360° spin: ordinary media, one asset per frame under the vehicle, in
     * their own purpose, ordered by `sortOrder`, each with a small rendition —
     * exactly as the web stores it, so either app turns the other's spin.
     */

    /** One stored frame of the vehicle's spin. */
    @Serializable
    data class SpinFrame(val id: String, val sortOrder: Int = 0, val thumbnailUrl: String? = null)

    /** A frame ready to send: the full rendition, and the small one the viewer turns through. */
    class SpinUpload(val full: ByteArray, val thumb: ByteArray)

    /** The spin's frames in display order; empty when the vehicle has none. */
    suspend fun spin(vehicleId: String): List<SpinFrame> =
        api.get("/media/owner/vehicle/$vehicleId?purpose=$SPIN_PURPOSE", ListSerializer(SpinFrame.serializer()))
            .orEmpty()
            .sortedBy { it.sortOrder }

    suspend fun spinFrame(frame: SpinFrame, full: Boolean): ByteArray? =
        api.image("/api/v1/media/${frame.id}/file?variant=${if (full || frame.thumbnailUrl == null) "original" else "thumb"}")

    /** A spin goes whole or not at all. */
    suspend fun removeSpin(frameIds: List<String>) = coroutineScope {
        frameIds.map { id -> async { api.delete("/media/$id") } }.awaitAll()
    }

    /**
     * Send a spin's frames, a few at a time, each tried again on a dropped
     * connection. If one finally fails — or the person leaves — whatever
     * already landed is taken back off, so a vehicle is never left with half a
     * spin that looks like a broken one.
     */
    suspend fun uploadSpin(vehicleId: String, frames: List<SpinUpload>, onProgress: (sent: Int) -> Unit) {
        val stored = Collections.synchronizedList(mutableListOf<String>())
        val next = AtomicInteger(0)
        try {
            coroutineScope {
                List(minOf(SPIN_UPLOADS_AT_ONCE, frames.size)) {
                    async {
                        while (true) {
                            val index = next.getAndIncrement()
                            if (index >= frames.size) break
                            stored += uploadSpinFrame(vehicleId, frames[index], index)
                            onProgress(stored.size)
                        }
                    }
                }.awaitAll()
            }
        } catch (failure: Throwable) {
            // The failure being reported matters more than the clean-up's.
            withContext(NonCancellable) { runCatching { removeSpin(stored.toList()) } }
            throw failure
        }
    }

    private suspend fun uploadSpinFrame(vehicleId: String, frame: SpinUpload, index: Int): String {
        val name = "spin-%02d.jpg".format(index + 1)
        val fields = mapOf(
            "ownerType" to "VEHICLE",
            "ownerId" to vehicleId,
            "purpose" to SPIN_PURPOSE,
            "sortOrder" to index.toString(),
        )
        var attempt = 1
        while (true) {
            try {
                return api.upload(
                    "/media",
                    fields,
                    "file",
                    OwnerApi.Upload(name, "image/jpeg", frame.full),
                    Created.serializer(),
                    extraFiles = mapOf("thumbnail" to OwnerApi.Upload("thumb-$name", "image/jpeg", frame.thumb)),
                )?.id?.takeIf { it.isNotEmpty() } ?: throw OwnerApi.Failure.Refused(200, Words.get(R.string.net_error_spin_frame_not_kept))
            } catch (failure: OwnerApi.Failure) {
                if (attempt >= SPIN_UPLOAD_ATTEMPTS || !failure.worthRetrying) throw failure
                delay(SPIN_RETRY_BASE_MS shl (attempt - 1))
                attempt++
            }
        }
    }

    /** The network dropped or the server was busy — never a refusal. */
    private val OwnerApi.Failure.worthRetrying: Boolean
        get() = this is OwnerApi.Failure.Offline ||
            (this is OwnerApi.Failure.Refused && (status == 408 || status == 429 || status >= 500))

    /** Enter the Secure PIN: the web's own unlock, for this sign-in only. */
    suspend fun unlock(pin: String) {
        api.post(
            "/security/unlock/pin",
            api.json.encodeToString(UnlockRequest.serializer(), UnlockRequest(pin)),
            Unlocked.serializer(),
        )
    }

    companion object {
        const val OWNER_VEHICLE = "TRUCK"
        const val OWNER_DRIVER = "DRIVER"

        /** The shared catalogue's `VEHICLE_SPIN_FRAMES`: fewer cannot turn, more crowds the photos out. */
        const val SPIN_MIN_FRAMES = 4
        const val SPIN_MAX_FRAMES = 24

        /** The catalogue's longest edge for a stored spin frame. */
        const val SPIN_FRAME_EDGE = 1280

        private const val SPIN_PURPOSE = "VEHICLE_SPIN_FRAME"
        private const val SPIN_UPLOADS_AT_ONCE = 3
        private const val SPIN_UPLOAD_ATTEMPTS = 3
        private const val SPIN_RETRY_BASE_MS = 600L

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
        const val PHOTOS_FEATURE = "media.library"
    }
}
