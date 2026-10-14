package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Handover codes — the customer's 4-digit code the driver enters to finish a
 * delivery or start a ride. The customer reads theirs; the fleet sees only
 * whether it was entered, and the owner may clear it with a written reason.
 */
class HandoverApi(private val api: OwnerApi) {

    @Serializable
    data class Handover(
        /** DELIVERY or PICKUP. */
        val purpose: String = "",
        /** PENDING, VERIFIED or OVERRIDDEN. */
        val status: String = "",
        val attemptsLeft: Int = 0,
        val verifiedAt: String? = null,
        val overriddenAt: String? = null,
        val overrideReason: String? = null,
        /** The customer's own view only, and only while it is still needed. */
        val code: String? = null,
    ) {
        val pending: Boolean get() = status == "PENDING"
    }

    /** The customer's delivery code for one of their orders, if the goods have set off. */
    suspend fun forOrder(orderId: String): Handover? = api.get("/handover/orders/$orderId", Handover.serializer())

    /** The passenger's pickup code for one of their bookings, once it is confirmed. */
    suspend fun forBooking(bookingId: String): Handover? = api.get("/handover/bookings/$bookingId", Handover.serializer())

    /** Whether the codes on a trip were entered — for the fleet running it. */
    suspend fun forTrip(tripId: String): List<Handover> =
        api.get("/handover/trips/$tripId", ListSerializer(Handover.serializer())).orEmpty()

    /** The owner clears a handover the customer could not give the code for. The reason is kept on record. */
    suspend fun override(tripId: String, purpose: String, reason: String): Handover? =
        api.post(
            "/handover/trips/$tripId/override",
            buildJsonObject {
                put("purpose", purpose)
                put("reason", reason)
            }.toString(),
            Handover.serializer(),
        )

    companion object {
        const val DELIVERY = "DELIVERY"
        const val PICKUP = "PICKUP"
    }
}
