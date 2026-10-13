package com.saarthi.driver.ui.shift.trips

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.saarthi.core.SaarthiApp
import com.saarthi.core.data.ShiftRepository
import com.saarthi.core.domain.simplifyRoute
import com.saarthi.core.network.CreateTripRequest
import com.saarthi.core.network.PlaceMatchDto
import com.saarthi.core.network.RouteDto
import com.saarthi.core.network.TripPlaceDto
import com.saarthi.core.telemetry.Position
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * A trip the driver is adding: from where they are, to where they are going,
 * the road between, a note.
 *
 * The same trip the fleet creates on the web — two ends and the road route
 * between them, so the trip has a real planned distance and a route its
 * covered path can be judged against. The vehicle and the driver are never
 * chosen here; the server takes both from the session.
 *
 * The start is always the phone's own position, kept current while the screen
 * is open, and cannot be changed: a trip set up from somewhere the driver is
 * not was a trip whose start nobody could check, and choosing it was one more
 * search between a driver and the road.
 */
class TripPlannerViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as SaarthiApp
    private val shift = ShiftRepository(application, app.repository)

    data class Ui(
        /** Where the vehicle is now. Null until the phone has a fix. */
        val from: TripPlaceDto? = null,
        val to: TripPlaceDto? = null,
        /** True while the search box is choosing the destination. */
        val choosingDestination: Boolean = true,
        val query: String = "",
        val matches: List<PlaceMatchDto> = emptyList(),
        val searching: Boolean = false,
        val searchFailure: String? = null,
        val route: RouteDto? = null,
        val routing: Boolean = false,
        val routeFailed: Boolean = false,
        val notes: String = "",
        val saving: Boolean = false,
        val saveFailure: String? = null,
    ) {
        val ready: Boolean get() = from != null && to != null && !routing && !saving
    }

    private val _ui = MutableStateFlow(Ui())
    val ui: StateFlow<Ui> = _ui.asStateFlow()

    private var search: Job? = null
    private var routeJob: Job? = null

    /** A fresh plan, from where the vehicle is now. */
    fun begin(here: Position?, hereName: String) {
        search?.cancel()
        routeJob?.cancel()
        _ui.value = Ui(from = here?.let { place(it, hereName) })
    }

    /**
     * Follow the phone's position while the plan is open.
     *
     * Every fix moves the start, so the trip is created from where the vehicle
     * actually is when the driver presses Add. The road is planned once, when
     * the first fix arrives with a destination already chosen; re-planning on
     * every fix would spend a routing request a second on a line that has
     * barely moved.
     */
    fun followHere(here: Position?, hereName: String) {
        here ?: return
        val hadStart = _ui.value.from != null
        _ui.update { it.copy(from = place(here, hereName)) }
        if (!hadStart) planRoute()
    }

    fun changeDestination() =
        _ui.update { it.copy(choosingDestination = true, query = "", matches = emptyList(), searchFailure = null) }

    /** Searched as the driver types, after a short pause, from two characters. */
    fun setQuery(query: String) {
        _ui.update { it.copy(query = query, searchFailure = null) }
        search?.cancel()
        if (query.trim().length < MIN_QUERY) {
            _ui.update { it.copy(matches = emptyList(), searching = false) }
            return
        }
        search = viewModelScope.launch {
            delay(SEARCH_PAUSE_MS)
            _ui.update { it.copy(searching = true) }
            app.repository.searchPlaces(query.trim())
                .onSuccess { found -> _ui.update { it.copy(matches = found, searching = false) } }
                .onFailure { problem ->
                    _ui.update { it.copy(matches = emptyList(), searching = false, searchFailure = problem.message) }
                }
        }
    }

    fun choose(match: PlaceMatchDto) {
        val destination = TripPlaceDto(
            name = match.name,
            address = match.address,
            latitude = match.latitude,
            longitude = match.longitude,
        )
        _ui.update { it.copy(to = destination, choosingDestination = false, query = "", matches = emptyList()) }
        planRoute()
    }

    fun setNotes(notes: String) = _ui.update { it.copy(notes = notes.take(NOTES_LIMIT)) }

    /** The road between the two ends — shown before adding, and sent as the plan. */
    fun planRoute() {
        val state = _ui.value
        val from = state.from ?: return
        val to = state.to ?: return
        routeJob?.cancel()
        _ui.update { it.copy(route = null, routing = true, routeFailed = false) }
        routeJob = viewModelScope.launch {
            shift.routeBetween(from, to)
                .onSuccess { route -> _ui.update { it.copy(route = route, routing = false) } }
                .onFailure { _ui.update { it.copy(routing = false, routeFailed = true) } }
        }
    }

    /** Add it. `onDone(queued)` when the server has it; the failure stays on screen. */
    fun create(onDone: (Boolean) -> Unit) {
        val state = _ui.value
        val from = state.from ?: return
        val to = state.to ?: return
        if (state.saving) return
        _ui.update { it.copy(saving = true, saveFailure = null) }
        viewModelScope.launch {
            shift.createTrip(
                CreateTripRequest(
                    origin = from,
                    destination = to,
                    notes = state.notes.trim().ifEmpty { null },
                    // Within what the server accepts, without cutting a single bend.
                    plannedRoute = state.route?.geometry
                        ?.takeIf { it.size >= 2 }
                        ?.let { simplifyRoute(it, MAX_ROUTE_POINTS) },
                ),
            )
                .onSuccess { created ->
                    _ui.update { it.copy(saving = false) }
                    onDone(created.queued)
                }
                .onFailure { problem ->
                    _ui.update { it.copy(saving = false, saveFailure = problem.message) }
                }
        }
    }

    private fun place(here: Position, name: String) =
        TripPlaceDto(name = name, latitude = here.latitude, longitude = here.longitude)

    private companion object {
        const val MIN_QUERY = 2
        const val SEARCH_PAUSE_MS = 350L
        const val NOTES_LIMIT = 2_000
        /** The most route points the server accepts. */
        const val MAX_ROUTE_POINTS = 2_000
    }
}
