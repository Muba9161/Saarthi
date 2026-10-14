package com.saarthi.owner.network

import kotlinx.serialization.Serializable
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
            input.pickup?.let {
                put("pickupAddress", it.address.take(300))
                put("pickupLatitude", it.latitude)
                put("pickupLongitude", it.longitude)
            }
        }
        return api.post("/marketplace/materials", body.toString(), Listing.serializer())
    }

    suspend fun payoutAccount(): PayoutAccount? = api.get("/finance/payout-account", PayoutAccount.serializer())

    private companion object {
        const val LOW_STOCK_ORDERS = 10
    }
}
