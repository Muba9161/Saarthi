package com.saarthi.core.network

import kotlinx.serialization.Serializable

/**
 * The things a driver needs that only a browser could reach.
 *
 * Each of these already existed on the platform and was visible only to a fleet
 * manager at a desk: the FASTag balance, the papers a checkpoint asks for,
 * today's diesel rate, the driver's own trip history, and the notifications the
 * server had been writing for them all along.
 *
 * Every nullable field here is nullable because the answer is genuinely
 * sometimes unknown, and none of them defaults to a number. A FASTag balance
 * the bank has not reported is not zero; a distance not yet driven is not zero;
 * a diesel rate for a district nobody publishes is not zero. A driver spends
 * money and makes decisions against these, and an invented figure is worse than
 * a dash.
 */

@Serializable
data class DriverPaperDto(
    val id: String,
    /** `TRUCK` or `DRIVER` — whose paper this is. */
    val ownerType: String,
    val documentType: String,
    val title: String? = null,
    val number: String? = null,
    val expiryDate: String? = null,
    val verificationStatus: String,
    /** Negative once expired. Null when no expiry was ever recorded. */
    val daysToExpiry: Int? = null,
    val mimeType: String? = null,
    val sizeBytes: Long? = null,
)

@Serializable
data class FastagDto(
    val tagId: String? = null,
    val issuerBank: String? = null,
    val status: String,
    val balanceRupees: Double? = null,
    /**
     * Only ever true for a real balance against a real threshold.
     *
     * Unknown is not low. Colouring an unknown balance red would teach drivers
     * to ignore the colour, and the colour is the whole point.
     */
    val lowBalance: Boolean = false,
    val balanceUpdatedAt: String? = null,
)

@Serializable
data class FuelPriceDto(
    val city: String,
    val state: String? = null,
    /** Rupees per litre. */
    val diesel: Double? = null,
    val petrol: Double? = null,
    /** Rupees per kilogram — CNG is sold by weight. */
    val cng: Double? = null,
    /**
     * The date the publisher stamped on it, never the clock.
     *
     * So a screen can say "yesterday's rate" rather than implying it is today's.
     */
    val publishedOn: String? = null,
    val source: String = "",
)

@Serializable
data class DriverTripDto(
    val id: String,
    val reference: String? = null,
    val status: String,
    val registrationNumber: String? = null,
    val startedAt: String? = null,
    val completedAt: String? = null,
    val distanceKm: Double? = null,
    /** True when [distanceKm] is the plan rather than what was driven. */
    val distanceIsPlanned: Boolean = false,
    val fromLabel: String? = null,
    val toLabel: String? = null,
)

@Serializable
data class DriverNotificationDto(
    val id: String,
    val type: String,
    val title: String,
    val body: String? = null,
    val readAt: String? = null,
    val createdAt: String,
)

@Serializable
data class DriverNotificationsDto(
    val items: List<DriverNotificationDto> = emptyList(),
    val unread: Int = 0,
)

@Serializable
data class MarkNotificationsRequest(
    /** Empty means "all of them" — see the server schema for why. */
    val ids: List<String> = emptyList(),
)

@Serializable
data class MarkNotificationsResponse(val read: Int = 0)

@Serializable
data class FuelSlipResponse(val id: String)
