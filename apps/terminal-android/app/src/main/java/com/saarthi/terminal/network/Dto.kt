package com.saarthi.terminal.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * The Saarthi wire contract, as Kotlin.
 *
 * These mirror `packages/shared/src/domain/terminal.ts` and
 * `packages/shared/src/validation/terminal.ts`, which are the source of truth.
 * Every class is `ignoreUnknownKeys`-tolerant through the shared `Json`
 * configuration, so a server that adds a field does not break a terminal that
 * has not been updated — which matters here more than usual, because a tablet
 * bolted into a truck may not be updated for a year.
 *
 * Nullability is meaningful and is not smoothed over. A `null` fuel level means
 * "this vehicle does not report fuel", which is a different statement from
 * "0%", and the UI has to be able to tell them apart. Nothing here defaults a
 * missing reading to a number.
 */

@Serializable
data class ApiEnvelope<T>(
    val success: Boolean = true,
    val data: T? = null,
    val error: ApiErrorBody? = null,
)

@Serializable
data class ApiErrorBody(
    val code: String = "UNKNOWN",
    val message: String = "Something went wrong.",
)

// ---------------------------------------------------------------------------
// Enrolment and credentials
// ---------------------------------------------------------------------------

@Serializable
data class EnrolRequest(
    val installationId: String,
    val platform: String = "ANDROID",
    val deviceModel: String? = null,
    val osVersion: String? = null,
    val appVersion: String? = null,
    /** Always VEHICLE_TERMINAL. It is what stops this device redeeming a code
     *  issued for a Saarthi Device test phone, and vice versa. */
    val deviceType: String = "VEHICLE_TERMINAL",
)

@Serializable
data class EnrolResponse(
    val deviceIdentifier: String,
    val enrolmentId: String,
    val secret: String,
    val token: IssuedToken,
    val status: String,
    val expiresAt: String,
    val nextStep: String,
)

@Serializable
data class IssuedToken(
    val accessToken: String,
    val expiresIn: Int,
    val tokenType: String = "Bearer",
)

@Serializable
data class TokenRequest(
    val deviceIdentifier: String,
    val secret: String,
)

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

/**
 * What a terminal pairing QR encodes.
 *
 * The `kind` is checked before any network call: a code for a Saarthi Device
 * test phone scans perfectly here and would otherwise cost a round trip and an
 * error nobody standing at a truck could interpret.
 */
@Serializable
data class TerminalPairingPayload(
    val v: Int = 1,
    val kind: String = "saarthi.terminal.pair",
    val api: String,
    val token: String,
)

@Serializable
data class PairRequest(
    val token: String? = null,
    val pairingCode: String? = null,
    val deviceModel: String? = null,
    val osVersion: String? = null,
    val appVersion: String? = null,
    val screenInches: Double? = null,
)

@Serializable
data class PairResponse(
    val identity: DeviceIdentity,
    val token: IssuedToken,
)

@Serializable
data class DeviceIdentity(
    val deviceId: String? = null,
    val deviceIdentifier: String,
    val paired: Boolean = false,
    val organizationId: String? = null,
    val vehicle: PairedVehicle? = null,
)

@Serializable
data class PairedVehicle(
    val id: String,
    val registrationNumber: String,
    val vehicleType: String,
    val assignedAt: String,
)

// ---------------------------------------------------------------------------
// The one screen-shaped answer
// ---------------------------------------------------------------------------

@Serializable
data class TerminalStateDto(
    val state: String,
    val terminal: TerminalIdentityDto,
    val organizationId: String? = null,
    val vehicle: TerminalVehicleDto? = null,
    val vehicleQr: TerminalVehicleQrDto? = null,
    val session: TerminalSessionDto? = null,
    val health: TerminalHealthDto? = null,
    val serverTime: String,
    val reportingIntervalSeconds: Int = 5,
    val heartbeatIntervalSeconds: Int = 30,
    val simulationAllowed: Boolean = false,
)

@Serializable
data class TerminalIdentityDto(
    val deviceId: String? = null,
    val deviceIdentifier: String,
    val status: String,
    val paired: Boolean,
    val appVersion: String? = null,
)

@Serializable
data class TerminalVehicleDto(
    val id: String,
    val registrationNumber: String,
    val vehicleType: String,
    val truckType: String,
    val manufacturer: String? = null,
    val model: String? = null,
    val year: Int? = null,
    val fuelType: String,
    val capacityTons: Double = 0.0,
    val odometerKm: Double = 0.0,
    val status: String,
    val organizationName: String = "",
)

