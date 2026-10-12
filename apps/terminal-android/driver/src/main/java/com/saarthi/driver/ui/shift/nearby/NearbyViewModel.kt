package com.saarthi.driver.ui.shift.nearby

import android.app.Application
import android.os.SystemClock
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.saarthi.core.SaarthiApp
import com.saarthi.core.data.ShiftRepository
import com.saarthi.core.network.NearbyPlaceDto
import com.saarthi.core.network.SaarthiApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The nearby services list, one kind at a time, with an honest outcome.
 *
 * The sheet used to decide a request had failed by checking whether the list
 * object had changed. A successful answer equal to the previous one — the same
 * empty list, the same pumps after a reopen or a retry — left the old object in
 * place, so a working search was reported as "could not be loaded", and it
 * kept saying so on every retry. It also shared one busy flag and one list with
 * every other cockpit request, so a late answer for Fuel could appear under
 * Mechanic. Here each kind's answer is its own state, a new request cancels the
 * one before it, and a failure says why.
 */
internal class NearbyViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as SaarthiApp
    private val shift = ShiftRepository(application, app.repository)

    sealed interface Listing {
        data object Loading : Listing
        data class Loaded(
            val places: List<NearbyPlaceDto>,
            val roadDistances: Boolean,
            /** Some places are Saarthi's last copy, because the live directory was down. */
            val stale: Boolean,
        ) : Listing
        data class Failed(val reason: Reason, val message: String?) : Listing
    }

    enum class Reason { OFFLINE, NO_POSITION, BUSY, REFUSED }

    data class Ui(val kind: ServiceKind = ServiceKind.FUEL, val listing: Listing = Listing.Loading)

    private val _ui = MutableStateFlow(Ui())
    val ui: StateFlow<Ui> = _ui.asStateFlow()

    private var request: Job? = null
    private val recent = mutableMapOf<ServiceKind, Pair<Long, Listing.Loaded>>()

    /**
     * Show [kind], from a recent answer when there is one.
     *
     * Switching between tiles and back is the common gesture, and re-asking the
     * server for the same answer a minute later costs a driver data and a
     * spinner for nothing. [refresh] skips the shortcut.
     */
    fun show(kind: ServiceKind, refresh: Boolean = false) {
        request?.cancel()
        val kept = recent[kind]?.takeIf {
            !refresh && SystemClock.elapsedRealtime() - it.first < REUSE_MS
        }
        if (kept != null) {
            _ui.value = Ui(kind, kept.second)
            return
        }

        _ui.value = Ui(kind, Listing.Loading)
        request = viewModelScope.launch {
            val outcome = shift.nearbyHere(kind.key).fold(
                onSuccess = { (_, response) ->
                    Listing.Loaded(
                        places = response.places,
                        roadDistances = response.roadDistancesAvailable,
                        stale = response.places.any { it.stale },
                    ).also { recent[kind] = SystemClock.elapsedRealtime() to it }
                },
                onFailure = ::failure,
            )
            _ui.value = Ui(kind, outcome)
        }
    }

    private fun failure(problem: Throwable): Listing.Failed = when (problem) {
        is SaarthiApi.Failure.Offline -> Listing.Failed(Reason.OFFLINE, null)
        is SaarthiApi.Failure.Refused -> when {
            problem.code == "NO_POSITION" -> Listing.Failed(Reason.NO_POSITION, null)
            problem.status in 502..504 -> Listing.Failed(Reason.BUSY, problem.message)
            else -> Listing.Failed(Reason.REFUSED, problem.message)
        }
        else -> Listing.Failed(Reason.REFUSED, problem.message)
    }

    private companion object {
        /** Long enough to flick between tiles, short enough that a moving vehicle sees fresh places. */
        const val REUSE_MS = 90_000L
    }
}
