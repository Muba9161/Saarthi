package com.saarthi.owner.ui.fleet

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.DriversApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.readable
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** The fleet's vehicles and drivers, read together. */
data class FleetLists(val vehicles: List<VehiclesApi.Vehicle>, val drivers: List<DriversApi.Driver>)

class FleetListModel(
    private val vehicles: VehiclesApi,
    private val drivers: DriversApi,
    private val account: SessionStore.Account,
) : ViewModel() {

    private val _state = MutableStateFlow<Loadable<FleetLists>>(Loadable.Loading)
    val state: StateFlow<Loadable<FleetLists>> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh(silent: Boolean = false) {
        if (!silent) _state.value = Loadable.Loading
        viewModelScope.launch {
            _state.value = try {
                coroutineScope {
                    val vehicleList = async { vehicles.list() }
                    // A business without drivers of its own (a personal seat) still lists its vehicles.
                    val driverList = async {
                        if (account.can("drivers.read")) runCatching { drivers.list() }.getOrDefault(emptyList()) else emptyList()
                    }
                    Loadable.Ready(FleetLists(vehicleList.await(), driverList.await()))
                }
            } catch (error: Exception) {
                if (silent && _state.value is Loadable.Ready) return@launch
                Loadable.Failed(error.readable())
            }
        }
    }
}
