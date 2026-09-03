package com.saarthi.terminal.data

import android.content.Context
import com.saarthi.terminal.BuildConfig
import com.saarthi.terminal.domain.TerminalState
import com.saarthi.terminal.network.AskRequest
import com.saarthi.terminal.network.AskResponse
import com.saarthi.terminal.network.ChecklistPreparationDto
import com.saarthi.terminal.network.ChecklistResultDto
import com.saarthi.terminal.network.EndSessionRequest
import com.saarthi.terminal.network.FrameHealth
import com.saarthi.terminal.network.FrameLocation
import com.saarthi.terminal.network.FrameMotion
import com.saarthi.terminal.network.FrameSimulated
import com.saarthi.terminal.network.FrameVehicle
import com.saarthi.terminal.network.HeartbeatRequest
import com.saarthi.terminal.network.IssueDto
import com.saarthi.terminal.network.NearbyResponse
import com.saarthi.terminal.network.PairRequest
import com.saarthi.terminal.network.ReportIssueRequest
import com.saarthi.terminal.network.RouteDto
import com.saarthi.terminal.network.ReportOdometerRequest
import com.saarthi.terminal.network.RoutePointDto
import com.saarthi.terminal.network.RouteRequest
import com.saarthi.terminal.network.ServiceRunDto
import com.saarthi.terminal.network.StartServiceRunRequest
import com.saarthi.terminal.network.FinishServiceRunRequest
import com.saarthi.terminal.network.SaarthiApi
import com.saarthi.terminal.network.SosRequest
import com.saarthi.terminal.network.SosResponse
import com.saarthi.terminal.network.SubmitChecklistRequest
import com.saarthi.terminal.network.TelemetryBatch
import com.saarthi.terminal.network.TelemetryFrame
import com.saarthi.terminal.network.TerminalStateDto
import com.saarthi.terminal.network.TripEventRequest
import com.saarthi.terminal.telemetry.Metric
import com.saarthi.terminal.telemetry.MetricSource
import com.saarthi.terminal.telemetry.TelemetryHub
import com.saarthi.terminal.telemetry.TelemetrySnapshot
import com.saarthi.terminal.telemetry.TripRecorder
import com.saarthi.terminal.util.DebugLog
import com.saarthi.terminal.util.DeviceEnvironment
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.util.UUID

/**
 * The terminal's single source of truth.
 *
 * Every screen reads [state] and nothing else. That is the practical form of
 * section 8's rule about not scattering the lifecycle across UI booleans: there
 * is one [TerminalStateDto], it comes from the server, and a screen's only job
 * is to render whichever state it names.
 *
 * The repository owns three things beyond that:
 *
 *  * **Enrolment and pairing**, which are the only operations that can happen
 *    before there is any state at all.
 *  * **Telemetry submission**, including the offline buffer. Frames are queued
 *    first and uploaded second, always — never the other way round, because a
 *    frame that was only ever in flight is a frame lost when the tunnel starts.
 *  * **Connection honesty.** [connection] says whether Saarthi is reachable,
 *    and it is derived from actual request outcomes rather than from the radio.
 *    A tablet showing full bars on a captive-portal wifi is offline as far as
 *    this app is concerned, and saying "connected" would be a lie a driver acts
 *    on.
 */
