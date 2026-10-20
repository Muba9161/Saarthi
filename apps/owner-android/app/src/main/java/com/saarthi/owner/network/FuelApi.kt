package com.saarthi.owner.network

import com.saarthi.owner.R
import com.saarthi.owner.ui.common.Words
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * What the business spends on the road, as the web's Fuel and Expenses tabs
 * read it: fill-ups (which the owner may also log), and the slips drivers file
 * from the cab — tolls paid in cash, parking, repairs, food, loading, challans.
 */
class FuelApi(private val api: OwnerApi) {

    @Serializable
    data class FillUp(
        val id: String,
        val truckId: String = "",
        val registrationNumber: String = "",
        val quantityLitres: Double = 0.0,
        val pricePerUnit: Double = 0.0,
        val totalCost: Double = 0.0,
        val odometerKm: Double? = null,
        val stationName: String? = null,
        val recordedAt: String = "",
    )

    @Serializable
    data class FuelTotals(val litres: Double = 0.0, val cost: Double = 0.0, val averagePricePerLitre: Double? = null)

    /** A page of fill-ups with the totals over every fill-up the filter matches. */
    @Serializable
    data class FuelPage(
        val items: List<FillUp> = emptyList(),
        val pagination: Pagination = Pagination(),
        val totals: FuelTotals = FuelTotals(),
    )

    /** One slip a driver filed: what it was for, how much, and the photo it was filed with. */
    @Serializable
    data class Slip(
        val id: String,
        val truckId: String = "",
        val registrationNumber: String = "",
        val tripId: String? = null,
        val tripReference: String? = null,
        val driverName: String? = null,
        val category: String = "OTHER",
        val amount: Double = 0.0,
        val vendorName: String? = null,
        val notes: String? = null,
        val recordedAt: String = "",
        val photoId: String? = null,
    )

    @Serializable
    data class SlipTotals(val amount: Double = 0.0, val byCategory: Map<String, Double> = emptyMap())

    @Serializable
    data class SlipPage(
        val items: List<Slip> = emptyList(),
        val pagination: Pagination = Pagination(),
        val totals: SlipTotals = SlipTotals(),
    )

    @Serializable
    private data class Created(val id: String)

    class NewFillUp(
        val vehicleId: String,
        val litres: Double,
        val pricePerLitre: Double,
        val odometerKm: Double?,
        val station: String?,
        /** When the slip says it was filled, as an ISO instant; now when unknown. */
        val recordedAt: String?,
    )

    suspend fun fillUps(vehicleId: String?, page: Int): FuelPage =
        api.get("/fuel?page=$page&pageSize=$PAGE_SIZE${vehicleId?.let { "&truckId=$it" }.orEmpty()}", FuelPage.serializer()) ?: FuelPage()

    /** Log a fill-up; the server works out the total and files it against the trip the vehicle is on. */
    suspend fun logFillUp(input: NewFillUp): FillUp? {
        val body = buildJsonObject {
            put("truckId", input.vehicleId)
            put("quantityLitres", input.litres)
            put("pricePerUnit", input.pricePerLitre)
            input.odometerKm?.let { put("odometerKm", it) }
            input.station?.ifBlank { null }?.let { put("stationName", it.take(160)) }
            input.recordedAt?.let { put("recordedAt", it) }
        }
        return api.post("/fuel", body.toString(), FillUp.serializer())
    }

    /** The pump slip a fill-up was read from, kept with it as its evidence. */
    suspend fun attachSlip(fillUpId: String, file: OwnerApi.Upload) {
        val fields = mapOf("ownerType" to "FUEL_RECORD", "ownerId" to fillUpId, "purpose" to "ATTACHMENT")
        api.upload("/media", fields, "file", file, Created.serializer())
    }

    /** What fuel and road slips came to since [from] (an ISO instant), fleet-wide: the totals alone. */
    suspend fun spentSince(from: String): Double {
        val since = java.net.URLEncoder.encode(from, "UTF-8")
        val fuel = api.get("/fuel?pageSize=1&from=$since", FuelPage.serializer())?.totals?.cost ?: 0.0
        val slips = api.get("/fleet/expenses?pageSize=1&from=$since", SlipPage.serializer())?.totals?.amount ?: 0.0
        return fuel + slips
    }

    suspend fun slips(vehicleId: String?, category: String?, page: Int): SlipPage =
        api.get(
            "/fleet/expenses?page=$page&pageSize=$PAGE_SIZE" +
                vehicleId?.let { "&truckId=$it" }.orEmpty() +
                category?.let { "&category=$it" }.orEmpty(),
            SlipPage.serializer(),
        ) ?: SlipPage()

    suspend fun slipPhoto(photoId: String, thumbnail: Boolean): ByteArray? =
        api.image("/api/v1/media/$photoId/file?variant=${if (thumbnail) "thumb" else "original"}")

    companion object {
        const val PAGE_SIZE = 25

        const val CAN_READ = "fuel.read"
        const val CAN_LOG = "fuel.manage"

        /** The categories a slip is filed under, in the web's words. */
        val SLIP_CATEGORIES: List<Pair<String, String>>
            get() = listOf(
                "TOLL" to Words.get(R.string.net_slip_toll),
                "PARKING" to Words.get(R.string.net_slip_parking),
                "REPAIR" to Words.get(R.string.net_slip_repair),
                "FOOD" to Words.get(R.string.net_slip_food),
                "LOADING" to Words.get(R.string.net_slip_loading),
                "CHALLAN" to Words.get(R.string.net_slip_challan),
                "OTHER" to Words.get(R.string.net_slip_other),
            )

        fun categoryWord(category: String): String =
            SLIP_CATEGORIES.firstOrNull { it.first == category }?.second ?: Words.get(R.string.net_slip_other)
    }
}
