package com.saarthi.owner.network

import com.saarthi.owner.R
import com.saarthi.owner.ui.common.Words
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Trips travel operators publish, as a customer finds and books them on the
 * web's /travel pages: browse, read one, see its price for a party, book it,
 * and rate it once it is over.
 *
 * A booking starts unpaid; paying is the next step, on the booking itself.
 */
class TravelPackagesApi(private val api: OwnerApi) {

    @Serializable
    data class Provider(
        val id: String = "",
        val displayName: String = "",
        val ratingAverage: Double = 0.0,
        val ratingCount: Int = 0,
        val verificationStatus: String = "",
    )

    @Serializable
    data class Day(
        val dayNumber: Int = 0,
        val title: String = "",
        val description: String? = null,
        val highlights: List<String> = emptyList(),
        val overnightAt: String? = null,
    )

    @Serializable
    data class Refund(val hoursBefore: Int = 0, val refundPercent: Int = 0)

    @Serializable
    data class PackageVehicle(val registrationNumber: String = "", val model: String? = null)

    @Serializable
    data class Package(
        val id: String,
        val provider: Provider? = null,
        val title: String = "",
        val summary: String = "",
        val description: String? = null,
        val serviceKind: String = "",
        val destinations: List<String> = emptyList(),
        val startLocation: String = "",
        val endLocation: String? = null,
        val durationDays: Int = 1,
        val durationNights: Int? = null,
        val approxDistanceKm: Double? = null,
        val vehicleType: String = "",
        val vehicle: PackageVehicle? = null,
        val minPassengers: Int = 1,
        val maxPassengers: Int = 1,
        val pricingModel: String = "FIXED_PACKAGE",
        val basePrice: Double = 0.0,
        val fromPrice: Double = 0.0,
        val inclusions: List<String> = emptyList(),
        val exclusions: List<String> = emptyList(),
        val itinerary: List<Day> = emptyList(),
        val cancellationPolicy: List<Refund>? = null,
        val advanceBookingDays: Int = 0,
        /** 0 is Sunday; empty means any day. */
        val availableWeekdays: List<Int> = emptyList(),
        val availableFrom: String? = null,
        val availableTo: String? = null,
        val driverIncluded: Boolean = true,
        val fuelIncluded: Boolean = false,
        val ratingAverage: Double = 0.0,
        val ratingCount: Int = 0,
    ) {
        /** A per-kilometre trip is priced on where it ends, so the drop is needed. */
        val needsDropoff: Boolean get() = pricingModel == "PER_KM"
    }

    @Serializable
    data class Quote(val subtotal: Double = 0.0, val platformFee: Double = 0.0, val total: Double = 0.0)

    class NewBooking(
        val packageId: String,
        /** When the trip starts, as an ISO instant; at least four hours ahead. */
        val startAt: String,
        val passengers: Int,
        val contactName: String,
        val contactPhone: String,
        val pickup: PlacesApi.Place?,
        val dropoff: PlacesApi.Place?,
        val specialRequests: String?,
    )

    suspend fun packages(search: String, serviceKind: String?, passengers: Int?, sortBy: String, page: Int): Page<Package> {
        val query = buildString {
            append("page=$page&pageSize=$PAGE_SIZE&sortBy=$sortBy&sortOrder=${if (sortBy == "price" || sortBy == "duration") "asc" else "desc"}")
            search.trim().takeIf { it.isNotEmpty() }?.let { append("&search=${java.net.URLEncoder.encode(it.take(160), "UTF-8")}") }
            serviceKind?.let { append("&serviceKind=$it") }
            passengers?.let { append("&passengers=$it") }
        }
        return api.get("/travel/packages?$query", Page.serializer(Package.serializer())) ?: Page()
    }

    suspend fun get(id: String): Package? = api.get("/travel/packages/$id", Package.serializer())

    suspend fun quote(packageId: String, passengers: Int, dropoff: PlacesApi.Place?): Quote? =
        api.get(
            "/travel/quote?packageId=$packageId&passengers=$passengers" +
                (dropoff?.let { "&dropoffLatitude=${it.latitude}&dropoffLongitude=${it.longitude}" } ?: ""),
            Quote.serializer(),
        )

    suspend fun book(input: NewBooking): TravelApi.Booking? {
        val body = buildJsonObject {
            put("packageId", input.packageId)
            put("startDate", input.startAt)
            put("passengers", input.passengers)
            put("contactName", input.contactName.trim().take(160))
            put("contactPhone", input.contactPhone.trim())
            input.pickup?.let {
                put("pickupAddress", it.address.take(300))
                put("pickupLatitude", it.latitude)
                put("pickupLongitude", it.longitude)
            }
            // The drop goes as all three, or not at all.
            input.dropoff?.let {
                put("dropoffAddress", it.address.take(300))
                put("dropoffLatitude", it.latitude)
                put("dropoffLongitude", it.longitude)
            }
            input.specialRequests?.ifBlank { null }?.let { put("specialRequests", it.take(2000)) }
        }
        return api.post("/travel/bookings", body.toString(), TravelApi.Booking.serializer())
    }

    /** Rate a finished trip, once: stars, and a few words if the customer has them. */
    suspend fun rate(bookingId: String, stars: Int, comment: String?): TravelApi.Booking? {
        val body = buildJsonObject {
            put("rating", stars)
            comment?.ifBlank { null }?.let { put("comment", it.take(2000)) }
        }
        return api.post("/travel/bookings/$bookingId/rate", body.toString(), TravelApi.Booking.serializer())
    }

    companion object {
        const val PAGE_SIZE = 20

        const val CAN_BROWSE = "travel.browse"
        const val CAN_BOOK = "bookings.create"
        const val CAN_RATE = "bookings.rate"
        const val FEATURE = "travel.bookings"

        /** The earliest a trip can start, as the server's `MIN_BOOKING_LEAD_HOURS`. */
        const val LEAD_HOURS = 4L

        val KINDS: List<Pair<String, String>>
            get() = listOf(
                "LOCAL_SIGHTSEEING" to Words.get(R.string.net_travel_kind_sightseeing),
                "INTERCITY" to Words.get(R.string.net_travel_kind_intercity),
                "MULTI_DAY_TOUR" to Words.get(R.string.net_travel_kind_tours),
                "AIRPORT_TRANSFER" to Words.get(R.string.net_travel_kind_airport),
                "PILGRIMAGE" to Words.get(R.string.net_travel_kind_pilgrimage),
                "CUSTOM_TRIP" to Words.get(R.string.net_travel_kind_custom),
            )

        fun kindWord(kind: String): String =
            KINDS.firstOrNull { it.first == kind }?.second ?: Words.get(R.string.net_travel_kind_trip)

        fun vehicleWord(type: String): String = when (type) {
            "TAXI" -> Words.get(R.string.net_travel_vehicle_taxi)
            "CAR" -> Words.get(R.string.net_travel_vehicle_car)
            "SUV" -> "SUV"
            "VAN" -> Words.get(R.string.net_travel_vehicle_van)
            "BUS" -> Words.get(R.string.net_travel_vehicle_bus)
            "TEMPO" -> Words.get(R.string.net_travel_vehicle_tempo)
            else -> type.lowercase().replaceFirstChar { it.uppercase() }
        }
    }
}
