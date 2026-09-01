package com.saarthi.device.data

import android.content.Context
import android.os.Build
import com.saarthi.device.BuildConfig
import com.saarthi.device.network.ApiException
import com.saarthi.device.network.DeviceApi
import com.saarthi.device.network.DeviceConfigDto
import com.saarthi.device.network.DeviceIdentityDto
import com.saarthi.device.network.EnrolRequest
import com.saarthi.device.network.HeartbeatRequest
import com.saarthi.device.network.HeartbeatResponse
import com.saarthi.device.network.IngestResult
import com.saarthi.device.network.LocationBatch
import com.saarthi.device.network.LocationPoint
import com.saarthi.device.network.PairRequest
import com.saarthi.device.network.PairingPayload
import com.saarthi.device.network.SosRequest
import com.saarthi.device.network.SosResponse
import com.saarthi.device.network.TelemetryBatch
import com.saarthi.device.network.TelemetryFrame
import com.saarthi.device.util.DebugLog
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import java.util.UUID

/**
 * Everything the app knows about being a Saarthi device.
 *
 * The one place that decides what happens when the network is not there, which
 * is most of the interesting behaviour in this app. Three rules run through it:
 *
 *  * **Queue first, send second.** Every event is written to the buffer before
 *    an upload is attempted. A crash, a kill or a tunnel between the two costs
 *    a duplicate upload — harmless, because every event carries an idempotency
 *    key — while the other order costs the data.
 *  * **A refusal is not a failure.** Saarthi answering "this device is not
 *    paired" is a final answer, and the app stops rather than retrying into a
 *    flat battery. A timeout is not final, and the app keeps the events.
 *  * **Only Saarthi decides what it holds.** Rows leave the buffer when the
 *    server says it has them, counting `duplicates` as success, and never on
 *    optimism.
 */
class DeviceRepository(context: Context) {

    private val appContext = context.applicationContext

    val identity = DeviceIdentityStore(appContext)
    val settings = DeviceSettings(appContext)
    val buffer = EventBuffer(appContext)
    val api = DeviceApi(identity)

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    private val _state = MutableStateFlow(DeviceState())
    val state: StateFlow<DeviceState> = _state.asStateFlow()

    /**
     * The last position this device produced.
     *
     * Held here rather than in the view model because the service is what
     * produces fixes and the SOS screen is what needs them, and those are
     * different lifecycles — a view model created after the service started
     * would otherwise have no position and refuse to raise an alarm.
     */
    @Volatile
    var lastKnownFix: LastFix? = null
        private set

    data class LastFix(
        val latitude: Double,
        val longitude: Double,
        val speedKph: Double?,
        val heading: Double?,
        val accuracy: Double?,
        val recordedAt: Long,
    )

    fun recordFix(fix: LastFix) {
        lastKnownFix = fix
    }

    /** Immutable snapshot of what the app currently believes about itself. */
    data class DeviceState(
        val deviceIdentifier: String? = null,
        val paired: Boolean = false,
        val vehicleRegistration: String? = null,
        val vehicleId: String? = null,
        val status: String = "UNKNOWN",
        val config: DeviceConfigDto? = null,
        val bufferedEvents: Int = 0,
        val lastSyncAt: Long? = null,
        val lastError: String? = null,
        val cameraChannels: List<Int> = emptyList(),
    )

    // -----------------------------------------------------------------------
    // Identity
    // -----------------------------------------------------------------------

    val isEnrolled: Boolean get() = identity.isEnrolled

    /**
     * Claim an identity from Saarthi.
     *
     * Idempotent on the installation id, so a reopened app, a reinstall over
     * the top, or a retry after a timeout all land on the same device rather
     * than accumulating identities nobody will ever claim.
     */
    suspend fun enrol(): Result<String> = runCatching {
        val response = api.enrol(
            EnrolRequest(
                installationId = identity.installationId,
                deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                osVersion = "Android ${Build.VERSION.RELEASE}",
                appVersion = BuildConfig.VERSION_NAME,
            ),
        )
        identity.deviceIdentifier = response.deviceIdentifier
        identity.secret = response.secret
        identity.storeToken(response.token.accessToken, response.token.expiresIn)

        DebugLog.add("ENROLLED AS ${response.deviceIdentifier}")
        _state.value = _state.value.copy(
            deviceIdentifier = response.deviceIdentifier,
            status = response.status,
            paired = false,
        )
        response.deviceIdentifier
    }.onFailure { recordError(it) }

