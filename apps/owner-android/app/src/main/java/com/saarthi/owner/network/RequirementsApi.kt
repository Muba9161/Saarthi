package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Duration
import java.time.Instant

/**
 * Requirements — what customers post, and what fleets and operators bid on.
 *
 * The same objects the web app's marketplace reads. A fleet sees the board
 * (with its own bid, if any, on each item); a customer sees its own posts
 * and the bids on them. Who sees which field is decided by the server — the
 * budget stays sealed and contact details stay hidden until an award.
 */
class RequirementsApi(private val api: OwnerApi) {

    @Serializable
    data class Bid(
        val id: String,
        val requirementId: String = "",
        val scope: String = "",
        val status: String = "",
        val bidderName: String = "",
        val bidderVerified: Boolean = false,
        val bidderRating: Double? = null,
        val bidderRatingCount: Int = 0,
        val price: Double = 0.0,
        val message: String? = null,
        val expired: Boolean = false,
        val estimatedArrivalAt: String? = null,
        val deliversMaterial: Boolean = false,
        val offeredVehicleType: String? = null,
        val vehicle: BidVehicle? = null,
    )

    @Serializable
    data class BidVehicle(val id: String = "", val registrationNumber: String = "", val vehicleType: String = "")

    @Serializable
    data class Requirement(
        val id: String,
        val reference: String = "",
        val kind: String = "",
        val status: String = "",
        val title: String = "",
        val description: String? = null,
        val customerName: String = "",
        val originAddress: String = "",
        val originCity: String? = null,
        val originLatitude: Double? = null,
        val originLongitude: Double? = null,
        val destinationAddress: String? = null,
        val destinationCity: String? = null,
        val distanceKm: Double? = null,
        val startAt: String = "",
        val bidsCloseAt: String = "",
        val biddingClosed: Boolean = false,
        val budgetAmount: Double? = null,
        val materialName: String? = null,
        val specification: String? = null,
        val quantity: Double? = null,
        val unit: String? = null,
        val goodsDescription: String? = null,
        val requiredCapacityTons: Double? = null,
        val requiredTruckType: String? = null,
        val passengers: Int? = null,
        val preferredVehicleType: String? = null,
        val durationDays: Int? = null,
        val bidCount: Int = 0,
        val lowestBid: Double? = null,
        val orderId: String? = null,
        val bookingId: String? = null,
        val createdAt: String = "",
        // Board only.
        val distanceToOriginKm: Double? = null,
        val availableScopes: List<String> = emptyList(),
        val myBid: Bid? = null,
    ) {
        /** Hours left to bid, or null once it has closed. */
        fun hoursLeft(now: Instant = Instant.now()): Long? {
            if (biddingClosed) return null
            val closes = runCatching { Instant.parse(bidsCloseAt) }.getOrNull() ?: return null
            val hours = Duration.between(now, closes).toHours()
            return if (closes.isBefore(now)) null else hours
        }

        /** "20 t M-sand", "40 people", the freight's goods — what the job is, in a line. */
        val what: String
            get() = when (kind) {
                KIND_MATERIAL -> listOfNotNull(quantity?.let { "${it.clean()} ${unitWord(unit)}" }, materialName ?: title).joinToString(" ")
                // The load itself leads; the truck size stands in only when no amount was given.
                KIND_FREIGHT -> listOfNotNull(
                    quantity?.takeIf { it > 0 }?.let { "${it.clean()} ${unitWord(unit)}".trim() }
                        ?: requiredCapacityTons?.let { "${it.clean()} t truck ·" },
                    goodsDescription?.ifBlank { null } ?: title,
                ).joinToString(" ")
                else -> listOfNotNull(passengers?.let { "$it people" }, preferredVehicleType?.lowercase()?.replace('_', ' ')).joinToString(" · ").ifBlank { title }
            }

        /** "Pune → Mumbai", or the one place when there is no second. */
        val route: String
            get() {
                val from = originCity?.ifBlank { null } ?: originAddress.substringBefore(',')
                val to = destinationCity?.ifBlank { null } ?: destinationAddress?.substringBefore(',')
                return if (to.isNullOrBlank()) from else "$from → $to"
            }
    }

