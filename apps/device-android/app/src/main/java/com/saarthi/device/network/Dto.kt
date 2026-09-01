package com.saarthi.device.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * The Saarthi Device wire contract, mirrored in Kotlin.
 *
 * The authority for these shapes is
 * `packages/shared/src/validation/device-client.ts` in the same repository. Two
 * languages cannot share a type, so they share a document: when that file
 * changes, this one changes with it, and `docs/SAARTHI_DEVICE_APP_CONTRACT.md`
 * is the reviewable bridge between them.
 *
 * Three conventions run through the whole file and each is deliberate:
 *
 *  * **Nullable means "not measured".** A GPS fix indoors has no bearing and a
 *    cold start has no speed. Sending zero for either would corrupt the speed
 *    series that the harsh-driving rules run on, so absent values are absent.
 *  * **No `vehicleId` appears anywhere.** The backend resolves it from the
 *    device's active assignment. A field the phone could set is a field a
 *    compromised phone could set to somebody else's truck.
 *  * **Simulated engine data is a separate object.** It is never mixed into the
 *    measurements, so nothing downstream has to guess which is which.
 */

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

@Serializable
data class ApiEnvelope<T>(
    val success: Boolean,
    val data: T? = null,
    val error: ApiErrorBody? = null,
)

@Serializable
data class ApiErrorBody(
    val code: String,
    val message: String,
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
    val deviceType: String = "MOBILE_TEST_DEVICE",
)

@Serializable
data class EnrolResponse(
    val deviceIdentifier: String,
    val enrolmentId: String,
    /** Returned exactly once. Goes straight into encrypted storage. */
    val secret: String,
    val token: DeviceToken,
    val status: String,
    val expiresAt: String,
    val nextStep: String,
)

@Serializable
data class DeviceToken(
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
 * What the pairing QR contains.
 *
 * A token and the API it belongs to, and nothing else — no vehicle, no
 * registration, nothing commercial. `kind` exists so the scanner can reject an
 * unrelated QR instantly rather than posting a stranger's data to Saarthi.
 */
@Serializable
data class PairingPayload(
    val v: Int,
    val kind: String,
    val api: String,
    val token: String,
)

@Serializable
data class PairRequest(
    val token: String,
    val deviceModel: String? = null,
    val osVersion: String? = null,
    val appVersion: String? = null,
)

@Serializable
data class PairResponse(
    val identity: DeviceIdentityDto,
    val config: DeviceConfigDto,
    /**
     * A token for the device this installation has just become.
     *
     * Needed rather than merely convenient: the pending-enrolment token stops
     * working the instant the enrolment is claimed, so without this the app
     * would succeed at pairing and then get a 401 it could not explain.
     */
    val token: DeviceToken,
    val credentials: IssuedCredentials? = null,
)

@Serializable
data class IssuedCredentials(
    val deviceIdentifier: String,
    val secret: String,
)

@Serializable
data class UnpairRequest(
    val reason: String? = null,
)

// ---------------------------------------------------------------------------
// Identity and configuration
// ---------------------------------------------------------------------------

@Serializable
data class DeviceIdentityDto(
    val deviceId: String? = null,
    val deviceIdentifier: String,
    val provider: String? = null,
    val deviceType: String? = null,
    val role: String? = null,
    val status: String,
    val paired: Boolean,
    val organizationId: String? = null,
    val vehicle: PairedVehicle? = null,
    val cameras: List<CameraChannel> = emptyList(),
    val lastSeenAt: String? = null,
    val lastTelemetryAt: String? = null,
)

@Serializable
data class PairedVehicle(
    val id: String,
    val registrationNumber: String,
    val vehicleType: String,
    val assignedAt: String,
)

@Serializable
data class CameraChannel(
    val id: String,
    val channel: Int,
    val position: String,
    val label: String? = null,
)

@Serializable
data class DeviceConfigDto(
    val reportingIntervalSeconds: Int,
    val heartbeatIntervalSeconds: Int,
    /** Whether the backend has anywhere for this device to publish video. */
    val videoEnabled: Boolean,
    /** Whether this environment accepts simulated engine data at all. */
    val simulationAllowed: Boolean,
    val maxBatchSize: Int,
    val maxBufferedEvents: Int,
    val environment: String,
    val serverTime: String,
)

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

@Serializable
data class LocationPoint(
    /** Generated before the event is buffered, so a retry is harmless. */
    val eventId: String,
    val latitude: Double,
    val longitude: Double,
    val speedKph: Double? = null,
    val heading: Double? = null,
    val altitude: Double? = null,
    val accuracy: Double? = null,
    val satellites: Int? = null,
    val recordedAt: String,
)

@Serializable
data class LocationBatch(
    val points: List<LocationPoint>,
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
    val harshBraking: Boolean = false,
    val harshAcceleration: Boolean = false,
    val suddenMovement: Boolean = false,
)

@Serializable
data class FrameHealth(
    val signalStrength: Int? = null,
    val networkType: String? = null,
    val batteryPercent: Int? = null,
    val batteryCharging: Boolean? = null,
)

/**
 * The invented half of a frame.
 *
 * A phone has no connection to the engine, so every value here comes from the
 * on-device simulator. It travels in its own object, tagged with the mode that
 * produced it, and the backend records each field as simulated so no gauge and
 * no AI answer can present it as a measurement.
 */
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
    val diagnostics: List<SimulatedFault> = emptyList(),
)

