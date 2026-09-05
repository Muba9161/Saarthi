package com.saarthi.terminal.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.saarthi.terminal.SaarthiTerminalApp
import com.saarthi.terminal.data.TerminalRepository
import com.saarthi.terminal.domain.AssistantState
import com.saarthi.terminal.domain.TerminalState
import com.saarthi.terminal.domain.VoiceClassifier
import com.saarthi.terminal.domain.RouteFollower
import com.saarthi.terminal.domain.VoiceIntent
import com.saarthi.terminal.network.ChecklistAnswer
import com.saarthi.terminal.update.UpdateManager
import com.saarthi.terminal.network.ChecklistPreparationDto
import com.saarthi.terminal.network.ChecklistResultDto
import com.saarthi.terminal.network.IssueDto
import com.saarthi.terminal.network.NearbyPlaceDto
import com.saarthi.terminal.network.PlaceMatchDto
import com.saarthi.terminal.network.RouteDto
import com.saarthi.terminal.network.RouteStepDto
import com.saarthi.terminal.network.ServiceRunDto
import com.saarthi.terminal.network.SubmitChecklistRequest
import com.saarthi.terminal.network.TerminalStateDto
import com.saarthi.terminal.telemetry.BluetoothObdTelemetryProvider
import com.saarthi.terminal.telemetry.Metric
import com.saarthi.terminal.telemetry.SimulatedTelemetryProvider
import com.saarthi.terminal.telemetry.TelemetrySnapshot
import com.saarthi.terminal.util.DebugLog
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.distinctUntilChangedBy
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
    /**
     * Whether turn instructions are spoken.
     *
     * A flow rather than a value read from settings at composition, because two
     * screens change it — the mute control on the navigation banner, where a
     * driver actually reaches for it, and the admin toggle where a fleet sets
     * the default for a cab with a sleeper berth. Two remembered copies of a
     * preference are two copies that disagree the moment either one is used.
     */
    private val _voiceGuidance = MutableStateFlow(app.settings.voiceGuidanceEnabled)
    val voiceGuidance: StateFlow<Boolean> = _voiceGuidance.asStateFlow()

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
        observeFixes()
        adoptOpenServiceRun()
    }

    /**
     * Follow the route as the vehicle moves.
     *
     * The navigation state is driven from the telemetry snapshot, which is the
     * only thing in the app that changes when — and *because* — the vehicle
     * moves. It used to be recomputed inside the cockpit's composition instead,
     * which meant the next turn was refreshed when the clock ticked or the voice
     * blob wobbled: frequently while the driver was talking, and not at all on a
     * still screen.
     *
     * Deduplicated on the *position*, not on the snapshot. The hub republishes
     * on its own cadence whether or not a new fix arrived — every snapshot
     * carries a fresh assembly timestamp — so keying on the snapshot would
     * dedupe nothing. Running the projection again for a position already seen
     * would advance the off-route counter without the vehicle having moved, and
     * a parked truck sitting fifty metres from its route would re-route itself
     * on a timer.
     */
    private fun observeFixes() {
        viewModelScope.launch {
            app.telemetry.snapshot
                .distinctUntilChangedBy { it.position }
                .collect { snapshot -> onFix(snapshot) }
        }
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

    // -----------------------------------------------------------------------
    // Keeping this terminal current
    // -----------------------------------------------------------------------

    /**
     * Where this terminal is in the business of updating itself.
     *
     * `Idle` nearly always — a fleet on the current build never sees any of
     * this. See `UpdateManager` for why each step exists.
     */
    private val updates = UpdateManager(application, viewModelScope)
    val updateState: StateFlow<UpdateManager.State> = updates.state

    init {
        /*
         * Ask on the same rhythm as the rest of the screen, not on a timer.
         *
         * The check is one small request and the answer is almost always "no",
         * so it rides along with the state the cockpit is already refreshing
         * rather than adding a schedule of its own to a tablet that is trying
         * to conserve a fleet SIM.
         */
        viewModelScope.launch {
            repository.state
                .map { it?.vehicle?.registrationNumber }
                .distinctUntilChanged()
                .collect { updates.check(repository.api) }
        }
    }

    /** Fetch the offered build. Verified against its checksum before installing. */
    fun downloadUpdate() = updates.download(repository.api)

    /** Hand the verified build to Android, which asks the driver to confirm. */
    fun installUpdate() = updates.install()

    /** Put the update card away. A mandatory release refuses to be dismissed. */
    fun dismissUpdate() = updates.dismiss()

    /** Report a failure the package installer discovered after we lost control. */
    fun updateInstallFailed(reason: String) = updates.installFailed(reason)

    /**
     * The last thing that was refused, in the server's own words.
     *
     * Exposed so a sheet can show it where the action was taken. It used to be
     * folded into `uiState` only, which meant a failure while choosing a
     * destination was invisible on the sheet the driver was looking at.
     */
    val lastError = repository.lastError

    /**
     * Connect the terminal to an OBD adapter, and remember it.
     *
     * Remembering is the point: the link drops every time the ignition is cycled,
     * and a driver who had to re-select the adapter each morning would use it
     * once. The provider reconnects to this address on its own from then on.
     */
    fun connectObd(candidate: BluetoothObdTelemetryProvider.ObdCandidate) {
        viewModelScope.launch {
            settings.obdAddress = candidate.address
            app.telemetry.obd.preferredAddress = candidate.address
            app.telemetry.obd.connect(candidate)
        }
    }

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
     * Work out the route to a place the driver picked, and show it to them.
     *
     * **This does not start navigating.** Choosing a row in a list is a driver
     * saying "how far is that?", and the app answering by immediately taking
     * over the map, tilting the camera and talking is the app deciding on their
     * behalf. Worse, it is unrecoverable in the direction that matters: a
     * mis-tap on a 7-inch screen in a moving cab opened a trip against the
     * vehicle and started a journey the driver then had to cancel.
     *
     * So this fetches the route, draws it, and stops. The driver sees where it
     * goes, how far it is and how long it will take, and presses Start when they
     * mean it — which is also the point at which a trip is opened, because that
     * is when they have actually committed to going.
     *
     * The routing call still happens here rather than on Start: the driver needs
     * the distance and the shape of the route *in order* to decide, and asking
     * again a moment later would spend two of a fleet's routing requests on one
     * decision.
     */
    fun navigateTo(place: NearbyPlaceDto, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            _busy.value = true
            val result = repository.route(place.latitude, place.longitude, place.name)
            result.onSuccess { route -> previewRoute(route, place.category) }
            _busy.value = false
            onDone(result.isSuccess)
        }
    }

    /**
     * Draw a route without following it.
     *
     * The state between choosing somewhere and setting off. The line and the
     * destination are on the map, the camera frames the whole journey, and
     * nothing is being measured — no turn instructions, no off-route detection,
     * no trip, no talking.
     */
    private fun previewRoute(route: RouteDto, service: String?) {
        pendingService = service
        _route.value = route
        follower = null
        arriving = false
        rerouteAttempts = 0
        _navigation.value = NavigationUi(
            route = route,
            guiding = false,
            remainingMetres = (route.distanceKm * 1_000).toInt(),
            remainingMinutes = route.durationMinutes,
        )
    }

    /**
     * The driver pressed Start.
     *
     * Everything that used to happen the instant a place was tapped happens
     * here instead, and it is the same list — following begins, and a trip is
     * opened for a journey nobody dispatched. The difference is that a person
     * has now said they are going.
     *
     * Opening the trip is deliberately last and deliberately cannot fail the
     * call. Recording a journey is worth doing; it is not worth stopping a
     * driver reaching a petrol pump for.
     */
    fun startNavigation() {
        val route = _route.value ?: return
        if (_navigation.value.guiding) return

        beginNavigation(route)
        openServiceRun(route, pendingService)
    }

    /**
     * Stop navigating, or dismiss a route the driver decided against.
     *
     * The run — if one was ever opened — is closed as cancelled rather than
     * discarded: the vehicle covered that distance whether or not anybody
     * arrived anywhere, and throwing the figures away would put the odometer
     * back out of step with the road. A route dismissed from the preview has no
     * trip behind it and nothing to close, which is the point of the preview.
     */
    /**
     * What a search returned.
     *
     * Held separately from [places] so a search does not destroy the category
     * results behind it — a driver who searches, finds nothing and goes back to
     * "Fuel" should find the list they had, not an empty one.
     */
    private val _searchResults = MutableStateFlow<List<PlaceMatchDto>>(emptyList())
    val searchResults: StateFlow<List<PlaceMatchDto>> = _searchResults.asStateFlow()

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    /** True while a search is in flight, separate from every other busy state. */
    private val _searching = MutableStateFlow(false)
    val searching: StateFlow<Boolean> = _searching.asStateFlow()

    /** Why the last search failed, or null when it simply found nothing. */
    private val _searchFailure = MutableStateFlow<String?>(null)
    val searchFailure: StateFlow<String?> = _searchFailure.asStateFlow()

    /** Cancelled and restarted on every keystroke — see [setSearchQuery]. */
    private var searchJob: Job? = null

    /**
     * The driver typed.
     *
     * Searching runs on its own after a short pause rather than waiting to be
     * asked. The first version fired only on the keyboard's Search key, and a
     * keyboard that shows a newline instead — or a driver who types and looks up
     * — got a box that did nothing at all. Nothing is the one response a search
     * field must never give.
     *
     * The pause is what keeps that from being one request per keystroke: each
     * new character cancels the last pending search.
     */
    fun setSearchQuery(value: String) {
        _searchQuery.value = value
        searchJob?.cancel()

        if (value.trim().length < 2) {
            _searchResults.value = emptyList()
            _searching.value = false
            _searchFailure.value = null
            return
        }

        searchJob = viewModelScope.launch {
            delay(SEARCH_DEBOUNCE_MS)
            runSearch(value.trim())
        }
    }

    /** Search now, for the keyboard's Search key and the button beside the box. */
    fun searchPlaces() {
        val query = _searchQuery.value.trim()
        if (query.length < 2) return
        searchJob?.cancel()
        searchJob = viewModelScope.launch { runSearch(query) }
    }

    private suspend fun runSearch(query: String) {
        _searching.value = true
        _searchFailure.value = null
        repository
            .searchPlaces(query)
            .onSuccess {
                _searchResults.value = it
                _searchFailure.value = null
            }
            .onFailure { failure ->
                /*
                 * A failed search is not an empty one.
                 *
                 * Both end with no rows, and the sheet used to phrase both as
                 * "Nothing found for X" — which tells a driver the place does
                 * not exist when in fact Saarthi never managed to ask. They
                 * then stop typing that name and try to find it another way,
                 * on the strength of an answer the app never had.
                 *
                 * So the reason is kept separately from the results, and the
                 * sheet leads with it.
                 */
                _searchResults.value = emptyList()
                _searchFailure.value = failure.message?.takeIf { it.isNotBlank() }
                    ?: "The search could not be completed."
            }
        _searching.value = false
    }

    fun clearSearch() {
        searchJob?.cancel()
        _searchQuery.value = ""
        _searchResults.value = emptyList()
        _searching.value = false
        _searchFailure.value = null
        repository.clearError()
    }

    /**
     * Start navigating to a searched place.
     *
     * The same path a nearby result takes, which is the point of giving both the
     * same shape: one route call, one destination on the map, one turn list.
     */
    fun navigateToMatch(match: PlaceMatchDto, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            _busy.value = true
            val result = repository.route(match.latitude, match.longitude, match.name)
            /*
             * Through `previewRoute`, exactly as a nearby result goes.
             *
             * Setting `_route` alone drew the line and left the navigation state
             * untouched, so `previewing` stayed false and the Start card never
             * appeared — a route on the map with no way to begin it. The two
             * entry points have to converge here or they drift again.
             */
            result.onSuccess { route -> previewRoute(route, null) }
            _busy.value = false
            onDone(result.isSuccess)
        }
    }

    fun clearRoute() {
        val trip = _serviceRun.value
        _route.value = null
        _navigation.value = NavigationUi()
        follower = null
        rerouteAttempts = 0
        arriving = false
        pendingService = null

        if (trip != null) closeServiceRun(trip, cancelled = true, reason = null)
    }

    // -----------------------------------------------------------------------
    // Following a route
    // -----------------------------------------------------------------------

    /**
     * Everything the cockpit needs to know about the journey, in one object.
     *
     * One value rather than six flows, for the same reason [uiState] is one
     * object: a banner reading them separately could render a distance from one
     * fix against an instruction from the next, and a driver glancing up would
     * be told to turn in 400 m into a road they passed two junctions ago.
     */
    data class NavigationUi(
        val route: RouteDto? = null,
        /**
         * True once the driver has pressed Start.
         *
         * The flag that separates "here is the route you asked about" from "I am
         * taking you there". Until it is set nothing is measured, nothing is
         * spoken and no trip exists — see [previewRoute].
         */
        val guiding: Boolean = false,
        val step: RouteStepDto? = null,
        /** Metres to the next manoeuvre, measured along the road. */
        val stepMetres: Int = 0,
        val remainingMetres: Int = 0,
        val remainingMinutes: Int = 0,
        /** Fraction of the route covered, for the progress bar. */
        val fraction: Float = 0f,
        /** The driver has left the route and a new one is being fetched. */
        val rerouting: Boolean = false,
        /** Off the line, but not yet re-routed — see the routing budget. */
        val offRoute: Boolean = false,
        /** True for the few seconds between arriving and the banner clearing. */
        val arrived: Boolean = false,
        /** Saarthi could not produce a new route after the driver left the old one. */
        val rerouteFailed: Boolean = false,
    ) {
        /** A route is on the map, whether or not it is being followed. */
        val active: Boolean get() = route != null

        /** Drawn, but not yet started. The driver is deciding. */
        val previewing: Boolean get() = route != null && !guiding
    }

    private val _navigation = MutableStateFlow(NavigationUi())
    val navigation: StateFlow<NavigationUi> = _navigation.asStateFlow()

    /** The trip this run is being recorded against, when one was opened. */
    private val _serviceRun = MutableStateFlow<ServiceRunDto?>(null)
    val serviceRun: StateFlow<ServiceRunDto?> = _serviceRun.asStateFlow()

    /** Stateful across fixes — leaving a route has to be sustained to count. */
    private var follower: RouteFollower? = null

    /**
     * The service category the previewed route came from, held until Start.
     *
     * Only used to label the trip — "Service run started from the terminal
     * (FUEL)" — so a fleet reading the record afterwards knows what the vehicle
     * went for.
     */
    private var pendingService: String? = null

    private var rerouteJob: Job? = null
    private var rerouteAttempts = 0
    private var lastRerouteAtMs = 0L

    /** Guards the arrival path, which must run once rather than once per fix. */
    private var arriving = false

    /**
     * Start following a route.
     *
     * [freshJourney] separates the two callers, and getting it wrong is a data
     * bug rather than a cosmetic one. A driver choosing a destination starts a
     * new journey, so the run's figures reset. A *re-route* is the same journey
     * on a different road — the driver is still going to the same petrol pump —
     * and resetting there would throw away the distance, top speed and braking
     * already accumulated, so the trip would close crediting only whatever
     * happened after the last wrong turn.
     */
    private fun beginNavigation(route: RouteDto, freshJourney: Boolean = true) {
        _route.value = route
        follower = RouteFollower(route)
        arriving = false
        _navigation.value = NavigationUi(
            route = route,
            guiding = true,
            remainingMetres = (route.distanceKm * 1_000).toInt(),
            remainingMinutes = route.durationMinutes,
        )
        if (freshJourney) {
            rerouteAttempts = 0
            // The recorder keeps counting for the odometer regardless; this only
            // resets what *this run* is credited with.
            app.telemetry.recorder.beginSegment()
        }
    }

    /**
     * Advance the journey with a new fix.
     *
     * Driven from the telemetry snapshot rather than from recomposition, which
     * is the difference between "the banner updates when the vehicle moves" and
     * "the banner updates when something on screen happens to change". The old
     * arrangement recomputed the next turn inside the cockpit's composition, so
     * it ran when the clock ticked or the voice blob wobbled, and on a still
     * screen could go seconds without running at all.
     */
    private fun onFix(snapshot: TelemetrySnapshot) {
        val route = _route.value ?: return
        // A route the driver has not started is a drawing, not a journey. There
        // is nothing to measure against it and nothing to say about it.
        if (!_navigation.value.guiding) return
        val position = snapshot.position ?: return
        val current = follower ?: return

        val progress = current.update(position.latitude, position.longitude)

        if (progress == null) {
            // A route with no usable polyline — a straight-line fallback from a
            // router that could not produce one. There is a destination and a
            // distance but no turn-by-turn, and saying so is better than
            // inventing instructions.
            _navigation.value = _navigation.value.copy(route = route, step = null)
            return
        }

        _navigation.value = _navigation.value.copy(
            route = route,
            step = progress.step,
            stepMetres = progress.stepMetres,
            remainingMetres = progress.remainingMetres,
            remainingMinutes = progress.remainingMinutes,
            fraction = progress.fraction,
            offRoute = progress.offRoute,
        )

        if (progress.arrived) {
            onArrived()
            return
        }

        if (progress.offRoute) requestReroute(route)
    }

    /**
     * The driver went a different way. Get them a new route from where they are.
     *
     * This is the behaviour a driver assumes every navigator has, and its
     * absence is not so much a missing feature as a wrong one: a route drawn
     * along a road the vehicle is no longer on, with instructions for turns it
     * will never reach, is worse than no route at all — the banner keeps
     * confidently naming a junction while the driver works out that the screen
     * has stopped describing the world.
     *
     * Bounded on both axes, because routing costs the fleet money and a vehicle
     * genuinely somewhere the router cannot reach — a private yard, an unmapped
     * site road — would otherwise re-route on every fix for the rest of the
     * shift:
     *
     *  * **A cooldown**, so a driver weaving through a diversion gets one new
     *    route rather than one per fix.
     *  * **An attempt ceiling** per journey. Past it the terminal stops asking
     *    and says so, which is the honest outcome: the line on screen is the old
     *    one, and the driver should navigate by their own judgement.
     */
    private fun requestReroute(current: RouteDto) {
        if (rerouteJob?.isActive == true) return
        if (rerouteAttempts >= MAX_REROUTES) {
            _navigation.value = _navigation.value.copy(rerouteFailed = true)
            return
        }

        val now = System.currentTimeMillis()
        if (now - lastRerouteAtMs < REROUTE_COOLDOWN_MS) return
        lastRerouteAtMs = now
        rerouteAttempts += 1

        _navigation.value = _navigation.value.copy(rerouting = true)

        rerouteJob = viewModelScope.launch {
            DebugLog.info("navigation", "Off route; asking Saarthi for a new one")
            val result = repository.route(
                current.destination.latitude,
                current.destination.longitude,
                current.destination.name,
            )

            result
                .onSuccess { fresh ->
                    /*
                     * The destination is unchanged, so the run stays open.
                     *
                     * Re-routing is not a new journey — the driver is still going
                     * to the same petrol pump — and closing the trip to open
                     * another would split one run's distance across two records
                     * and count the driver as having arrived nowhere, twice.
                     */
                    beginNavigation(fresh, freshJourney = false)
                }
                .onFailure { error ->
                    DebugLog.warn("navigation", "Could not re-route: ${error.message}")
                    _navigation.value = _navigation.value.copy(
                        rerouting = false,
                        // Only the last attempt is worth telling the driver
                        // about. Saying "could not re-route" on the first of
                        // three tries would be a warning that fixes itself.
                        rerouteFailed = rerouteAttempts >= MAX_REROUTES,
                    )
                }
        }
    }

    /**
     * The vehicle got there.
     *
     * Navigation used to have no idea. The route was cleared by exactly one
     * thing — the driver tapping the cross — so a terminal left alone kept
     * drawing a line to a pump the truck was parked on, counting down a distance
     * that had stopped changing and offering a turn that would never come.
     *
     * The banner stays up briefly rather than vanishing at the moment of
     * arrival: a driver pulling onto a forecourt is looking at the road, and a
     * screen that empties itself the instant they get there tells them nothing.
     */
    private fun onArrived() {
        if (arriving) return
        arriving = true

        val trip = _serviceRun.value
        _navigation.value = _navigation.value.copy(
            arrived = true,
            rerouting = false,
            offRoute = false,
            stepMetres = 0,
            remainingMetres = 0,
            remainingMinutes = 0,
            fraction = 1f,
        )

        DebugLog.info("navigation", "Arrived at ${_route.value?.destination?.name}")

        if (trip != null) closeServiceRun(trip, cancelled = false, reason = null)

        viewModelScope.launch {
            delay(ARRIVAL_BANNER_MS)
            // Only if the driver has not already set off somewhere else. A route
            // chosen during the pause belongs to a new journey and must survive.
            if (arriving) {
                arriving = false
                _route.value = null
                _navigation.value = NavigationUi()
                follower = null
                rerouteAttempts = 0
            }
        }
    }

    // -----------------------------------------------------------------------
    // Service runs — a trip nobody dispatched
    // -----------------------------------------------------------------------

    private fun openServiceRun(route: RouteDto, service: String?) {
        viewModelScope.launch {
            repository
                .startServiceRun(route, service, originName = uiState.value.registration)
                .onSuccess { run ->
                    _serviceRun.value = run
                    if (run != null) DebugLog.info("trip", "Service run ${run.reference} opened")
                }
        }
    }

    private fun closeServiceRun(run: ServiceRunDto, cancelled: Boolean, reason: String?) {
        // Cleared first, so a second call — an arrival racing a cancel — cannot
        // close the same run twice.
        _serviceRun.value = null

        viewModelScope.launch {
            val summary = app.telemetry.recorder.beginSegment()
            repository.finishServiceRun(
                tripId = run.id,
                summary = summary,
                // Only a reading the vehicle itself produced. See
                // `TerminalRepository.measuredOdometerKm` — a GPS-derived total
                // sent as an absolute would be counted a second time when the
                // frames it was derived from reach Saarthi.
                odometerKm = repository.measuredOdometerKm(),
                cancelled = cancelled,
                reason = reason,
            )
            DebugLog.info(
                "trip",
                "Service run ${run.reference} closed: " +
                    "%.1f km, top %.0f km/h, %d harsh stops".format(
                        summary.distanceKm,
                        summary.topSpeedKph,
                        summary.harshBrakingCount,
                    ),
            )
            // The vehicle's odometer moved. Pull the new figure so the cockpit
            // gauge and the server agree without waiting for the next poll.
            repository.refresh()
        }
    }

    /**
     * Adopt a run this terminal opened before it restarted.
     *
     * A tablet that lost power on a forecourt comes back with no memory of the
     * trip it had open. Without this it would open a second one for the same
     * journey and split the distance between them — and the first would sit
     * against the vehicle blocking dispatch until the twelve-hour sweep closed
     * it.
     *
     * The route itself is not restored. Saarthi holds where the vehicle was
     * going, but the driver has been looking at a black screen, and the honest
     * thing is to let them choose again rather than resume a journey they may
     * have abandoned. The *trip* is adopted so that whatever they do next closes
     * it properly.
     */
    private fun adoptOpenServiceRun() {
        viewModelScope.launch {
            repository.openServiceRun().onSuccess { run ->
                if (run != null && _serviceRun.value == null) {
                    _serviceRun.value = run
                    DebugLog.info("trip", "Adopted open service run ${run.reference}")
                }
            }
        }
    }

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

    fun setVoiceGuidance(enabled: Boolean) {
        app.settings.voiceGuidanceEnabled = enabled
        _voiceGuidance.value = enabled
    }

    private companion object {
        /**
         * How long to wait after the last keystroke before searching.
         *
         * Long enough that typing a word is one request rather than seven,
         * short enough that a driver who has stopped typing does not wonder
         * whether the box is working.
         */
        const val SEARCH_DEBOUNCE_MS = 450L

        const val MOVING_KPH = 5.0

        /**
         * The shortest gap between two re-routes.
         *
         * A driver crossing a diversion, or threading a service road that runs
         * beside the route, comes back off-route repeatedly over a minute or so.
         * One new route covers all of it; one per fix would spend twelve routing
         * calls on the same wrong turn.
         */
        const val REROUTE_COOLDOWN_MS = 20_000L

        /**
         * How many times to try before giving up on a journey.
         *
         * A vehicle somewhere the router genuinely cannot reach — a private
         * yard, an unmapped site road, a ferry — is off-route for as long as it
         * stays there. Without a ceiling that is a routing call every twenty
         * seconds for the rest of the shift, and a fleet's daily allowance gone
         * by lunch. Past it the terminal says so and leaves the old line up.
         */
        const val MAX_REROUTES = 4

        /**
         * How long "Arrived" stays on screen before the map clears.
         *
         * A driver pulling onto a forecourt is looking at the road, not at the
         * tablet. A banner that vanished at the instant of arrival would tell
         * them nothing at all.
         */
        const val ARRIVAL_BANNER_MS = 12_000L
    }
}