@Serializable
data class TerminalVehicleQrDto(
    val qrCodeId: String,
    val shortLabel: String,
    val targetUrl: String,
    /** Data URI, rendered server-side so the terminal needs no QR encoder. */
    val imageDataUri: String,
    val allowPublicResolve: Boolean = false,
    val version: Int = 1,
    val issuedAt: String,
)

@Serializable
data class TerminalDriverDto(
    val driverId: String,
    val userId: String,
    val name: String,
    val photoUrl: String? = null,
    val licenseClass: String? = null,
    val licenseValidity: String = "NO_EXPIRY",
    val licenseExpiresAt: String? = null,
    val verificationStatus: String = "PENDING",
    val experienceYears: Int = 0,
    val totalTrips: Int = 0,
    val scoreBand: String? = null,
)

@Serializable
data class TerminalSessionDto(
    val id: String,
    val status: String,
    val state: String,
    val driver: TerminalDriverDto? = null,
    val vehicleId: String,
    val registrationNumber: String,
    val terminalDeviceId: String,
    val requestedAt: String,
    val submittedAt: String? = null,
    val decidedAt: String? = null,
    val decidedByName: String? = null,
    val decisionNote: String? = null,
    val rejectionReason: String? = null,
    val selfieUrl: String? = null,
    val selfieCapturedAt: String? = null,
    val expiresAt: String? = null,
    val remindedAt: String? = null,
    val escalatedAt: String? = null,
    val secondsUntilEscalation: Int? = null,
    val checklistCompletedAt: String? = null,
    val checklistOutcome: String? = null,
    val tripStartedAt: String? = null,
    val tripCompletedAt: String? = null,
)

@Serializable
data class TerminalHealthDto(
    val online: Boolean = false,
    val batteryPercent: Int? = null,
    val batteryCharging: Boolean? = null,
    val networkType: String = "UNKNOWN",
    val gpsStatus: String = "UNKNOWN",
    val cameraStatus: String = "UNKNOWN",
    val vehicleDataConnected: Boolean = false,
    val lastHeartbeatAt: String? = null,
    val lastTelemetryAt: String? = null,
)

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

@Serializable
data class ChecklistPreparationDto(
    val template: ChecklistTemplateDto,
    val items: List<ChecklistItemDto> = emptyList(),
    val telemetry: ChecklistTelemetryDto = ChecklistTelemetryDto(),
    val usesSimulatedData: Boolean = false,
)

@Serializable
data class ChecklistTemplateDto(
    val id: String? = null,
    val name: String = "Pre-trip safety check",
    val version: Int = 1,
    val isDefault: Boolean = true,
)

@Serializable
data class ChecklistItemDto(
    val code: String,
    val label: String,
    val kind: String = "MANUAL",
    /** Null when only the driver can answer. The UI then asks them. */
    val status: String? = null,
    val observedValue: Double? = null,
    val unit: String? = null,
    val metric: String? = null,
    /** True when `observedValue` came from a simulator, not a sensor. */
    val simulated: Boolean = false,
    val detail: String? = null,
    val blocking: Boolean = false,
    val required: Boolean = true,
    val manualInputRequired: Boolean = true,
)

@Serializable
data class ChecklistTelemetryDto(
    val available: Boolean = false,
    val recordedAt: String? = null,
    val metrics: List<String> = emptyList(),
    val simulatedMetrics: List<String> = emptyList(),
    val diagnosticCodes: List<DiagnosticCodeDto> = emptyList(),
)

@Serializable
data class DiagnosticCodeDto(
    val code: String,
    val description: String? = null,
)

@Serializable
data class SubmitChecklistRequest(
    val items: List<ChecklistAnswer>,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val odometerKm: Double? = null,
    val notes: String? = null,
)

@Serializable
data class ChecklistAnswer(
    val code: String,
    val status: String,
    val note: String? = null,
)

@Serializable
data class ChecklistResultDto(
    val submissionId: String,
    val outcome: String,
    val items: List<ChecklistResultItemDto> = emptyList(),
    val blockedBy: List<String> = emptyList(),
    val usedSimulatedData: Boolean = false,
)