@Serializable
data class SimulatedFault(
    val code: String,
    val description: String? = null,
)

@Serializable
data class TelemetryFrame(
    val eventId: String,
    val recordedAt: String,
    val sequence: Long? = null,
    val location: FrameLocation? = null,
    val motion: FrameMotion? = null,
    val health: FrameHealth? = null,
    val simulated: FrameSimulated? = null,
)

@Serializable
data class TelemetryBatch(
    val frames: List<TelemetryFrame>,
)

/**
 * What Saarthi says about a submission.
 *
 * `duplicates` is why the app can drop events from its buffer confidently: it
 * means Saarthi already holds them, which is a success, not a failure. Folding
 * it into `rejected` would make a correctly-retrying device look broken.
 */
@Serializable
data class IngestResult(
    val accepted: Int,
    val rejected: Int,
    val duplicates: Int = 0,
    val alerts: Int = 0,
    val reasons: List<String> = emptyList(),
)

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

@Serializable
data class HeartbeatRequest(
    val batteryPercent: Int? = null,
    val batteryCharging: Boolean? = null,
    val networkType: String,
    val gpsStatus: String,
    val cameraStatus: String,
    val bufferedEvents: Int,
    val appVersion: String? = null,
    val deviceTime: String? = null,
)

@Serializable
data class HeartbeatResponse(
    val acknowledgedAt: String,
    val nextHeartbeatInSeconds: Int,
    /** Echoed every beat, so a cadence change lands within one heartbeat. */
    val reportingIntervalSeconds: Int,
    val pendingCommands: Int,
)

// ---------------------------------------------------------------------------
// SOS
// ---------------------------------------------------------------------------

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
// Commands
// ---------------------------------------------------------------------------

@Serializable
data class DeviceCommandDto(
    val id: String,
    val type: String,
    val payload: JsonElement? = null,
    val issuedAt: String,
    val expiresAt: String,
)

@Serializable
data class CommandAck(
    val success: Boolean,
    val result: JsonElement? = null,
    val error: String? = null,
)

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

@Serializable
data class PublishTicketRequest(
    val channel: Int,
)

@Serializable
data class PublishTicket(
    val sessionId: String,
    val ingestUrl: String,
    val token: String,
    val protocol: String,
    val expiresAt: String,
    val constraints: PublishConstraints,
    /**
     * STUN and TURN servers, when the deployment provides them.
     *
     * Empty on a LAN, where host candidates are enough. A phone on a mobile
     * network behind carrier-grade NAT will usually need at least a STUN server
     * and sometimes a TURN relay, and those are a deployment decision rather
     * than something the app should hard-code.
     */
    val iceServers: List<IceServer> = emptyList(),
    /** `true` when nothing on the other end will receive the stream. */
    val simulated: Boolean,
)

@Serializable
data class IceServer(
    val urls: String,
    val username: String? = null,
    val credential: String? = null,
)

@Serializable
data class PublishConstraints(
    val maxWidth: Int,
    val maxHeight: Int,
    val maxFrameRate: Int,
    @SerialName("maxBitrateKbps") val maxBitrateKbps: Int,
)