    /** A seller listing a fleet can source a material requirement from. */
    @Serializable
    data class SellerMatch(
        val materialId: String,
        val name: String = "",
        val sellerName: String = "",
        val sellerVerified: Boolean = false,
        val unit: String = "",
        val pricePerUnit: Double = 0.0,
        val availableQuantity: Double = 0.0,
        val minimumOrderQty: Double = 0.0,
        val pickupAddress: String? = null,
        val distanceKm: Double? = null,
        /** The listing price for the quantity asked for — what the fleet pays the seller. */
        val procurementReference: Double? = null,
        val stockSufficient: Boolean? = null,
        val meetsMinimumOrder: Boolean? = null,
        val reasons: List<String> = emptyList(),
    )

    suspend fun board(): List<Requirement> =
        api.get("/requirements/board?pageSize=50&sortBy=bidsCloseAt&sortOrder=asc", Page.serializer(Requirement.serializer()))
            ?.items.orEmpty()

    suspend fun mine(): List<Requirement> =
        api.get("/requirements?pageSize=50", Page.serializer(Requirement.serializer()))?.items.orEmpty()

    suspend fun get(id: String): Requirement? = api.get("/requirements/$id", Requirement.serializer())

    suspend fun bids(id: String): List<Bid> =
        api.get("/requirements/$id/bids", ListSerializer(Bid.serializer())).orEmpty()

    suspend fun sellerMatches(id: String): List<SellerMatch> =
        api.get("/commerce/requirements/$id/matches", ListSerializer(SellerMatch.serializer())).orEmpty()

    /** What a fleet or operator offers. Fields that do not apply to the scope are left out. */
    data class BidOffer(
        val scope: String,
        val price: Double,
        val message: String? = null,
        val vehicleId: String? = null,
        /** Who drives, when the vehicle has nobody set on it. */
        val driverId: String? = null,
        val sourceMaterialId: String? = null,
        val offeredVehicleType: String? = null,
        val inclusions: List<String> = emptyList(),
        val driverIncluded: Boolean = true,
        val fuelIncluded: Boolean = true,
    )

    suspend fun placeBid(requirementId: String, offer: BidOffer): Bid? {
        val body = buildJsonObject {
            put("scope", offer.scope)
            put("price", offer.price)
            offer.message?.ifBlank { null }?.let { put("message", it) }
            if (offer.scope == SCOPE_TRANSPORT) {
                offer.vehicleId?.let { put("vehicleId", it) }
                offer.driverId?.let { put("driverId", it) }
                offer.sourceMaterialId?.let { put("sourceMaterialId", it) }
            }
            if (offer.scope == SCOPE_TRAVEL) {
                offer.offeredVehicleType?.let { put("offeredVehicleType", it) }
                put("inclusions", JsonArray(offer.inclusions.map { JsonPrimitive(it) }))
                put("driverIncluded", offer.driverIncluded)
                put("fuelIncluded", offer.fuelIncluded)
            }
        }
        return api.post("/requirements/$requirementId/bids", body.toString(), Bid.serializer())
    }

    /** A new requirement, as the customer fills it in. Only the kind's own detail is sent. */
    data class NewRequirement(
        val kind: String,
        val title: String,
        val description: String?,
        val origin: PlacesApi.Place,
        val destination: PlacesApi.Place?,
        val startAt: java.time.Instant,
        /** When bidding stops — before the job starts, so the chosen fleet has time to prepare. */
        val bidsCloseAt: java.time.Instant,
        val budgetAmount: Double?,
        // Material and freight.
        val materialName: String = "",
        val goodsDescription: String = "",
        val quantity: Double = 0.0,
        val unit: String = "TON",
        val specification: String? = null,
        /** For material: the catalogue category the need was read as, and its details. */
        val categoryId: String? = null,
        val attributes: JsonObject? = null,
        val requiredCapacityTons: Double = 0.0,
        // Cab and tour.
        val passengers: Int = 1,
        val hireBasis: String = "ONE_WAY",
        val durationDays: Int = 1,
        val preferredVehicleType: String? = null,
        val destinations: List<String> = emptyList(),
    )

    @Serializable
    data class Awarded(
        val orderId: String? = null,
        val tripId: String? = null,
        val bookingId: String? = null,
        val nextStep: String = "",
    )

