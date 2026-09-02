package com.saarthi.terminal.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.saarthi.terminal.SaarthiTerminalApp
import com.saarthi.terminal.data.TerminalRepository
import com.saarthi.terminal.domain.AssistantState
import com.saarthi.terminal.domain.TerminalState
import com.saarthi.terminal.domain.VoiceClassifier
import com.saarthi.terminal.domain.VoiceIntent
import com.saarthi.terminal.network.ChecklistAnswer
import com.saarthi.terminal.network.ChecklistPreparationDto
import com.saarthi.terminal.network.ChecklistResultDto
import com.saarthi.terminal.network.IssueDto
import com.saarthi.terminal.network.NearbyPlaceDto
import com.saarthi.terminal.network.RouteDto
import com.saarthi.terminal.network.RouteStepDto
import com.saarthi.terminal.network.SubmitChecklistRequest
import com.saarthi.terminal.network.TerminalStateDto
import com.saarthi.terminal.telemetry.Metric
import com.saarthi.terminal.telemetry.SimulatedTelemetryProvider
import com.saarthi.terminal.telemetry.TelemetrySnapshot
import com.saarthi.terminal.util.DebugLog
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Everything a screen needs, and nothing a screen decides.
 *
 * The terminal's lifecycle lives on the server; this view model's job is to
 * expose it, not to reconstruct it. That is why [uiState] is assembled from the
 * repository's server-provided state rather than from local flags — section 8
 * is explicit that the lifecycle must not be scattered across UI booleans, and
 * a view model that inferred "the driver is approved" from three of its own
 * fields would be exactly that, one layer down.
 */
class TerminalViewModel(application: Application) : AndroidViewModel(application) {

    private val app: SaarthiTerminalApp = application as SaarthiTerminalApp
    private val repository: TerminalRepository = app.repository

    // -----------------------------------------------------------------------
    // The assembled screen state
    // -----------------------------------------------------------------------

    /**
     * What the terminal is doing, its vehicle, its driver, and its live data.
     *
     * One object rather than six flows, because a screen that read them
     * separately could render a half-applied transition — a welcome banner for a
     * driver who has just been rejected, say, because two flows updated on
     * different frames.
     */
    data class UiState(
        val server: TerminalStateDto? = null,
        val telemetry: TelemetrySnapshot = TelemetrySnapshot(),
        val connection: TerminalRepository.Connection = TerminalRepository.Connection.UNKNOWN,
        val pendingUploads: Int = 0,
        val error: String? = null,
    ) {
        val state: TerminalState get() = TerminalState.parse(server?.state)
        val registration: String? get() = server?.vehicle?.registrationNumber
        val driverName: String? get() = server?.session?.driver?.name

        /** Speed in km/h, or null when the vehicle has not reported one. */
        val speedKph: Double? get() = telemetry.value(Metric.SPEED)

        /** True above walking pace. Drives the simplified driving layout. */
        val moving: Boolean get() = (speedKph ?: 0.0) > MOVING_KPH

        val offline: Boolean
            get() = connection == TerminalRepository.Connection.OFFLINE

        val revoked: Boolean
            get() = connection == TerminalRepository.Connection.UNAUTHENTICATED ||
                state == TerminalState.REVOKED
    }

