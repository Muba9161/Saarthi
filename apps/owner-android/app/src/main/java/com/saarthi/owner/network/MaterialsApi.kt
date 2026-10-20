package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * A seller's listings — what fleets see when they source a job near the
 * seller: the goods, the price, and the stock.
 */
class MaterialsApi(private val api: OwnerApi) {

    @Serializable
    data class Listing(
        val id: String,
        val name: String = "",
        val category: String? = null,
        val description: String? = null,
        val unit: String = "TON",
        val pricePerUnit: Double = 0.0,
        val availableQuantity: Double = 0.0,
        val minimumOrderQty: Double = 0.0,
        val status: String = "ACTIVE",
        val pickupAddress: String? = null,
        val pickupLatitude: Double? = null,
        val pickupLongitude: Double? = null,
        val updatedAt: String = "",
    ) {
        /** Shown to fleets bidding nearby. */
        val shown: Boolean get() = status == "ACTIVE"

        /** Under ten minimum orders left, or none at all. */
        val low: Boolean
            get() = status == "OUT_OF_STOCK" || availableQuantity <= 0.0 ||
                (minimumOrderQty > 0 && availableQuantity < minimumOrderQty * LOW_STOCK_ORDERS)
    }

    /** The payout account the seller is paid into — set up on the web, shown here. */
    @Serializable
    data class PayoutAccount(
        val status: String = "NOT_CONNECTED",
        val accountHolderName: String? = null,
        val maskedAccount: String? = null,
        val bankName: String? = null,
        val usable: Boolean = false,
    )

    suspend fun mine(): List<Listing> =
        api.get("/marketplace/my-materials?pageSize=200", Page.serializer(Listing.serializer()))?.items.orEmpty()

    /** Change what fleets see: price, stock, or whether it is shown at all. */
    suspend fun update(id: String, price: Double? = null, stock: Double? = null, shown: Boolean? = null): Listing? {
        val body = buildJsonObject {
            price?.let { put("pricePerUnit", it) }
            stock?.let { put("availableQuantity", it) }
            shown?.let { put("status", if (it) "ACTIVE" else "INACTIVE") }
        }
        return api.patch("/marketplace/materials/$id", body.toString(), Listing.serializer())
    }

    /** A listing's photo in the media library; the cover is what fleets see first. */
    @Serializable
    data class Photo(val id: String, val isPrimary: Boolean = false, val sortOrder: Int = 0, val thumbnailUrl: String? = null)

    @Serializable
    private data class Created(val id: String)

    /** Everything a seller may change about a listing; only what is set is sent. */
    class Changes(
        val name: String? = null,
        val description: String? = null,
        val unit: String? = null,
        val price: Double? = null,
        val stock: Double? = null,
        val minimumOrder: Double? = null,
        val shown: Boolean? = null,
        val pickup: PlacesApi.Place? = null,
    )

    suspend fun edit(id: String, changes: Changes): Listing? {
        val body = buildJsonObject {
            changes.name?.let { put("name", it.take(120)) }
            // An emptied description is sent empty, which the server reads as "none".
            changes.description?.let { put("description", it.take(2000)) }
            changes.unit?.let { put("unit", it) }
            changes.price?.let { put("pricePerUnit", it) }
            changes.stock?.let { put("availableQuantity", it) }
            changes.minimumOrder?.let { put("minimumOrderQty", it) }
            changes.shown?.let { put("status", if (it) "ACTIVE" else "INACTIVE") }
            changes.pickup?.let {
                put("pickupAddress", it.address.take(300))
                put("pickupLatitude", it.latitude)
                put("pickupLongitude", it.longitude)
            }
        }
        return api.patch("/marketplace/materials/$id", body.toString(), Listing.serializer())
    }

    /** Take a listing off sale for good; the server refuses while an order for it is still open. */
    suspend fun remove(id: String) {
        api.delete("/marketplace/materials/$id")
    }

    suspend fun photos(id: String): List<Photo> =
        api.get("/media/owner/material/$id?purpose=PRODUCT", ListSerializer(Photo.serializer())).orEmpty()

    /** Add a photo; the first one becomes the cover, so a listing is never shown without one. */
    suspend fun addPhoto(id: String, file: OwnerApi.Upload, cover: Boolean) {
        val fields = buildMap {
            put("ownerType", "MATERIAL")
            put("ownerId", id)
            put("purpose", "PRODUCT")
            // Sent only when meant: the server reads any value, "false" too, as yes.
            if (cover) put("isPrimary", "true")
        }
        api.upload("/media", fields, "file", file, Created.serializer())
    }

    suspend fun removePhoto(photoId: String) {
        api.delete("/media/$photoId")
    }

    suspend fun makeCover(photoId: String) {
        api.postNoReply("/media/$photoId/primary")
    }

    suspend fun photo(photoId: String, thumbnail: Boolean): ByteArray? =
        api.image("/api/v1/media/$photoId/file?variant=${if (thumbnail) "thumb" else "original"}")

    data class NewListing(
        val name: String,
        val category: String?,
        val unit: String,
        val price: Double,
        val stock: Double,
        val minimumOrder: Double,
        val pickup: PlacesApi.Place?,
        /** The catalogue category it was read as — what customers' needs are matched against. */
        val categoryId: String? = null,
        val attributes: JsonObject? = null,
        val description: String? = null,
    )

    suspend fun create(input: NewListing): Listing? {
        val body = buildJsonObject {
            put("name", input.name)
            input.category?.ifBlank { null }?.let { put("category", it) }
            input.categoryId?.let { put("categoryId", it) }
            input.attributes?.takeIf { it.isNotEmpty() }?.let { put("attributes", it) }
            put("unit", input.unit)
            put("pricePerUnit", input.price)
            put("availableQuantity", input.stock)
            put("minimumOrderQty", input.minimumOrder)
            input.description?.ifBlank { null }?.let { put("description", it.take(2000)) }
            input.pickup?.let {
                put("pickupAddress", it.address.take(300))
                put("pickupLatitude", it.latitude)
                put("pickupLongitude", it.longitude)
            }
        }
        return api.post("/marketplace/materials", body.toString(), Listing.serializer())
    }

    suspend fun payoutAccount(): PayoutAccount? = api.get("/finance/payout-account", PayoutAccount.serializer())

    companion object {
        private const val LOW_STOCK_ORDERS = 10

        /** The server's cap on one listing's photos. */
        const val MAX_PHOTOS = 24

        const val CAN_UPLOAD_PHOTOS = "media.upload"
        const val CAN_DELETE_PHOTOS = "media.delete"
        const val PHOTOS_FEATURE = "media.library"
    }
}
