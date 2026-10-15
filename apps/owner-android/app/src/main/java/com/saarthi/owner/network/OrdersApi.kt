package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Marketplace orders and their money, as each side sees them.
 *
 * The server shapes an order for whoever is looking — a seller never sees the
 * customer, a customer never sees the seller — so every field a side may not
 * see is optional here and simply absent for it.
 */
class OrdersApi(private val api: OwnerApi) {

    @Serializable
    data class Ref(val id: String = "", val registrationNumber: String = "", val name: String = "")

    @Serializable
    data class Order(
        val id: String,
        val reference: String = "",
        val status: String = "",
        val customerName: String? = null,
        val supplierName: String? = null,
        val fleetName: String? = null,
        val materialName: String? = null,
        val quantity: Double? = null,
        val unit: String? = null,
        val materialPrice: Double? = null,
        val transportPrice: Double? = null,
        val totalPrice: Double? = null,
        val originAddress: String? = null,
        val originLatitude: Double? = null,
        val originLongitude: Double? = null,
        val destinationAddress: String? = null,
        val destinationLatitude: Double? = null,
        val destinationLongitude: Double? = null,
        val distanceKm: Double? = null,
        val requiredCapacityTons: Double? = null,
        val requiredTruckType: String? = null,
        val pickupAt: String? = null,
        val deliverBy: String? = null,
        val assignedTruck: Ref? = null,
        val assignedDriver: Ref? = null,
        val tripId: String? = null,
        /** The customer's own words on the requirement. */
        val notes: String? = null,
        val cancellationReason: String? = null,
        val createdAt: String = "",
    ) {
        val what: String
            get() = listOfNotNull(
                quantity?.let { "${if (it % 1.0 == 0.0) it.toLong() else it} ${RequirementsApi.unitWord(unit)}".trim() },
                materialName,
            ).joinToString(" ").ifBlank { reference }

        val open: Boolean get() = status !in setOf("COMPLETED", "CANCELLED", "FAILED")
    }

    @Serializable
    data class Payment(val stage: String = "", val amount: Double = 0.0, val status: String = "", val reference: String = "", val at: String = "")

    @Serializable
    data class ProviderMoney(
        val procurementReference: Double? = null,
        val procurementAmount: Double? = null,
        val commissionRate: Double = 0.0,
        val commissionAmount: Double = 0.0,
        val netAfterCommission: Double = 0.0,
        val final: Boolean = false,
    )

    @Serializable
    data class SupplierMoney(val procurementAmount: Double? = null)

    /** Null for an order with no marketplace payment plan. */
    @Serializable
    data class Finance(
        val orderId: String = "",
        val stage: String = "",
        val role: String = "",
        val agreedAmount: Double? = null,
        val confirmationAmount: Double? = null,
        val orderedQuantity: Double = 0.0,
        val deliveredQuantity: Double? = null,
        val finalAmount: Double? = null,
        val balanceDue: Double? = null,
        val payments: List<Payment> = emptyList(),
        val provider: ProviderMoney? = null,
        val supplier: SupplierMoney? = null,
    )

    @Serializable
    private data class CheckoutReply(val checkout: PaymentsApi.CheckoutSession? = null)

    suspend fun list(): List<Order> =
        api.get("/orders?pageSize=50", Page.serializer(Order.serializer()))?.items.orEmpty()

    suspend fun get(id: String): Order? = api.get("/orders/$id", Order.serializer())

    suspend fun finance(id: String): Finance? = api.get("/orders/$id/finance", Finance.serializer())

    /** Customer: the 30% that confirms the order. */
    suspend fun payConfirmation(id: String): PaymentsApi.CheckoutSession? =
        api.post("/orders/$id/finance/confirmation-payment", "{}", CheckoutReply.serializer())?.checkout

    /** Fleet: paying the seller for the material, at the listing's price unless agreed otherwise. */
    suspend fun payProcurement(id: String): PaymentsApi.CheckoutSession? =
        api.post("/orders/$id/finance/procurement-payment", "{}", CheckoutReply.serializer())?.checkout

    /** Customer: what actually arrived — it settles the final amount. */
    suspend fun confirmDelivery(id: String, deliveredQuantity: Double, note: String?) {
        val body = buildJsonObject {
            put("deliveredQuantity", deliveredQuantity)
            note?.ifBlank { null }?.let { put("note", it) }
        }
        api.post("/orders/$id/finance/delivery", body.toString(), Finance.serializer())
    }

    /** Customer: the balance after delivery. */
    suspend fun payFinal(id: String): PaymentsApi.CheckoutSession? =
        api.post("/orders/$id/finance/final-payment", "{}", CheckoutReply.serializer())?.checkout

    companion object {
        const val STAGE_30_REQUIRED = "PAYMENT_30_REQUIRED"
        const val STAGE_30_PAID = "PAYMENT_30_PAID"
        const val STAGE_PROCUREMENT_PAID = "PROCUREMENT_PAID"
        const val STAGE_70_REQUIRED = "PAYMENT_70_REQUIRED"
        const val STAGE_70_PAID = "PAYMENT_70_PAID"
        const val STAGE_FINALIZED = "FINALIZED"
    }
}