    val uiState: StateFlow<UiState> = combine(
        repository.state,
        app.telemetry.snapshot,
        repository.connection,
        app.outbox.pendingCount,
        repository.lastError,
    ) { server, telemetry, connection, pending, error ->
        UiState(server, telemetry, connection, pending, error)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), UiState())

    // -----------------------------------------------------------------------
    // Assistant
    // -----------------------------------------------------------------------

    data class AssistantUi(
        val state: AssistantState = AssistantState.IDLE,
        val transcript: String? = null,
        val answer: String? = null,
        val caveats: List<String> = emptyList(),
        val sources: List<String> = emptyList(),
    )

    private val _assistant = MutableStateFlow(AssistantUi())
    val assistant: StateFlow<AssistantUi> = _assistant.asStateFlow()

    // -----------------------------------------------------------------------
    // Checklist
    // -----------------------------------------------------------------------

    private val _checklist = MutableStateFlow<ChecklistPreparationDto?>(null)
    val checklist: StateFlow<ChecklistPreparationDto?> = _checklist.asStateFlow()

    private val _checklistAnswers = MutableStateFlow<Map<String, String>>(emptyMap())
    val checklistAnswers: StateFlow<Map<String, String>> = _checklistAnswers.asStateFlow()

    private val _checklistResult = MutableStateFlow<ChecklistResultDto?>(null)
    val checklistResult: StateFlow<ChecklistResultDto?> = _checklistResult.asStateFlow()

    // -----------------------------------------------------------------------
    // Services and issues
    // -----------------------------------------------------------------------

    private val _places = MutableStateFlow<List<NearbyPlaceDto>>(emptyList())
    val places: StateFlow<List<NearbyPlaceDto>> = _places.asStateFlow()

    /**
     * Whether the distances in [places] are road distances.
     *
     * Surfaced separately so the list can say it once at the top rather than
     * leaving a driver to notice the wording on each row.
     */
    private val _roadDistances = MutableStateFlow(true)
    val roadDistances: StateFlow<Boolean> = _roadDistances.asStateFlow()

    private val _routingNote = MutableStateFlow<String?>(null)
    val routingNote: StateFlow<String?> = _routingNote.asStateFlow()

    /** The route currently being followed, if any. Drawn on the map. */
    private val _route = MutableStateFlow<RouteDto?>(null)
    val route: StateFlow<RouteDto?> = _route.asStateFlow()

    private val _issues = MutableStateFlow<List<IssueDto>>(emptyList())
    val issues: StateFlow<List<IssueDto>> = _issues.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    /** The SOS confirmation gate. See [armSos] for why it exists. */
    private val _sosArmed = MutableStateFlow(false)
    val sosArmed: StateFlow<Boolean> = _sosArmed.asStateFlow()

    private val _sosReference = MutableStateFlow<String?>(null)
    val sosReference: StateFlow<String?> = _sosReference.asStateFlow()

    /**
     * One event id per emergency.
     *
     * Reused across every retry of the same incident, so a driver hammering the
     * button — which is exactly what a frightened person does — collapses into
     * one incident rather than six. Regenerated only when a new emergency is
     * armed.
     */
    private var sosEventId: String = UUID.randomUUID().toString()

    val settings get() = app.settings
    val telemetryHub get() = app.telemetry
    val realtime get() = app.realtime

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    init {
        viewModelScope.launch {
            repository.ensureEnrolled()
            repository.refresh()
        }
        observeRealtime()
    }

    /**
     * React to the socket.
     *
     * A session change is the one message that must not wait: a driver standing
     * beside a truck is watching this screen for it. Everything else the socket
     * carries is handled by the next scheduled refresh.
     */
    private fun observeRealtime() {
        viewModelScope.launch {
            app.realtime.messages.collect { message ->
                when (message.type) {
                    "terminal.session.updated" -> {
                        DebugLog.info("realtime", "Session changed; refreshing")
                        repository.refresh()
                    }

                    "device.config.updated" -> repository.refresh()

                    else -> Unit
                }
            }
        }
    }

    fun refresh() {
        viewModelScope.launch { repository.refresh() }
    }

    /**
     * The signed-on driver's arrival photo, kept in step with the session.
     *
     * Keyed on the capture time rather than the session id, so retaking the
     * photo before approval replaces it — and so signing off clears it rather
     * than leaving one driver's face on the screen for the next one.
     */
    val selfie = repository.selfie

    init {
        viewModelScope.launch {
            repository.state
                .map { it?.session?.selfieCapturedAt }
                .distinctUntilChanged()
                .collect { capturedAt ->
                    if (capturedAt == null) repository.clearSelfie() else repository.loadSelfie()
                }
        }
    }

    /**
     * The last thing that was refused, in the server's own words.
     *
     * Exposed so a sheet can show it where the action was taken. It used to be
     * folded into `uiState` only, which meant a failure while choosing a
     * destination was invisible on the sheet the driver was looking at.
     */
    val lastError = repository.lastError

    fun clearError() = repository.clearError()

    // -----------------------------------------------------------------------
    // Pairing
    // -----------------------------------------------------------------------

    fun pairWithToken(token: String, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            _busy.value = true
            val result = repository.pair(token = token, pairingCode = null)
            _busy.value = false
            onDone(result.isSuccess)
        }
    }

    fun pairWithCode(code: String, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            _busy.value = true
            val result = repository.pair(token = null, pairingCode = code)
            _busy.value = false
            onDone(result.isSuccess)
        }
    }

    /**
     * Disconnect this terminal here on the tablet and return to setup.
     *
     * Needed on both sides. The fleet disconnects from the dashboard, which
     * revokes the credentials; this is what lets the tablet in the cab then
     * accept a new code, instead of sitting on "not connected" with no way
     * forward. Also the path for a terminal being moved to another vehicle,
     * where the dashboard may not be to hand.
     *
     * Re-enrolment happens on the next launch of the pairing screen, which is
     * the same path a brand-new tablet takes.
     */
    fun forgetPairing(onDone: () -> Unit = {}) {
        viewModelScope.launch {
            _busy.value = true
            repository.forgetPairing()
            repository.ensureEnrolled()
            _busy.value = false
            onDone()
        }
    }

    // -----------------------------------------------------------------------
    // Checklist
    // -----------------------------------------------------------------------

    fun loadChecklist() {
        viewModelScope.launch {
            _busy.value = true
            repository.checklist().onSuccess { preparation ->
                _checklist.value = preparation
                // Pre-fill only the items the *vehicle* answered. A manual item
                // starts blank, because a checklist that arrives pre-ticked is a
                // checklist nobody reads — and the whole purpose of this screen
                // is that somebody looks at the tyres.
                _checklistAnswers.value = preparation.items
                    .filter { !it.manualInputRequired && it.status != null }
                    .associate { it.code to it.status!! }
            }
            _busy.value = false
        }
    }

    fun answerChecklistItem(code: String, status: String) {
        _checklistAnswers.value = _checklistAnswers.value + (code to status)
    }

    /** Every required manual item has an answer. */
    fun checklistComplete(): Boolean {
        val items = _checklist.value?.items ?: return false
        val answers = _checklistAnswers.value
        return items.filter { it.required && it.manualInputRequired }
            .all { answers.containsKey(it.code) }
    }

    fun submitChecklist(notes: String?, onDone: (ChecklistResultDto?) -> Unit) {
        val items = _checklist.value?.items ?: return
        val answers = _checklistAnswers.value

        viewModelScope.launch {
            _busy.value = true
            val snapshot = app.telemetry.snapshot.value
            val result = repository.submitChecklist(
                SubmitChecklistRequest(
                    items = items.map { item ->
                        ChecklistAnswer(
                            code = item.code,
                            // Unanswered is UNAVAILABLE, never OK. The server
                            // recomputes every automated verdict anyway, so this
                            // only ever carries what the driver actually said.
                            status = answers[item.code] ?: "UNAVAILABLE",
                        )
                    },
                    latitude = snapshot.position?.latitude,
                    longitude = snapshot.position?.longitude,
                    odometerKm = snapshot.value(Metric.ODOMETER),
                    notes = notes,
                ),
            ).getOrNull()
            _checklistResult.value = result
            _busy.value = false
            onDone(result)
        }
    }

    // -----------------------------------------------------------------------
    // Trip
    // -----------------------------------------------------------------------

    fun startTrip() = viewModelScope.launch { repository.startTrip() }
    fun completeTrip() = viewModelScope.launch { repository.completeTrip() }
    fun endSession() = viewModelScope.launch { repository.endSession("Driver signed off.") }

    // -----------------------------------------------------------------------
    // Services and issues
    // -----------------------------------------------------------------------

    fun findServices(service: String?) {
        viewModelScope.launch {
            _busy.value = true
            repository.nearby(service).onSuccess { response ->
                _places.value = response.places
                _roadDistances.value = response.roadDistancesAvailable
                _routingNote.value = response.routingNote
            }
            _busy.value = false
        }
    }

    /**
     * Route to a place the driver picked.
     *
     * The polyline goes on the map and the first step becomes the navigation
     * banner. Nothing is fetched until the driver has actually chosen — a route
     * per row in a list they scrolled past would spend a fleet's daily routing
     * allowance on polylines nobody looked at.
     */
    fun navigateTo(place: NearbyPlaceDto, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            _busy.value = true
            val result = repository.route(place.latitude, place.longitude, place.name)
            result.onSuccess { _route.value = it }
            _busy.value = false
            onDone(result.isSuccess)
        }
    }

    fun clearRoute() {
        _route.value = null
    }

    /**
     * The next instruction, given where the vehicle is now.
     *
     * Computed on the device from a route it already holds, because a terminal
     * has to keep telling a driver where to turn inside a tunnel — a server round
     * trip per instruction would be slow when it worked and useless when it did
     * not.
     *
     * The nearest step ahead is chosen by straight-line proximity to the
     * manoeuvre point. That is crude next to projecting the vehicle onto the
     * polyline, and it is enough for a banner: the steps are far enough apart
     * that the nearest one is the next one, and being briefly wrong about which
     * turn is coming is recovered on the next fix.
     */
    fun nextManeuver(): NextManeuverUi? {
        val current = _route.value ?: return null
        val position = app.telemetry.snapshot.value.position ?: return null

        var best: RouteStepDto? = null
        var bestMetres = Double.MAX_VALUE

        for (step in current.steps) {
            // `depart` is behind the driver the moment they move off.
            if (step.maneuver == "depart") continue
            val metres = haversineMetres(
                position.latitude,
                position.longitude,
                step.latitude,
                step.longitude,
            )
            if (metres < bestMetres) {
                bestMetres = metres
                best = step
            }
        }

        val step = best ?: return null
        return NextManeuverUi(
            instruction = step.instruction,
            maneuver = step.maneuver,
            modifier = step.modifier,
            distanceMetres = bestMetres.toInt(),
            roadName = step.name,
        )
    }

    data class NextManeuverUi(
        val instruction: String,
        val maneuver: String,
        val modifier: String?,
        val distanceMetres: Int,
        val roadName: String,
    )

    fun loadIssues() {
        viewModelScope.launch {
            repository.issues().onSuccess { _issues.value = it }
        }
    }

    fun reportIssue(category: String, description: String, onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            _busy.value = true
            val result = repository.reportIssue(category, description)
            _busy.value = false
            if (result.isSuccess) loadIssues()
            onDone(result.isSuccess)
        }
    }

    // -----------------------------------------------------------------------
    // SOS
    // -----------------------------------------------------------------------

    /**
     * Arm the emergency control.
     *
     * A two-step gesture, because a large red button on a screen that lives in a
     * bracket next to a gear lever gets pressed by a coat sleeve. Section 36 asks
     * for "appropriate accidental-activation protection", and the balance struck
     * here is: arming is one tap, firing is a second deliberate one, and the
     * armed state times out on its own so a stray press does not leave the
     * control primed for the rest of the shift.
     *
     * The voice path bypasses this. Somebody who has said "Hey Saarthi, SOS" out
     * loud has already been deliberate, and asking them to confirm on a screen
     * in the moment they most cannot look at one would be the wrong trade.
     */
    fun armSos() {
        sosEventId = UUID.randomUUID().toString()
        _sosArmed.value = true
    }

    fun cancelSos() {
        _sosArmed.value = false
    }

    fun triggerSos(type: String = "OTHER", description: String? = null) {
        viewModelScope.launch {
            _busy.value = true
            repository.raiseSos(type, description, sosEventId)
                .onSuccess { response ->
                    _sosReference.value = response.reference
                    _sosArmed.value = false
                    DebugLog.warn("sos", "Emergency raised: ${response.reference}")
                }
            _busy.value = false
        }
    }

    // -----------------------------------------------------------------------
    // Assistant
    // -----------------------------------------------------------------------

    fun setAssistantState(state: AssistantState) {
        _assistant.value = _assistant.value.copy(state = state)
    }

    fun onTranscript(text: String) {
        _assistant.value = _assistant.value.copy(transcript = text)
    }

    /**
     * Answer a spoken or typed question.
     *
     * Emergency intent is classified *here*, on the device, before any network
     * call — see [VoiceClassifier] for why. Everything else goes to Saarthi and
     * is answered by Gemini through the controlled tool layer, under the signed-on
     * driver's own permissions.
     */
    fun ask(question: String, spoken: Boolean) {
        val intent = VoiceClassifier.classify(question)

        if (intent == VoiceIntent.SOS) {
            _assistant.value = AssistantUi(
                state = AssistantState.SPEAKING,
                transcript = question,
                answer = "Raising an emergency now. Stay where you are and stay safe.",
            )
            sosEventId = UUID.randomUUID().toString()
            triggerSos("OTHER", "Raised by voice from the terminal.")
            return
        }

        if (intent == VoiceIntent.CANCEL) {
            _assistant.value = AssistantUi()
            return
        }

        val cleaned = VoiceClassifier.stripWakePhrase(question)

        viewModelScope.launch {
            _assistant.value = AssistantUi(
                state = AssistantState.THINKING,
                transcript = cleaned,
            )

            repository.ask(cleaned, spoken)
                .onSuccess { response ->
                    if (response.action == "TRIGGER_SOS") {
                        // The server also recognised an emergency. Belt and
                        // braces: both sides classify, and either one firing is
                        // enough.
                        triggerSos("OTHER", "Raised by voice from the terminal.")
                    }
                    _assistant.value = AssistantUi(
                        state = AssistantState.SPEAKING,
                        transcript = cleaned,
                        answer = response.answer,
                        caveats = response.caveats,
                        sources = response.sources.map { it.tool },
                    )
                }
                .onFailure { error ->
                    _assistant.value = AssistantUi(
                        state = AssistantState.ERROR,
                        transcript = cleaned,
                        answer = when (error) {
                            is com.saarthi.terminal.network.SaarthiApi.Failure.Offline ->
                                "I cannot reach Saarthi right now. I will be able to answer once there is signal."
                            else -> error.message ?: "I could not answer that."
                        },
                    )
                }
        }
    }

    fun dismissAssistant() {
        _assistant.value = AssistantUi()
    }

    // -----------------------------------------------------------------------
    // Developer tools
    // -----------------------------------------------------------------------

    fun setSimulationScenario(scenario: SimulatedTelemetryProvider.Scenario) {
        app.settings.simulationScenario = scenario
        app.telemetry.simulator.scenario = scenario
    }

    fun setApiUrl(url: String) {
        repository.applyApiUrl(url)
        viewModelScope.launch { repository.refresh() }
    }

    fun setReducedMotion(enabled: Boolean) {
        app.settings.reducedMotion = enabled
    }

    private companion object {
        const val MOVING_KPH = 5.0

        /** Metres between two points on the sphere. Good to a few metres here. */
        fun haversineMetres(
            fromLat: Double,
            fromLng: Double,
            toLat: Double,
            toLng: Double,
        ): Double {
            val earthRadius = 6_371_000.0
            val dLat = Math.toRadians(toLat - fromLat)
            val dLng = Math.toRadians(toLng - fromLng)
            val a = kotlin.math.sin(dLat / 2) * kotlin.math.sin(dLat / 2) +
                kotlin.math.cos(Math.toRadians(fromLat)) *
                kotlin.math.cos(Math.toRadians(toLat)) *
                kotlin.math.sin(dLng / 2) * kotlin.math.sin(dLng / 2)
            return 2 * earthRadius * kotlin.math.atan2(kotlin.math.sqrt(a), kotlin.math.sqrt(1 - a))
        }
    }
}
