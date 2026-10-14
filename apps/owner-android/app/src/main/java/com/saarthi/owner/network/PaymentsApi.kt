package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

/**
 * Cashfree, as Saarthi's API hands it out.
 *
 * Only for the marketplace — an order's advance, a booking, paying a seller —
 * which Google Play allows outside its own billing because they are real-world
 * goods and services. Plans and renewals are never paid here.
 */
class PaymentsApi(private val api: OwnerApi) {

    /** A checkout the API opened with Cashfree. Null from an API on the mock gateway: already settled. */
    @Serializable
    data class CheckoutSession(
        val provider: String = "cashfree",
        val mode: String = "sandbox",
        val kind: String = "payment",
        val sessionId: String,
        val reference: String,
    )

    @Serializable
    data class PaymentState(val reference: String = "", val status: String = "PENDING")

    /** One settled payment, with everything its receipt prints. */
    @Serializable
    data class Receipt(
        val reference: String,
        val purpose: String = "",
        val status: String = "",
        val method: String = "",
        val amount: Double = 0.0,
        val refundedAmount: Double = 0.0,
        val currency: String = "INR",
        val provider: String = "",
        val providerReference: String? = null,
        val paidAt: String = "",
        val payerName: String? = null,
        val payeeName: String? = null,
        val forReference: String? = null,
    )

    /** This business's own settled payments on one booking or one order. */
    suspend fun receipts(bookingId: String? = null, orderId: String? = null): List<Receipt> {
        val query = if (bookingId != null) "bookingId=$bookingId" else "orderId=$orderId"
        return api.get("/payments/receipts?$query", ListSerializer(Receipt.serializer())).orEmpty()
    }

    /** Ask the API — which asks Cashfree — how a payment actually ended. */
    suspend fun confirm(reference: String): String =
        api.post("/payments/${java.net.URLEncoder.encode(reference, "UTF-8")}/confirm", "{}", PaymentState.serializer())
            ?.status ?: "PENDING"
}