class TerminalRepository(
    private val context: Context,
    val identity: TerminalIdentityStore,
    val settings: TerminalSettings,
    val outbox: EventOutbox,
    val telemetry: TelemetryHub,
    scope: CoroutineScope,
) {

    val api = SaarthiApi(settings.apiUrl, identity, BuildConfig.VERSION_NAME)

    enum class Connection { UNKNOWN, ONLINE, OFFLINE, UNAUTHENTICATED }

    private val _state = MutableStateFlow<TerminalStateDto?>(null)
    val state: StateFlow<TerminalStateDto?> = _state.asStateFlow()

    private val _connection = MutableStateFlow(Connection.UNKNOWN)
    val connection: StateFlow<Connection> = _connection.asStateFlow()

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError.asStateFlow()

    private val uploadLock = Mutex()
    private var sequence: Long = 0L

    /** The terminal-level state, parsed. [TerminalState.UNPAIRED] until known. */
    val terminalState: TerminalState
        get() = TerminalState.parse(_state.value?.state)

    fun applyApiUrl(url: String) {
        settings.apiUrl = url
        api.updateBaseUrl(settings.apiUrl)
    }

    // -----------------------------------------------------------------------
    // Bring-up
    // -----------------------------------------------------------------------

    /**
     * Make sure this terminal has an identity.
     *
     * Idempotent, and safe to call on every launch. A terminal that already has
     * credentials does nothing; one that does not enrols. Enrolment creates no
     * tenant data — the identity holds no organization and reaches nothing until
     * an authorised person pairs it.
     */
    suspend fun ensureEnrolled(): Result<Unit> = runCatchingApi {
        if (identity.hasCredentials) return@runCatchingApi
        val result = api.enrol(
            deviceModel = DeviceEnvironment.deviceModel(),
            osVersion = DeviceEnvironment.osVersion(),
        )
        DebugLog.info("terminal", "Enrolled as ${result.deviceIdentifier}")
    }

    /**
     * Connect to a vehicle.
     *
     * Accepts either the scanned token or the typed `STH-XXXX-XXXX` code. The
     * server treats them as the same single-use credential; which one the
     * installer used is not something the app needs an opinion about.
     */
    suspend fun pair(token: String?, pairingCode: String?): Result<Unit> = runCatchingApi {
        val response = api.pair(
            PairRequest(
                token = token,
                pairingCode = pairingCode,
                deviceModel = DeviceEnvironment.deviceModel(),
                osVersion = DeviceEnvironment.osVersion(),
                appVersion = BuildConfig.VERSION_NAME,
                screenInches = DeviceEnvironment.screenInches(context),
            ),
        )

        // The pairing response carries a fresh token for the identity this
        // terminal has just become. Without storing it, the very next request
        // would 401 — the enrolment token stops resolving the moment the
        // enrolment is claimed.
        identity.storeToken(response.token.accessToken, response.token.expiresIn)
        identity.pairedVehicleId = response.identity.vehicle?.id
        identity.pairedRegistration = response.identity.vehicle?.registrationNumber

        DebugLog.info(
            "terminal",
            "Paired to ${response.identity.vehicle?.registrationNumber ?: "a vehicle"}",
        )
        refresh()
    }

    /**
     * Reload everything the terminal needs to render.
     *
     * One request. A terminal in a yard on a bad link cannot afford six round
     * trips to decide which screen it is on, and six independent answers can
     * disagree — which is how a tablet shows a welcome screen for a driver who
     * has just been rejected.
     */
    suspend fun refresh(): Result<Unit> = runCatchingApi {
        val next = api.state()
        _state.value = next

        // The server owns the cadence and the simulation policy. A terminal that
        // chose its own reporting interval would be one a fleet cannot slow down.
        telemetry.intervalMs = next.reportingIntervalSeconds * 1_000L
        telemetry.applySimulationPolicy(next.simulationAllowed)
        telemetry.simulator.scenario = settings.simulationScenario

        next.vehicle?.let { vehicle ->
            identity.pairedVehicleId = vehicle.id
            identity.pairedRegistration = vehicle.registrationNumber
            // Seed the simulator's odometer from the vehicle's real figure, so a
            // simulated reading is at least anchored to something true.
            if (telemetry.simulator.odometerKm == 0.0) {
                telemetry.simulator.odometerKm = vehicle.odometerKm
            }
            /*
             * And seed the real one.
             *
             * The recorder tracks the vehicle's mileage from the figure Saarthi
             * holds plus the distance this terminal has watched it cover, so the
             * cockpit gauge moves with the road instead of stepping once every
             * thirty seconds when this poll returns. Seeding is monotonic — see
             * `seedOdometer` — so a refresh cannot rewind what has been measured
             * since the last one.
             */
            telemetry.recorder.seedOdometer(vehicle.odometerKm)
        }
    }

    // -----------------------------------------------------------------------
    // Telemetry
    // -----------------------------------------------------------------------

    /**
     * Turn the current snapshot into a frame and queue it.
     *
     * Queued first, uploaded second — always. A frame that only ever existed in
     * flight is a frame lost the moment the truck enters a tunnel, and those are
     * exactly the positions a fleet most wants afterwards.
     *
     * Note the shape: real measurements and simulated engine values go in
     * *separate branches* of the payload, which is what lets the gateway label
     * the stored reading honestly instead of guessing which fields a tablet
     * could plausibly have produced.
     */
    fun enqueueFrame(snapshot: TelemetrySnapshot) {
        val position = snapshot.position ?: return

        sequence += 1
        val (harshBraking, harshAcceleration, suddenMovement) =
            telemetry.phone.consumeMotionFlags()

        val battery = DeviceEnvironment.battery(context)

        /*
         * Measured engine data, in its own block.
         *
         * This was the gap that made the whole OBD path pointless: the frame
         * carried only `filterValues { it.simulated }`, so a terminal reading a
         * real coolant temperature showed it on the cockpit and threw it away on
         * the way to Saarthi. The dashboard saw nothing, and the fleet had a
         * fitted adapter producing a local-only display.
         */
        val measured = snapshot.values.filterValues { !it.simulated }
        val vehicleBlock = FrameVehicle(
            rpm = measured[Metric.RPM]?.value,
            engineLoad = measured[Metric.ENGINE_LOAD]?.value,
            coolantTemperature = measured[Metric.COOLANT_TEMPERATURE]?.value,
            intakeTemperature = measured[Metric.INTAKE_TEMPERATURE]?.value,
            fuelLevel = measured[Metric.FUEL_LEVEL]?.value,
            fuelRate = measured[Metric.FUEL_RATE]?.value,
            throttlePosition = measured[Metric.THROTTLE_POSITION]?.value,
            batteryVoltage = measured[Metric.BATTERY_VOLTAGE]?.value,
            odometerKm = measured[Metric.ODOMETER]?.value,
            vin = telemetry.obd.vin.value,
            diagnostics = snapshot.diagnostics
                .filter { !it.simulated }
                .map {
                    com.saarthi.terminal.network.DiagnosticCodeDto(it.code, it.description)
                }
                .ifEmpty { null },
        )
        // Speed, heading and position ride in `location` and are not repeated
        // here; an all-null block is an empty statement and is left off.
        val hasVehicleData = listOfNotNull(
            vehicleBlock.rpm,
            vehicleBlock.engineLoad,
            vehicleBlock.coolantTemperature,
            vehicleBlock.intakeTemperature,
            vehicleBlock.fuelLevel,
            vehicleBlock.fuelRate,
            vehicleBlock.throttlePosition,
            vehicleBlock.batteryVoltage,
            vehicleBlock.odometerKm,
        ).isNotEmpty() || vehicleBlock.vin != null || vehicleBlock.diagnostics != null

        val simulatedValues = snapshot.values.filterValues { it.simulated }
        val simulatedBlock = if (simulatedValues.isEmpty()) {
            null
        } else {
            FrameSimulated(
                mode = telemetry.simulator.scenario.name,
                rpm = simulatedValues[Metric.RPM]?.value,
                engineLoad = simulatedValues[Metric.ENGINE_LOAD]?.value,
                coolantTemperature = simulatedValues[Metric.COOLANT_TEMPERATURE]?.value,
                fuelLevel = simulatedValues[Metric.FUEL_LEVEL]?.value,
                batteryVoltage = simulatedValues[Metric.BATTERY_VOLTAGE]?.value,
                throttlePosition = simulatedValues[Metric.THROTTLE_POSITION]?.value,
                odometerKm = simulatedValues[Metric.ODOMETER]?.value,
                diagnostics = snapshot.diagnostics
                    .filter { it.simulated }
                    .map {
                        com.saarthi.terminal.network.DiagnosticCodeDto(it.code, it.description)
                    }
                    .ifEmpty { null },
            )
        }

        outbox.add(
            TelemetryFrame(
                eventId = UUID.randomUUID().toString(),
                recordedAt = Instant.ofEpochMilli(snapshot.at).toString(),
                sequence = sequence,
                location = FrameLocation(
                    latitude = position.latitude,
                    longitude = position.longitude,
                    speedKph = snapshot.value(Metric.SPEED),
                    heading = snapshot.value(Metric.HEADING),
                    altitude = snapshot.value(Metric.ALTITUDE),
                    accuracy = position.accuracyMetres,
                ),
                motion = FrameMotion(
                    accelerationX = null,
                    accelerationY = null,
                    accelerationZ = snapshot.value(Metric.ACCELEROMETER),
                    harshBraking = harshBraking,
                    harshAcceleration = harshAcceleration,
                    suddenMovement = suddenMovement,
                ),
                health = FrameHealth(
                    networkType = DeviceEnvironment.networkType(context),
                    batteryPercent = battery.percent,
                    batteryCharging = battery.charging,
                ),
                vehicle = if (hasVehicleData) vehicleBlock else null,
                simulated = simulatedBlock,
            ),
        )
    }

    /**
     * Send whatever is queued.
     *
     * Serialised, so a wake-up and a timer tick do not upload the same batch
     * twice. Frames are forgotten only once the server has acknowledged them —
     * a failed upload leaves the buffer intact, which is the difference between
     * a retry and a silent hole in a journey.
     */
    suspend fun flushOutbox(): Result<Int> = runCatchingApi {
        uploadLock.withLock {
            var uploaded = 0
            while (true) {
                val batch = outbox.peek()
                if (batch.isEmpty()) break

                val ack = api.sendTelemetry(TelemetryBatch(batch))
                // Duplicates count as delivered. A batch that was accepted, timed
                // out on the way back and is being retried must not be uploaded
                // for ever because the second attempt reports them as repeats.
                outbox.acknowledge(batch)
                uploaded += ack.accepted + ack.duplicates

                if (ack.rejected > 0) {
                    DebugLog.warn(
                        "telemetry",
                        "Gateway rejected ${ack.rejected} frames: ${ack.reasons.joinToString()}",
                    )
                }
                // One batch per pass on a marginal link. Draining a week's buffer
                // in one go is how a reconnection turns into a stall.
                if (batch.size < 100) break
            }
            uploaded
        }
    }

    /** Report that the terminal is alive, and how it is doing (section 41). */
    suspend fun sendHeartbeat(): Result<Unit> = runCatchingApi {
        val battery = DeviceEnvironment.battery(context)
        api.heartbeat(
            HeartbeatRequest(
                batteryPercent = battery.percent,
                batteryCharging = battery.charging,
                networkType = DeviceEnvironment.networkType(context),
                gpsStatus = telemetry.gpsStatusForHeartbeat(context),
                cameraStatus = DeviceEnvironment.cameraStatus(context),
                bufferedEvents = outbox.pendingCount.value,
                appVersion = BuildConfig.VERSION_NAME,
                deviceTime = Instant.now().toString(),
            ),
        )
    }

    // -----------------------------------------------------------------------
    // Driver lifecycle
    // -----------------------------------------------------------------------

    suspend fun checklist(): Result<ChecklistPreparationDto> = runCatchingApi { api.checklist() }

    suspend fun submitChecklist(request: SubmitChecklistRequest): Result<ChecklistResultDto> =
        runCatchingApi {
            val result = api.submitChecklist(request)
            refresh()
            result
        }

    suspend fun startTrip(): Result<Unit> = runCatchingApi {
        val position = telemetry.snapshot.value.position
        api.startTrip(
            TripEventRequest(
                latitude = position?.latitude,
                longitude = position?.longitude,
                odometerKm = telemetry.snapshot.value.value(Metric.ODOMETER),
            ),
        )
        refresh()
    }

    suspend fun completeTrip(): Result<Unit> = runCatchingApi {
        val position = telemetry.snapshot.value.position
        api.completeTrip(
            TripEventRequest(
                latitude = position?.latitude,
                longitude = position?.longitude,
                odometerKm = telemetry.snapshot.value.value(Metric.ODOMETER),
            ),
        )
        refresh()
    }

    suspend fun endSession(reason: String?): Result<Unit> = runCatchingApi {
        api.endSession(EndSessionRequest(reason))
        refresh()
    }

    // -----------------------------------------------------------------------
    // Services, issues and the assistant
    // -----------------------------------------------------------------------

    suspend fun nearby(service: String?): Result<NearbyResponse> = runCatchingApi {
        val position = telemetry.snapshot.value.position
            ?: throw SaarthiApi.Failure.Refused(
                409,
                "NO_POSITION",
                "Saarthi does not know where this vehicle is yet, so it cannot search nearby.",
            )
        api.nearby(service, position.latitude, position.longitude)
    }

    /**
     * Route to a place the driver picked.
     *
     * The origin is this terminal's *current* position rather than the last
     * frame Saarthi holds: a driver standing beside a parked truck asking for a
     * mechanic is asking about where they are now, and the last uploaded frame
     * may be a minute and half a kilometre old.
     */
    suspend fun route(
        toLatitude: Double,
        toLongitude: Double,
        destinationName: String,
        avoidTolls: Boolean = false,
    ): Result<RouteDto> = runCatchingApi {
        val position = telemetry.snapshot.value.position
            ?: throw SaarthiApi.Failure.Refused(
                409,
                "NO_POSITION",
                "Saarthi does not know where this vehicle is yet, so it cannot plan a route.",
            )
        api.route(
            RouteRequest(
                fromLatitude = position.latitude,
                fromLongitude = position.longitude,
                toLatitude = toLatitude,
                toLongitude = toLongitude,
                destinationName = destinationName,
                avoidTolls = avoidTolls,
            ),
        )
    }

    // -----------------------------------------------------------------------
    // Service runs — a trip nobody dispatched
    // -----------------------------------------------------------------------

    /**
     * Open a trip for a run to a nearby service.
     *
     * Called the moment a route to a chosen place comes back. The route goes with
     * it rather than being re-derived on the server, because the terminal has it
     * in hand and routing is the one part of the map stack that costs a fleet
     * money.
     *
     * A null result is a *decision*, not a failure: Saarthi returns nothing when
     * the vehicle is already on a dispatched trip, because that journey is
     * already being recorded. Navigation carries on either way — recording a run
     * must never be able to stop a driver getting to a petrol pump.
     */
    suspend fun startServiceRun(
        route: RouteDto,
        service: String?,
        originName: String?,
    ): Result<ServiceRunDto?> = runCatchingApi {
        val snapshot = telemetry.snapshot.value
        val position = snapshot.position
            ?: throw SaarthiApi.Failure.Refused(
                409,
                "NO_POSITION",
                "Saarthi does not know where this vehicle is yet.",
            )

        api.startServiceRun(
            StartServiceRunRequest(
                destinationName = route.destination.name,
                service = service,
                fromLatitude = position.latitude,
                fromLongitude = position.longitude,
                toLatitude = route.destination.latitude,
                toLongitude = route.destination.longitude,
                originName = originName,
                plannedDistanceKm = route.distanceKm,
                plannedDurationMinutes = route.durationMinutes,
                // Thinned before sending. A long route is thousands of points,
                // and the fleet map draws the same shape from a few hundred —
                // posting all of them over a mobile link in a truck cab spends
                // the driver's bandwidth on precision nobody can see.
                route = route.geometry.thinned(MAX_ROUTE_POINTS),
                odometerKm = snapshot.value(Metric.ODOMETER),
            ),
        )
    }

    /**
     * Close the run, with what it added up to.
     *
     * `cancelled` distinguishes the driver stopping short from the vehicle
     * arriving. The figures are sent either way — a cancelled run is still real
     * distance on a real vehicle, and dropping it would put the odometer back
     * out of step with the road, which is the whole problem this path exists to
     * solve.
     */
    suspend fun finishServiceRun(
        tripId: String?,
        summary: TripRecorder.Segment,
        odometerKm: Double?,
        cancelled: Boolean,
        reason: String?,
    ): Result<ServiceRunDto?> = runCatchingApi {
        val position = telemetry.snapshot.value.position
        api.finishServiceRun(
            FinishServiceRunRequest(
                tripId = tripId,
                distanceKm = summary.distanceKm.takeIf { summary.hasData },
                topSpeedKph = summary.topSpeedKph.takeIf { it > 0.0 },
                averageSpeedKph = summary.averageSpeedKph.takeIf { it > 0.0 },
                harshBrakingCount = summary.harshBrakingCount,
                harshAccelerationCount = summary.harshAccelerationCount,
                odometerKm = odometerKm,
                latitude = position?.latitude,
                longitude = position?.longitude,
                cancelled = cancelled,
                reason = reason,
            ),
        )
    }

    /**
     * An odometer reading worth sending, or null.
     *
     * **Only a figure the vehicle itself produced.** This is the single most
     * important rule on this path and it is not obvious, so:
     *
     * Saarthi derives a vehicle's odometer from the positions it receives. The
     * terminal derives its own from the same fixes, for the cockpit gauge, so
     * that the number moves with the road rather than stepping once every state
     * poll. Those two are the *same measurement counted twice*, and sending the
     * terminal's as an absolute reading is fine right up until the terminal has
     * been out of coverage.
     *
     * Picture it: half an hour in a dead spot, thirty kilometres covered. The
     * terminal's local odometer is thirty higher; Saarthi's has not moved,
     * because the frames are still in the outbox. Signal returns, the odometer
     * report goes first, Saarthi adopts the higher figure — and then the buffer
     * flushes and the tracking pipeline adds those same thirty kilometres on
     * top. Sixty kilometres for a thirty-kilometre journey, on the number that
     * drives every service interval.
     *
     * An ECU reading has none of that problem: it is the vehicle's own total,
     * not an accumulation, so re-sending it is idempotent by construction. So
     * that is the only kind that leaves this device.
     */
    fun measuredOdometerKm(): Double? {
        val snapshot = telemetry.snapshot.value
        val reading = snapshot[Metric.ODOMETER] ?: return null
        return if (reading.source == MetricSource.OBD) reading.value else null
    }

    /** The run already open on this vehicle, for a terminal that restarted. */
    suspend fun openServiceRun(): Result<ServiceRunDto?> = runCatchingApi {
        api.openServiceRun()
    }

    /**
     * Tell Saarthi what the odometer reads.
     *
     * Separate from any trip, because a vehicle accrues distance whether or not
     * anybody opened a movement against it — and because the figure has to reach
     * the maintenance schedule, the passport, the resale valuation and the fleet
     * list, not just the gauge in the cab.
     *
     * The reply is what Saarthi holds afterwards, which is not always what was
     * sent: the odometer never moves backwards, so a terminal moved to another
     * truck learns that vehicle's real reading here instead of overwriting it.
     */
    suspend fun reportOdometer(odometerKm: Double, source: String): Result<Double> =
        runCatchingApi {
            api.reportOdometer(ReportOdometerRequest(odometerKm, source)).odometerKm
        }

    suspend fun reportIssue(category: String, description: String): Result<IssueDto> =
        runCatchingApi {
            val position = telemetry.snapshot.value.position
            api.reportIssue(
                ReportIssueRequest(
                    category = category,
                    description = description,
                    latitude = position?.latitude,
                    longitude = position?.longitude,
                    odometerKm = telemetry.snapshot.value.value(Metric.ODOMETER),
                ),
            )
        }

    suspend fun issues(): Result<List<IssueDto>> = runCatchingApi { api.issues() }

    suspend fun ask(question: String, spoken: Boolean): Result<AskResponse> = runCatchingApi {
        val snapshot = telemetry.snapshot.value
        api.ask(
            AskRequest(
                question = question,
                spokenBy = if (spoken) "VOICE" else "TEXT",
                latitude = snapshot.position?.latitude,
                longitude = snapshot.position?.longitude,
                moving = (snapshot.value(Metric.SPEED) ?: 0.0) > MOVING_KPH,
            ),
        )
    }

    /**
     * Raise an emergency.
     *
     * Goes to the existing device SOS endpoint, unchanged. The payload carries
     * no vehicle, no driver and no recipient — all three are resolved from this
     * terminal's assignment, because deciding who to alert is a decision about
     * people's safety and does not belong on a tablet.
     *
     * The `eventId` is generated once and reused across retries, so a driver
     * pressing the button repeatedly — which is exactly what a frightened person
     * does — collapses into one incident rather than six.
     */
    suspend fun raiseSos(type: String, description: String?, eventId: String): Result<SosResponse> =
        runCatchingApi {
            val snapshot = telemetry.snapshot.value
            val position = snapshot.position
                ?: throw SaarthiApi.Failure.Refused(
                    409,
                    "NO_POSITION",
                    "Saarthi has no position for this vehicle, so responders could not be sent. Call your fleet directly.",
                )
            val battery = DeviceEnvironment.battery(context)

            api.raiseSos(
                SosRequest(
                    eventId = eventId,
                    type = type,
                    latitude = position.latitude,
                    longitude = position.longitude,
                    speedKph = snapshot.value(Metric.SPEED),
                    heading = snapshot.value(Metric.HEADING),
                    accuracy = position.accuracyMetres,
                    description = description,
                    cameraAvailable =
                        DeviceEnvironment.cameraStatus(context) == DeviceEnvironment.Subsystem.OK,
                    networkType = DeviceEnvironment.networkType(context),
                    batteryPercent = battery.percent,
                    triggeredAt = Instant.now().toString(),
                ),
            )
        }

    // -----------------------------------------------------------------------
    // Error handling
    // -----------------------------------------------------------------------

    /**
     * Run an API call and record what it says about the connection.
     *
     * The three outcomes are kept apart because they need three different things
     * from the person in the cab: wait, fix something, or call the office. A
     * single "something went wrong" would be true and useless.
     */
    private suspend fun <T> runCatchingApi(block: suspend () -> T): Result<T> = try {
        val value = block()
        _connection.value = Connection.ONLINE
        _lastError.value = null
        Result.success(value)
    } catch (error: SaarthiApi.Failure.Offline) {
        _connection.value = Connection.OFFLINE
        // Not surfaced as an error banner. Being offline in a tunnel is normal,
        // and a red message every time a truck goes under a bridge is a message
        // drivers stop reading.
        Result.failure(error)
    } catch (error: SaarthiApi.Failure.Unauthenticated) {
        _connection.value = Connection.UNAUTHENTICATED
        _lastError.value =
            "This terminal is no longer connected to a vehicle. Ask your fleet to issue a new pairing code."
        Result.failure(error)
    } catch (error: SaarthiApi.Failure.Refused) {
        _connection.value = Connection.ONLINE
        _lastError.value = error.message
        Result.failure(error)
    } catch (error: Throwable) {
        _lastError.value = error.message ?: "Something went wrong."
        DebugLog.error("terminal", "Unexpected failure", error)
        Result.failure(error)
    }

    /**
     * The signed-on driver's arrival photo.
     *
     * Held decoded rather than re-fetched per frame: it changes once a shift,
     * when a different person signs on. Cleared alongside the session so the
     * next driver never sees the last one's face on the cab screen.
     */
    private val _selfie = MutableStateFlow<android.graphics.Bitmap?>(null)
    val selfie: StateFlow<android.graphics.Bitmap?> = _selfie.asStateFlow()

    suspend fun loadSelfie() {
        val bytes = runCatching { api.selfieBytes() }.getOrNull()
        _selfie.value = bytes?.let {
            android.graphics.BitmapFactory.decodeByteArray(it, 0, it.size)
        }
    }

    fun clearSelfie() {
        _selfie.value = null
    }

    fun clearError() {
        _lastError.value = null
    }

    /**
     * Forget this vehicle and go back to the pairing screen.
     *
     * The device half of the fleet disconnecting a terminal from the dashboard.
     * Without it the tablet is stranded: its credentials stop working, it shows
     * "not connected", and there is nothing on screen that will make it accept
     * a new code — the installer's only remaining option is clearing app data
     * through Android settings, which on a kiosk-locked tablet is not an option
     * at all.
     *
     * The installation id is rotated as well, and it has to be: Saarthi refuses
     * to re-enrol an installation whose enrolment has already been claimed, so
     * a terminal that kept its id got a 409 on the very next step and sat on the
     * setup screen unable to pair with anything. Keeping it would have been
     * tidier in the fleet's hardware list and would have made the button useless.
     *
     * Queued telemetry is dropped rather than kept. It belongs to a vehicle
     * this terminal is no longer fitted to, and delivering it later would file
     * one truck's readings against whatever it is paired to next.
     */
    fun forgetPairing() {
        outbox.clear()
        identity.reset()
        identity.rotateInstallationId()
        _state.value = null
        _connection.value = Connection.UNKNOWN
        _lastError.value = null
        DebugLog.info("terminal", "Pairing forgotten; returning to setup")
    }

    private companion object {
        /** Above this the vehicle counts as moving, and the UI simplifies. */
        const val MOVING_KPH = 5.0

        /**
         * How many route points to send with a service run.
         *
         * Enough for the fleet map to draw the shape of the journey. A long
         * route carries thousands, and the extra ones describe curvature at a
         * scale no dashboard renders — paid for out of a truck's mobile data.
         */
        const val MAX_ROUTE_POINTS = 300
    }

    /**
     * Every nth point, keeping the ends.
     *
     * The ends matter: dropping the last point would end the drawn route short
     * of the destination pin, which reads as a routing fault rather than as
     * thinning.
     */
    private fun List<RoutePointDto>.thinned(limit: Int): List<RoutePointDto> {
        if (size <= limit || limit < 2) return this
        val stride = (size + limit - 1) / limit
        return filterIndexed { index, _ -> index % stride == 0 || index == lastIndex }
    }
}
