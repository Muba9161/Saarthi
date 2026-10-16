package com.saarthi.owner.ui.fleet

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.AlertsApi
import com.saarthi.owner.network.FleetApi
import com.saarthi.owner.network.ReturnLoadsApi
import com.saarthi.owner.network.SosApi
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.readable
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Everything the fleet's home shows, read in one go. */
data class FleetHome(
    val dashboard: FleetApi.Dashboard?,
    val positions: List<FleetApi.Position>,
    val approvals: List<FleetApi.Approval>,
    val fastags: List<FleetApi.Fastag>,
    /** The most pressing unread alert, when no driver is waiting. */
    val topAlert: AlertsApi.Alert?,
    /** Trucks arriving soon with nothing lined up for the way home. */
    val emptySoon: List<ReturnLoadsApi.EmptyRisk> = emptyList(),
    /** A driver's open SOS — before anything else on the screen. */
    val sos: List<SosApi.Incident> = emptyList(),
) {
    val total: Int get() = dashboard?.fleet?.totalTrucks?.takeIf { it > 0 } ?: positions.size
    val reporting: Int get() = positions.count { !it.stale }
    val moving: Int get() = positions.count { !it.stale && (it.speedKph ?: 0.0) > MOVING_KPH }
    val idle: Int get() = reporting - moving
    val offline: Int get() = positions.count { it.stale }
    val onTrip: Int get() = dashboard?.fleet?.onTrip ?: positions.count { it.trip != null }
}

private const val MOVING_KPH = 3.0

/**
 * Reads the fleet's home and keeps it fresh.
 *
 * Each part is asked for only when the account may see it — a dispatcher
 * without the financial view still gets a home — and a part that fails on its
 * own is left out rather than failing the whole screen.
 */
class FleetHomeModel(
    private val fleet: FleetApi,
    private val alerts: AlertsApi,
    private val returnLoads: ReturnLoadsApi,
    private val sosApi: SosApi,
    private val account: SessionStore.Account,
) : ViewModel() {

    private val _state = MutableStateFlow<Loadable<FleetHome>>(Loadable.Loading)
    val state: StateFlow<Loadable<FleetHome>> = _state.asStateFlow()

    /** The approval being sent, so its buttons can show they are working. */
    private val _acting = MutableStateFlow<String?>(null)
    val acting: StateFlow<String?> = _acting.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    init {
        refresh()
    }

    /** Read again. A silent refresh keeps what is on screen until the new answer arrives. */
    fun refresh(silent: Boolean = false) {
        if (!silent) _state.value = Loadable.Loading
        viewModelScope.launch {
            _state.value = try {
                Loadable.Ready(load())
            } catch (error: Exception) {
                if (silent && _state.value is Loadable.Ready) return@launch
                Loadable.Failed(error.readable())
            }
        }
    }

    private suspend fun load(): FleetHome = coroutineScope {
        val positions = async { if (account.can("tracking.read")) fleet.positions() else emptyList() }
        val dashboard = async { optional { if (account.can("analytics.read")) fleet.dashboard() else null } }
        val approvals = async { optional { if (account.can("terminal.read")) fleet.waitingApprovals() else null } }
        val fastags = async { optional { if (account.can("toll.read")) fleet.fastags() else null } }
        val page = async { optional { alerts.page(pageSize = 20) } }
        val risks = async { optional { if (account.can("returnloads.read")) returnLoads.emptyRisk() else null } }
        val emergencies = async { optional { if (account.can("sos.read")) sosApi.active() else null } }
        FleetHome(
            dashboard = dashboard.await(),
            positions = positions.await(),
            approvals = approvals.await().orEmpty(),
            fastags = fastags.await().orEmpty(),
            // An open SOS has its own card above; a closed one needs nobody.
            topAlert = page.await()?.items
                ?.filter { it.readAt == null && !it.type.startsWith("SOS") }
                ?.minByOrNull { priorityRank(it.priority) },
            emptySoon = risks.await().orEmpty().filter { !it.hasReturnLoad && (it.emptyReturnKm ?: 0.0) >= 20 },
            sos = emergencies.await().orEmpty(),
        )
    }

    fun approve(id: String) = act(id, "Approved. They can start the shift.") { fleet.approve(id) }

    fun reject(id: String, reason: String) = act(id, "Turned down. The driver has been told why.") {
        fleet.reject(id, reason)
    }

    fun clearMessage() {
        _message.value = null
    }

    private fun act(id: String, done: String, call: suspend () -> Unit) {
        if (_acting.value != null) return
        _acting.value = id
        viewModelScope.launch {
            _message.value = try {
                call()
                refresh(silent = true)
                done
            } catch (error: Exception) {
                error.readable()
            } finally {
                _acting.value = null
            }
        }
    }

    private suspend fun <T> optional(read: suspend () -> T?): T? = try {
        read()
    } catch (error: Exception) {
        null
    }

    private fun priorityRank(priority: String): Int = when (priority) {
        "CRITICAL" -> 0
        "HIGH" -> 1
        "NORMAL" -> 2
        else -> 3
    }
}