    // -----------------------------------------------------------------------
    // Pairing
    // -----------------------------------------------------------------------

    /**
     * Read a scanned QR.
     *
     * Returns null for anything that is not a Saarthi pairing code, so a
     * scanner pointed at a random barcode fails quietly on the phone rather
     * than posting a stranger's data to the API to find out.
     */
    fun parsePairingQr(raw: String): PairingPayload? = runCatching {
        val payload = json.decodeFromString(PairingPayload.serializer(), raw)
        if (payload.kind != "saarthi.device.pair" || payload.v != 1) null else payload
    }.getOrNull()

    /**
     * Redeem a pairing code.
     *
     * The API base is taken from the QR, which is what lets one build serve
     * development, staging and production: a tester scanning a staging code
     * gets a device on staging without reinstalling anything.
     */
    suspend fun pair(payload: PairingPayload): Result<DeviceIdentityDto> = runCatching {
        identity.apiBaseUrl = payload.api

        if (!identity.isEnrolled) {
            enrol().getOrThrow()
        }

        val response = api.pair(
            PairRequest(
                token = payload.token,
                deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                osVersion = "Android ${Build.VERSION.RELEASE}",
                appVersion = BuildConfig.VERSION_NAME,
            ),
        )

        // The pending-enrolment token died the moment the enrolment was claimed,
        // so the replacement in the response is used immediately rather than
        // discovering the 401 on the next call.
        identity.storeToken(response.token.accessToken, response.token.expiresIn)
        response.credentials?.let { fresh ->
            identity.deviceIdentifier = fresh.deviceIdentifier
            identity.secret = fresh.secret
        }

        DebugLog.add("PAIRED TO ${response.identity.vehicle?.registrationNumber ?: "?"}")
        applyIdentity(response.identity, response.config)
        response.identity
    }.onFailure { recordError(it) }

    suspend fun unpair(reason: String? = null): Result<Unit> = runCatching {
        api.unpair(reason)
        DebugLog.add("UNPAIRED")
        // The buffer belongs to the assignment that produced it. Carrying
        // positions from one vehicle across to the next would attribute them to
        // a truck that was never there.
        buffer.clear()
        identity.clearToken()
        _state.value = _state.value.copy(
            paired = false,
            vehicleRegistration = null,
            vehicleId = null,
            status = "UNPAIRED",
            bufferedEvents = 0,
            cameraChannels = emptyList(),
        )
    }.onFailure { recordError(it) }

    /** Forget everything. Used when a phone changes hands. */
    fun reset() {
        buffer.clear()
        identity.forget()
        settings.reset()
        _state.value = DeviceState()
    }

    // -----------------------------------------------------------------------
    // Refresh
    // -----------------------------------------------------------------------

    suspend fun refresh(): Result<DeviceIdentityDto> = runCatching {
        val me = api.me()
        val config = if (me.paired) runCatching { api.config() }.getOrNull() else null
        applyIdentity(me, config)
        me
    }.onFailure { recordError(it) }

    private fun applyIdentity(me: DeviceIdentityDto, config: DeviceConfigDto?) {
        config?.let { settings.applyServerConfig(it) }
        _state.value = _state.value.copy(
            deviceIdentifier = me.deviceIdentifier,
            paired = me.paired,
            vehicleRegistration = me.vehicle?.registrationNumber,
            vehicleId = me.vehicle?.id,
            status = me.status,
            config = config ?: _state.value.config,
            cameraChannels = me.cameras.map { it.channel },
            bufferedEvents = buffer.count(),
            lastError = null,
        )
    }

    // -----------------------------------------------------------------------
    // Ingestion
    // -----------------------------------------------------------------------

    /** A fresh idempotency key. Generated before queueing, never after. */
    fun newEventId(): String = UUID.randomUUID().toString()

    fun queueLocation(point: LocationPoint, recordedAtMillis: Long) {
        buffer.enqueue(
            eventId = point.eventId,
            kind = EventBuffer.Kind.LOCATION,
            payload = json.encodeToString(LocationPoint.serializer(), point),
            recordedAt = recordedAtMillis,
        )
        _state.value = _state.value.copy(bufferedEvents = buffer.count())
    }