@Serializable
data class ChecklistResultItemDto(
    val code: String,
    val label: String,
    val status: String,
    val detail: String? = null,
    val simulated: Boolean = false,
    val blocking: Boolean = false,
)

// ---------------------------------------------------------------------------
// Telemetry, heartbeat and SOS — the existing device gateway
// ---------------------------------------------------------------------------

@Serializable
data class TelemetryBatch(val frames: List<TelemetryFrame>)

/**
 * One frame.
 *
 * Real measurements and simulated ones are in separate branches, exactly as the
 * shared schema requires, so the gateway can label the stored reading honestly
 * rather than guessing which fields a tablet could plausibly have produced.
 */
@Serializable
data class TelemetryFrame(
    val eventId: String,
    val recordedAt: String,
    val sequence: Long? = null,
    val location: FrameLocation? = null,
    val motion: FrameMotion? = null,
    val health: FrameHealth? = null,
    val vehicle: FrameVehicle? = null,
    val simulated: FrameSimulated? = null,
)

@Serializable
data class FrameLocation(
    val latitude: Double,
    val longitude: Double,
    val speedKph: Double? = null,
    val heading: Double? = null,
    val altitude: Double? = null,
    val accuracy: Double? = null,
    val satellites: Int? = null,
)

@Serializable
data class FrameMotion(
    val accelerationX: Double? = null,
    val accelerationY: Double? = null,
    val accelerationZ: Double? = null,
    val harshBraking: Boolean? = null,
    val harshAcceleration: Boolean? = null,
    val suddenMovement: Boolean? = null,
)

@Serializable
data class FrameHealth(
    val signalStrength: Int? = null,
    val networkType: String? = null,
    val batteryPercent: Int? = null,
    val batteryCharging: Boolean? = null,
)

/**
 * Engine data the vehicle actually reported.
 *
 * A different object from [FrameSimulated], and deliberately so. Sending a
 * measured coolant temperature through the simulated block would have stored a
 * real reading under a label saying it was invented — which is worse than not
 * sending it, because a year later nobody can tell the two apart.
 */
@Serializable
data class FrameVehicle(
    val rpm: Double? = null,
    val engineLoad: Double? = null,
    val coolantTemperature: Double? = null,
    val intakeTemperature: Double? = null,
    val fuelLevel: Double? = null,
    val fuelRate: Double? = null,
    val throttlePosition: Double? = null,
    val batteryVoltage: Double? = null,
    val odometerKm: Double? = null,
    val vin: String? = null,
    val diagnostics: List<DiagnosticCodeDto>? = null,
)

@Serializable
data class FrameSimulated(
    val mode: String,
    val rpm: Double? = null,
    val engineLoad: Double? = null,
    val coolantTemperature: Double? = null,
    val fuelLevel: Double? = null,
    val batteryVoltage: Double? = null,
    val throttlePosition: Double? = null,
    val odometerKm: Double? = null,
    val diagnostics: List<DiagnosticCodeDto>? = null,
)

@Serializable
data class HeartbeatRequest(
    val batteryPercent: Int? = null,
    val batteryCharging: Boolean? = null,
    val networkType: String = "UNKNOWN",
    val gpsStatus: String = "UNKNOWN",
    val cameraStatus: String = "UNKNOWN",
    val bufferedEvents: Int = 0,
    val appVersion: String? = null,
    val deviceTime: String? = null,
)

@Serializable
data class IngestAck(
    val accepted: Int = 0,
    val rejected: Int = 0,
    val duplicates: Int = 0,
    val alerts: Int = 0,
    val reasons: List<String> = emptyList(),
)

@Serializable
data class SosRequest(
    val eventId: String,
    val type: String,
    val latitude: Double,
    val longitude: Double,
    val speedKph: Double? = null,
    val heading: Double? = null,
    val accuracy: Double? = null,
    val description: String? = null,
    val cameraAvailable: Boolean? = null,
    val networkType: String? = null,
    val batteryPercent: Int? = null,
    val triggeredAt: String? = null,
)

@Serializable
data class SosResponse(
    val id: String,
    val reference: String,
    val status: String,
    val type: String,
)

// ---------------------------------------------------------------------------
// Trip, issues, services and the assistant
// ---------------------------------------------------------------------------

@Serializable
data class TripEventRequest(
    val latitude: Double? = null,
    val longitude: Double? = null,
    val odometerKm: Double? = null,
    val note: String? = null,
)

