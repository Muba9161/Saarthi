package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Cab and tour bookings, from both sides: the operator confirms, assigns,
 * starts and finishes them; the customer pays for and can cancel theirs.
 */
class TravelApi(private val api: OwnerApi) {

    @Serializable
    data class BookingVehicle(val id: String = "", val registrationNumber: String = "", val vehicleType: String = "", val model: String? = null)

    @Serializable
    data class BookingDriver(val id: String = "", val name: String = "", val phone: String? = null)

    @Serializable
    data class Booking(
        val id: String,
        val reference: String = "",
        val status: String = "",
        val packageTitle: String? = null,
        val serviceKind: String? = null,
        val destinations: List<String> = emptyList(),
        val startDate: String = "",
        val endDate: String? = null,
        val durationDays: Int? = null,
        val passengers: Int? = null,
        val pickupAddress: String? = null,
        val dropoffAddress: String? = null,
        val distanceKm: Double? = null,
        val contactName: String? = null,
        val contactPhone: String? = null,
        /** The operator, as the customer sees it. Their number only once they have confirmed. */
        val providerName: String? = null,
        val providerPhone: String? = null,
        val declineReason: String? = null,
        val cancellationReason: String? = null,
        val specialRequests: String? = null,
        val totalAmount: Double? = null,
        val paymentStatus: String? = null,
        val vehicle: BookingVehicle? = null,
        val driver: BookingDriver? = null,
        val tripId: String? = null,
        val rating: Double? = null,
        val createdAt: String = "",
    ) {
        val title: String
            get() = packageTitle?.ifBlank { null }
                ?: listOfNotNull(pickupAddress?.substringBefore(','), (dropoffAddress ?: destinations.firstOrNull())?.substringBefore(','))
                    .joinToString(" → ").ifBlank { reference }

        val open: Boolean get() = status in setOf("PENDING_PAYMENT", "AWAITING_CONFIRMATION", "CONFIRMED", "IN_PROGRESS")
    }

    suspend fun mine(): List<Booking> =
        api.get("/travel/me/bookings?pageSize=100", Page.serializer(Booking.serializer()))?.items.orEmpty()

    suspend fun get(id: String): Booking? = api.get("/travel/bookings/$id", Booking.serializer())

    /** Accept the booking, naming the vehicle and driver that will do it. */
    suspend fun confirm(id: String, vehicleId: String?, driverId: String?): Booking? {
        val body = buildJsonObject {
            vehicleId?.let { put("vehicleId", it) }
            driverId?.let { put("driverId", it) }
        }
        return api.post("/travel/bookings/$id/confirm", body.toString(), Booking.serializer())
    }

    suspend fun decline(id: String, reason: String): Booking? =
        api.post("/travel/bookings/$id/decline", buildJsonObject { put("reason", reason) }.toString(), Booking.serializer())

    /** Start the ride — with the passenger's pickup code when the ride has one. */
    suspend fun start(id: String, handoverCode: String? = null): Booking? =
        api.post(
            "/travel/bookings/$id/start",
            buildJsonObject { handoverCode?.let { put("handoverCode", it) } }.toString(),
            Booking.serializer(),
        )

    suspend fun complete(id: String): Booking? = api.post("/travel/bookings/$id/complete", "{}", Booking.serializer())

    // --- The customer's side -------------------------------------------------

    @Serializable
    private data class PayReply(val checkout: PaymentsApi.CheckoutSession? = null)

    /** Bookings this customer made, newest first. */
    suspend fun booked(): List<Booking> =
        api.get("/travel/bookings?pageSize=50", Page.serializer(Booking.serializer()))?.items.orEmpty()

    /**
     * Open the payment for a booking. Null when nothing is left to pay — a
     * checkout opened earlier was paid since.
     */
    suspend fun pay(id: String): PaymentsApi.CheckoutSession? =
        api.post("/travel/bookings/$id/pay", buildJsonObject { put("method", "ONLINE") }.toString(), PayReply.serializer())?.checkout

    suspend fun cancel(id: String, reason: String): Booking? =
        api.post("/travel/bookings/$id/cancel", buildJsonObject { put("reason", reason) }.toString(), Booking.serializer())

    companion object {
        /** What a customer may still cancel; the server holds the same list. */
        val CANCELLABLE = setOf("PENDING_PAYMENT", "AWAITING_CONFIRMATION", "CONFIRMED")
    }
}