    fun queueFrame(frame: TelemetryFrame, recordedAtMillis: Long) {
        buffer.enqueue(
            eventId = frame.eventId,
            kind = EventBuffer.Kind.FRAME,
            payload = json.encodeToString(TelemetryFrame.serializer(), frame),
            recordedAt = recordedAtMillis,
        )
        _state.value = _state.value.copy(bufferedEvents = buffer.count())
    }

    /**
     * Push whatever is queued.
     *
     * Returns the number of events Saarthi now holds, or null when the network
     * was unreachable — which the caller treats as "try again", not as a fault.
     */
    suspend fun flush(): Int? {
        buffer.dropExpired(EventBuffer.MAX_AGE_MILLIS)

        var uploaded = 0
        uploaded += flushKind(EventBuffer.Kind.FRAME) ?: return finishFlush(uploaded, failed = true)
        uploaded += flushKind(EventBuffer.Kind.LOCATION) ?: return finishFlush(uploaded, failed = true)
        return finishFlush(uploaded, failed = false)
    }

    private fun finishFlush(uploaded: Int, failed: Boolean): Int? {
        _state.value = _state.value.copy(
            bufferedEvents = buffer.count(),
            lastSyncAt = if (!failed) System.currentTimeMillis() else _state.value.lastSyncAt,
        )
        return if (failed) null else uploaded
    }

    private suspend fun flushKind(kind: EventBuffer.Kind): Int? {
        var total = 0

        while (true) {
            val batch = buffer.peek(EventBuffer.MAX_BATCH, kind)
            if (batch.isEmpty()) return total

            val result: IngestResult = try {
                when (kind) {
                    EventBuffer.Kind.LOCATION -> api.sendLocations(
                        LocationBatch(
                            batch.map { json.decodeFromString(LocationPoint.serializer(), it.payload) },
                        ),
                    )
                    EventBuffer.Kind.FRAME -> api.sendFrames(
                        TelemetryBatch(
                            batch.map { json.decodeFromString(TelemetryFrame.serializer(), it.payload) },
                        ),
                    )
                }
            } catch (error: ApiException) {
                if (error.isTerminal) {
                    // Saarthi has refused these and will keep refusing them —
                    // the device is unpaired, suspended or revoked. Holding them
                    // forever would fill the buffer with events that can never
                    // be delivered, and retrying would flatten the battery.
                    DebugLog.add("UPLOAD REFUSED (${error.code}) — DISCARDING ${batch.size}")
                    buffer.acknowledge(batch.map { it.rowId })
                    recordError(error)
                    return total
                }
                DebugLog.add("UPLOAD FAILED (${error.code}) — KEEPING ${batch.size}")
                recordError(error)
                return null
            }

            // Removed only once Saarthi says it holds them. `duplicates` counts:
            // it means the server already had the event, which is exactly as
            // final as having just accepted it.
            buffer.acknowledge(batch.map { it.rowId })
            total += result.accepted + result.duplicates

            DebugLog.add(
                "UPLOADED ${batch.size} ${kind.name} " +
                    "(accepted ${result.accepted}, duplicate ${result.duplicates}, rejected ${result.rejected})",
            )

            if (batch.size < EventBuffer.MAX_BATCH) return total
        }
    }

    // -----------------------------------------------------------------------
    // Heartbeat and SOS
    // -----------------------------------------------------------------------

    suspend fun heartbeat(request: HeartbeatRequest): Result<HeartbeatResponse> = runCatching {
        val response = api.heartbeat(request)
        // The cadence is echoed on every beat, so an operator changing it from
        // the dashboard reaches the device within thirty seconds without the app
        // having to poll anything.
        settings.reportingIntervalSeconds = response.reportingIntervalSeconds
        _state.value = _state.value.copy(lastSyncAt = System.currentTimeMillis(), lastError = null)
        response
    }.onFailure { recordError(it) }

    suspend fun raiseSos(request: SosRequest): Result<SosResponse> = runCatching {
        val response = api.raiseSos(request)
        DebugLog.add("SOS RAISED — ${response.reference}")
        response
    }.onFailure { recordError(it) }

    private fun recordError(error: Throwable) {
        val message = when (error) {
            is ApiException -> error.message
            else -> error.message ?: "Something went wrong."
        }
        _state.value = _state.value.copy(lastError = message)
        DebugLog.add("ERROR $message")
    }

    /** Where this device is currently pointed, as learned from its pairing code. */
    val apiBaseUrl: String get() = identity.apiBaseUrl

    fun refreshBufferCount() {
        _state.value = _state.value.copy(bufferedEvents = buffer.count())
    }
}