@Serializable
data class EndSessionRequest(val reason: String? = null)

@Serializable
data class ReportIssueRequest(
    val category: String,
    val description: String,
    val mediaIds: List<String>? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val odometerKm: Double? = null,
)

@Serializable
data class IssueDto(
    val id: String,
    val category: String,
    val status: String,
    val severity: String,
    val description: String,
    val mediaUrls: List<String> = emptyList(),
    val registrationNumber: String,
    val driverName: String? = null,
    val createdAt: String,
    val resolvedAt: String? = null,
)

@Serializable
data class NearbyResponse(
    val service: String? = null,
    val from: RoutePointDto? = null,
    val places: List<NearbyPlaceDto> = emptyList(),
    /**
     * Whether these are road distances or straight lines.
     *
     * Stated once for the whole answer so the list can say it once at the top,
     * rather than leaving a driver to notice the wording on every row.
     */
    val roadDistancesAvailable: Boolean = false,
    /** Why not, when they are not. Shown verbatim. */
    val routingNote: String? = null,
)

/**
 * A measured distance and where the number came from.
 *
 * `basis` is the field that matters. A driver told the nearest pump is 3.2 km
 * away, when that is the crow-flies figure and the road is 11 km around a river,
 * runs out of fuel — and is then right never to trust the number again.
 */
@Serializable
data class MeasuredDistanceDto(
    val km: Double = 0.0,
    /** `ROAD` or `STRAIGHT_LINE`. */
    val basis: String = "STRAIGHT_LINE",
    /** Free-flow driving time. Null for a straight-line measurement. */
    val durationMinutes: Int? = null,
) {
    val isRoad: Boolean get() = basis == "ROAD"
}

@Serializable
data class NearbyPlaceDto(
    val id: String,
    val category: String,
    val name: String,
    val address: String? = null,
    val latitude: Double,
    val longitude: Double,
    val phone: String? = null,
    val open24Hours: Boolean = false,
    val openingHours: String? = null,
    val direction: String = "",
    /** Always present — it needs no routing provider. */
    val straightLineKm: Double = 0.0,
    /** What the driver will actually cover, road-measured where possible. */
    val distance: MeasuredDistanceDto = MeasuredDistanceDto(),
    val source: String = "",
)

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

@Serializable
data class RoutePointDto(
    val latitude: Double,
    val longitude: Double,
)

@Serializable
data class RouteRequest(
    val fromLatitude: Double,
    val fromLongitude: Double,
    val toLatitude: Double,
    val toLongitude: Double,
    val destinationName: String? = null,
    val avoidTolls: Boolean = false,
)

@Serializable
data class RouteStepDto(
    val distanceMeters: Int = 0,
    val durationSeconds: Int = 0,
    val name: String = "Unnamed road",
    val instruction: String = "Continue",
    /** `turn`, `roundabout`, `arrive`, `depart`, `fork`, `continue`. */
    val maneuver: String = "continue",
    /** `left`, `slight right`, `uturn`, … or null when not a turn. */
    val modifier: String? = null,
    val latitude: Double = 0.0,
    val longitude: Double = 0.0,
)

@Serializable
data class RouteDto(
    val distanceKm: Double = 0.0,
    /** Free-flow. There is no traffic model behind this. */
    val durationMinutes: Int = 0,
    val summary: String = "",
    /** `driving-hgv` or `driving-car` — decided by the vehicle, not the tablet. */
    val profile: String = "driving-hgv",
    val geometry: List<RoutePointDto> = emptyList(),
    val steps: List<RouteStepDto> = emptyList(),
    val destination: RouteDestinationDto,
    /** Computed server-side, so a drifted tablet clock cannot skew it. */
    val etaAt: String,
)

@Serializable
data class RouteDestinationDto(
    val name: String,
    val latitude: Double,
    val longitude: Double,
)

@Serializable
data class AskRequest(
    val question: String,
    val spokenBy: String = "VOICE",
    val latitude: Double? = null,
    val longitude: Double? = null,
    val moving: Boolean? = null,
)

@Serializable
data class AskResponse(
    val intent: String,
    val answer: String? = null,
    val action: String = "NONE",
    val sources: List<AskSource> = emptyList(),
    val caveats: List<String> = emptyList(),
    val latencyMs: Long = 0,
)

@Serializable
data class AskSource(
    val tool: String,
    val records: Int = 0,
    val cached: Boolean = false,
    val error: String? = null,
)