    suspend fun create(input: NewRequirement): Requirement? {
        fun place(place: PlacesApi.Place) = buildJsonObject {
            put("addressLine", place.address.take(300))
            place.city?.let { put("city", it.take(120)) }
            put("latitude", place.latitude)
            put("longitude", place.longitude)
        }
        val body = buildJsonObject {
            put("kind", input.kind)
            put("title", input.title)
            input.description?.ifBlank { null }?.let { put("description", it) }
            put("origin", place(input.origin))
            input.destination?.let { put("destination", place(it)) }
            put("startAt", input.startAt.toString())
            put("bidsCloseAt", input.bidsCloseAt.toString())
            input.budgetAmount?.let { put("budgetAmount", it) }
            when (input.kind) {
                KIND_MATERIAL -> put(
                    "materialDetail",
                    buildJsonObject {
                        put("materialName", input.materialName)
                        input.categoryId?.let { put("categoryId", it) }
                        input.attributes?.takeIf { it.isNotEmpty() }?.let { put("attributes", it) }
                        put("quantity", input.quantity)
                        put("unit", input.unit)
                        input.specification?.ifBlank { null }?.let { put("specification", it) }
                    },
                )
                KIND_FREIGHT -> put(
                    "freightDetail",
                    buildJsonObject {
                        put("goodsDescription", input.goodsDescription)
                        put("quantity", input.quantity)
                        put("unit", input.unit)
                        put("requiredCapacityTons", input.requiredCapacityTons)
                    },
                )
                KIND_CAB -> put(
                    "cabDetail",
                    buildJsonObject {
                        put("hireBasis", input.hireBasis)
                        put("passengers", input.passengers)
                        input.preferredVehicleType?.let { put("preferredVehicleType", it) }
                        if (input.hireBasis == "DAILY") put("durationDays", input.durationDays)
                    },
                )
                else -> put(
                    "tourDetail",
                    buildJsonObject {
                        put("destinations", JsonArray(input.destinations.map { JsonPrimitive(it) }))
                        put("passengers", input.passengers)
                        put("durationDays", input.durationDays)
                        input.preferredVehicleType?.let { put("preferredVehicleType", it) }
                    },
                )
            }
        }
        return api.post("/requirements", body.toString(), Requirement.serializer())
    }

    /** Choose a bid. Once nothing is outstanding this creates the order or booking. */
    suspend fun award(requirementId: String, bidId: String): Awarded? =
        api.post(
            "/requirements/$requirementId/award",
            buildJsonObject { put("bidId", bidId) }.toString(),
            Awarded.serializer(),
        )

    suspend fun cancel(requirementId: String, reason: String) {
        api.post("/requirements/$requirementId/cancel", buildJsonObject { put("reason", reason) }.toString(), Requirement.serializer())
    }

    companion object {
        const val KIND_MATERIAL = "MATERIAL_SUPPLY"
        const val KIND_FREIGHT = "FREIGHT_TRANSPORT"
        const val KIND_CAB = "CAB_HIRE"
        const val KIND_TOUR = "TOUR_PACKAGE"
        const val SCOPE_TRANSPORT = "TRANSPORT"
        const val SCOPE_TRAVEL = "TRAVEL"
        const val SCOPE_MATERIAL = "MATERIAL"

        /** The scope a fleet or operator bids with on a kind of job. */
        fun scopeFor(kind: String): String = if (kind == KIND_CAB || kind == KIND_TOUR) SCOPE_TRAVEL else SCOPE_TRANSPORT

        fun unitWord(unit: String?): String = when (unit) {
            "TON" -> "t"
            "KG" -> "kg"
            "BAG" -> "bags"
            "CUBIC_METER" -> "m³"
            "PIECE" -> "pieces"
            "LITRE" -> "L"
            "TRIP" -> "trips"
            null -> ""
            else -> unit.lowercase().replace('_', ' ')
        }

        /** One of a unit, for "price per …": tonne, bag, piece. */
        fun unitSingular(unit: String?): String = when (unit) {
            "TON" -> "tonne"
            "KG" -> "kg"
            "BAG" -> "bag"
            "CUBIC_METER" -> "m³"
            "PIECE" -> "piece"
            "LITRE" -> "litre"
            "TRIP" -> "trip"
            null -> "unit"
            else -> unit.lowercase().replace('_', ' ')
        }

        private fun Double.clean(): String = if (this % 1.0 == 0.0) toLong().toString() else toString()
    }
}
