package com.saarthi.core.network

import kotlinx.serialization.Serializable

/*
 * The driver's shift: the covered path, trips the driver adds, and the papers
 * wallet. Every field that can genuinely be unknown is nullable and none of
 * them defaults to a number — the same rule as `DriverExtrasDto.kt`.
 */

/** One point of the covered path, as the server judged it. */
@Serializable
data class TrailPointDto(
    val latitude: Double,
    val longitude: Double,
    /** `NO_TRIP`, `ON_ROUTE` or `OFF_ROUTE`. */
    val routeState: String = "NO_TRIP",
    val recordedAt: String = "",
)

/** One end of a trip the driver adds. */
@Serializable
data class TripPlaceDto(
    val name: String,
    val address: String? = null,
    val latitude: Double,
    val longitude: Double,
)

@Serializable
data class CreateTripRequest(
    val origin: TripPlaceDto,
    val destination: TripPlaceDto,
    /** ISO-8601. Absent means "as soon as the vehicle is free". */
    val plannedStartAt: String? = null,
    val notes: String? = null,
    /** The road route between the two ends, so the trip has a real plan. */
    val plannedRoute: List<RoutePointDto>? = null,
)

@Serializable
data class CreatedTripDto(
    val id: String,
    val reference: String = "",
    val status: String = "",
    /** True when a fleet trip holds the vehicle and this one waits behind it. */
    val queued: Boolean = false,
)

// ---------------------------------------------------------------------------
// Papers wallet
// ---------------------------------------------------------------------------

/** A folder, filed the way the fleet's web Documents tab files it. */
@Serializable
data class PaperFolderDto(
    /** A document type code, or `PHOTOS`, `QR`, `OTHER`. */
    val id: String,
    /** `PAPER`, `PHOTOS`, `QR` or `OTHER`. */
    val kind: String,
    /** `TRUCK` or `DRIVER`. */
    val ownerType: String,
    val label: String,
    val mandatory: Boolean = false,
    /** `MISSING`, `OPTIONAL`, `VALID`, `EXPIRING_SOON`, `EXPIRED`, `REJECTED`, `ON_FILE`. */
    val status: String? = null,
    val documentIds: List<String> = emptyList(),
    val count: Int = 0,
    /** The date the RTO register gives for this paper, when it gives one. */
    val registerValidUntil: String? = null,
)

/** The RTO register's RC, masked for a driver: owner, chassis and engine are partial. */
@Serializable
data class VirtualRcDto(
    val registrationNumber: String,
    val retrievedAt: String,
    val dataAsOf: String? = null,
    val verified: Boolean = false,
    val registrationDate: String? = null,
    val registrationStatus: String? = null,
    val ownerName: String? = null,
    val maker: String? = null,
    val model: String? = null,
    val variant: String? = null,
    val vehicleClass: String? = null,
    val vehicleCategory: String? = null,
    val bodyType: String? = null,
    val fuelType: String? = null,
    val color: String? = null,
    val emissionNorms: String? = null,
    val manufacturedOn: String? = null,
    val chassisNumber: String? = null,
    val engineNumber: String? = null,
    val rto: String? = null,
    val seatingCapacity: Int? = null,
    val grossVehicleWeight: Double? = null,
    val unladenWeight: Double? = null,
    val financer: String? = null,
    val insurer: String? = null,
    val insurancePolicyNumber: String? = null,
    val insuranceValidUntil: String? = null,
    val puccNumber: String? = null,
    val puccValidUntil: String? = null,
    val fitnessValidUntil: String? = null,
    val taxValidUntil: String? = null,
    val permitNumber: String? = null,
    val permitType: String? = null,
    val permitValidUntil: String? = null,
    val nationalPermitValidUntil: String? = null,
    val blacklistStatus: String? = null,
)

/** The driver's own licence, in full. */
@Serializable
data class LicenceCardDto(
    val licenceNumber: String? = null,
    /** `RTO` when read from the register; `PROFILE` when only the driver's entry exists. */
    val source: String = "PROFILE",
    val retrievedAt: String? = null,
    val holderName: String? = null,
    val dateOfBirth: String? = null,
    val bloodGroup: String? = null,
    val state: String? = null,
    val issuingAuthority: String? = null,
    val issuedOn: String? = null,
    val validUntil: String? = null,
    val transportValidUntil: String? = null,
    val vehicleClasses: List<String> = emptyList(),
    val verified: Boolean = false,
)

@Serializable
data class VehiclePhotoDto(
    val id: String,
    val caption: String? = null,
    val mimeType: String = "image/jpeg",
    val width: Int? = null,
    val height: Int? = null,
    val hasThumbnail: Boolean = false,
)

@Serializable
data class PapersWalletDto(
    val folders: List<PaperFolderDto> = emptyList(),
    val documents: List<DriverPaperDto> = emptyList(),
    val rc: VirtualRcDto? = null,
    val licence: LicenceCardDto? = null,
    val photos: List<VehiclePhotoDto> = emptyList(),
)

/** `GOOGLE_MAPS`, or null for Saarthi's own navigation. */
@Serializable
data class NavigationHandoffRequest(val app: String?)

/** One of the driver's own trips waiting to start — `TerminalQueuedTripView`. */
@Serializable
data class QueuedTripDto(
    val id: String,
    val reference: String? = null,
    /** From 1, in the order the trips will run. */
    val position: Int = 0,
    val fromLabel: String? = null,
    val toLabel: String? = null,
    /** Where it ends — where a trip added after it starts. */
    val toLatitude: Double? = null,
    val toLongitude: Double? = null,
    val plannedDistanceKm: Double? = null,
    /** This trip holds the vehicle: it is the one that starts next. */
    val upNext: Boolean = false,
    /** It starts where the trip before it ends, so its start moves with the order. */
    val chained: Boolean = false,
)

/** The trip the queue runs after: one under way, or the fleet's, which comes first. */
@Serializable
data class QueueBehindDto(val reference: String? = null, val toLabel: String? = null)

/** A shorter order for the driver's trips, worth asking about. */
@Serializable
data class QueueSuggestionDto(
    val order: List<String> = emptyList(),
    val currentKm: Double = 0.0,
    val suggestedKm: Double = 0.0,
    val savedKm: Double = 0.0,
    /** Straight-line distances, because road ones could not be had. */
    val estimated: Boolean = false,
)

/** `TerminalTripQueueView`: the driver's trips that have not started, in their order. */
@Serializable
data class TripQueueDto(
    val behind: QueueBehindDto? = null,
    val trips: List<QueuedTripDto> = emptyList(),
    val suggestion: QueueSuggestionDto? = null,
)

/** Run the driver's trips in this order: every one of them, exactly once. */
@Serializable
data class TripQueueOrderRequest(
    val tripIds: List<String>,
    val latitude: Double? = null,
    val longitude: Double? = null,
)
