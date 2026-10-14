package com.saarthi.owner.ui.travel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.saarthi.owner.network.TravelApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.readable
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** A travel operator's bookings and vehicles, read together. */
data class TravelBook(val bookings: List<TravelApi.Booking>, val vehicles: List<VehiclesApi.Vehicle>) {

    private fun dayOf(iso: String): LocalDate? =
        runCatching { Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate() }.getOrNull()

    /** Today's trips, earliest first. */
    val today: List<TravelApi.Booking>
        get() = bookings.filter { dayOf(it.startDate) == LocalDate.now() && it.status !in setOf("CANCELLED", "DECLINED") }
            .sortedBy { it.startDate }

    /** Everything still to run, soonest first. */
    val upcoming: List<TravelApi.Booking>
        get() = bookings.filter { it.open }.sortedBy { it.startDate }

    val awaitingYou: List<TravelApi.Booking> get() = bookings.filter { it.status == "AWAITING_CONFIRMATION" }

    val onTheRoad: Int get() = bookings.count { it.status == "IN_PROGRESS" }

    val averageRating: Double?
        get() = bookings.mapNotNull { it.rating }.takeIf { it.isNotEmpty() }?.average()
}

class TravelModel(private val travel: TravelApi, private val vehicles: VehiclesApi) : ViewModel() {

    private val _state = MutableStateFlow<Loadable<TravelBook>>(Loadable.Loading)
    val state: StateFlow<Loadable<TravelBook>> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh(silent: Boolean = false) {
        if (!silent) _state.value = Loadable.Loading
        viewModelScope.launch {
            _state.value = try {
                coroutineScope {
                    val bookings = async { travel.mine() }
                    val fleet = async { runCatching { vehicles.list() }.getOrDefault(emptyList()) }
                    Loadable.Ready(TravelBook(bookings.await(), fleet.await()))
                }
            } catch (error: Exception) {
                if (silent && _state.value is Loadable.Ready) return@launch
                Loadable.Failed(error.readable())
            }
        }
    }
}