// ---------------------------------------------------------------------------
// Live telemetry read-back, for the cockpit gauges
// ---------------------------------------------------------------------------

@Serializable
data class LatestReadingDto(
    val recordedAt: String,
    val metrics: List<String> = emptyList(),
    val simulatedMetrics: List<String> = emptyList(),
    val latitude: Double? = null,
    val longitude: Double? = null,
    val speedKph: Double? = null,
    val heading: Double? = null,
    val rpm: Double? = null,
    val coolantTemperature: Double? = null,
    val fuelLevel: Double? = null,
    val batteryVoltage: Double? = null,
    val engineLoad: Double? = null,
    val odometerKm: Double? = null,
    val diagnostics: List<DiagnosticCodeDto> = emptyList(),
    val simulated: Boolean = false,
)

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

/**
 * A message on the device socket.
 *
 * `payload` stays as a raw [JsonElement] because this socket carries several
 * unrelated event types and a terminal only cares about two of them. Decoding
 * every payload eagerly would mean a new server-side event type could crash a
 * tablet in a truck, which is a poor trade for saving one deserialisation.
 */
@Serializable
data class SocketMessage(
    val type: String,
    val channel: String? = null,
    val payload: JsonElement? = null,
    @SerialName("code") val errorCode: String? = null,
    val message: String? = null,
)

@Serializable
data class TerminalSessionEventPayload(
    val sessionId: String,
    val organizationId: String,
    val terminalDeviceId: String,
    val vehicleId: String,
    val registrationNumber: String,
    val driverId: String,
    val driverName: String,
    val status: String,
    val state: String,
    val rejectionReason: String? = null,
    val secondsUntilEscalation: Int? = null,
    val updatedAt: String,
)

// ---------------------------------------------------------------------------
// Service runs — a trip nobody dispatched
// ---------------------------------------------------------------------------

/**
 * Open a trip for a run to a nearby service.
 *
 * Sent when the driver picks a destination out of the nearby list and the
 * vehicle has no dispatched trip against it. The route goes with it because the
 * terminal already holds one — asking Saarthi to route the same pair again a
 * second later would spend a routing call on an answer that is already on
 * screen.
 */
@Serializable
data class StartServiceRunRequest(
    val destinationName: String,
    /** The category the driver was browsing, e.g. FUEL. Display only. */
    val service: String? = null,
    val fromLatitude: Double,
    val fromLongitude: Double,
    val toLatitude: Double,
    val toLongitude: Double,
    val originName: String? = null,
    val plannedDistanceKm: Double? = null,
    val plannedDurationMinutes: Int? = null,
    val route: List<RoutePointDto>? = null,
    val odometerKm: Double? = null,
)

/**
 * What the run added up to.
 *
 * Sent on arrival, and again with [cancelled] when the driver stops navigating
 * short of the destination. The figures go either way: a cancelled run is still
 * a journey the vehicle made, and dropping its distance would leave exactly the
 * hole this whole path exists to fill.
 */
@Serializable
data class FinishServiceRunRequest(
    val tripId: String? = null,
    val distanceKm: Double? = null,
    val topSpeedKph: Double? = null,
    val averageSpeedKph: Double? = null,
    val harshBrakingCount: Int = 0,
    val harshAccelerationCount: Int = 0,
    val odometerKm: Double? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val cancelled: Boolean = false,
    val reason: String? = null,
)

/** The trip a service run is being recorded against. */
@Serializable
data class ServiceRunDto(
    val id: String,
    val reference: String,
    val status: String,
    val destinationName: String,
    val destinationLatitude: Double,
    val destinationLongitude: Double,
    val plannedDistanceKm: Double? = null,
    val actualDistanceKm: Double = 0.0,
    val startedAt: String,
    val startOdometerKm: Double? = null,
)

/**
 * The odometer, as this terminal reads it.
 *
 * The reply carries what Saarthi holds *afterwards*, which is not always what
 * was sent: the odometer never moves backwards, so a terminal fitted to a
 * different truck learns the real reading here rather than overwriting it.
 */
@Serializable
data class ReportOdometerRequest(
    val odometerKm: Double,
    /** `OBD`, `GPS` or `MANUAL` — how the figure was arrived at. */
    val source: String = "GPS",
)

@Serializable
data class OdometerDto(val odometerKm: Double)
