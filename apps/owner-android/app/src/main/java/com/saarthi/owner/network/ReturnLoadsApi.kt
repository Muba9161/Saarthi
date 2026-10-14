package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Backhaul: loads for a truck that would otherwise drive home empty. */
class ReturnLoadsApi(private val api: OwnerApi) {

    /** A trip arriving soon with nothing lined up for the way back. */
    @Serializable
    data class EmptyRisk(
        val tripId: String,
        val tripReference: String = "",
        val truckId: String = "",
        val truckRegistration: String = "",
        val driverName: String? = null,
        val destinationAddress: String = "",
        val arrivingAt: String? = null,
        val emptyReturnKm: Double? = null,
        val hasReturnLoad: Boolean = false,
        val matchCount: Int = 0,
    )

    /** A load on the way back, scored against the truck's return leg. */
    @Serializable
    data class Opportunity(
        val id: String,
        val requestId: String = "",
        val truckRegistration: String = "",
        val orderReference: String = "",
        val materialName: String = "",
        val quantity: Double = 0.0,
        val unit: String = "",
        val originAddress: String = "",
        val destinationAddress: String = "",
        val pickupAt: String? = null,
        val deliverBy: String? = null,
        val status: String = "",
        val score: Double = 0.0,
        val distanceToPickupKm: Double = 0.0,
        val detourKm: Double = 0.0,
        val estimatedRevenue: Double? = null,
        val emptyKmSaved: Double? = null,
        val reasons: List<String> = emptyList(),
        val quoteId: String? = null,
        val createdAt: String = "",
    )

    @Serializable
    private data class Quoted(val quoteId: String = "", val orderId: String = "")

    suspend fun emptyRisk(): List<EmptyRisk> =
        api.get("/return-loads/empty-risk", ListSerializer(EmptyRisk.serializer())).orEmpty()

    suspend fun opportunities(): List<Opportunity> =
        api.get("/return-loads/opportunities", ListSerializer(Opportunity.serializer())).orEmpty()

    /** Quote the customer for a matched load. The order's owner sees it like any other quote. */
    suspend fun quote(matchId: String, price: Double, message: String?) {
        val body = buildJsonObject {
            put("price", price)
            message?.ifBlank { null }?.let { put("message", it) }
        }
        api.post("/return-loads/matches/$matchId/quote", body.toString(), Quoted.serializer())
    }
}
