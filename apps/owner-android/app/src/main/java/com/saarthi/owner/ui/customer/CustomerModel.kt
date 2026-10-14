package com.saarthi.owner.ui.customer

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.saarthi.owner.network.OrdersApi
import com.saarthi.owner.network.RequirementsApi
import com.saarthi.owner.network.TravelApi
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.readable
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What a customer has asked for, and what has been ordered from it. */
data class CustomerBook(
    val requests: List<RequirementsApi.Requirement>,
    val orders: List<OrdersApi.Order>,
    /** Cabs and tours: what a cab or tour request becomes once a quote is chosen. */
    val bookings: List<TravelApi.Booking> = emptyList(),
) {
    /** Still collecting bids or waiting to be chosen — not yet an order. */
    val openRequests: List<RequirementsApi.Requirement>
        get() = requests.filter { it.status in setOf("OPEN", "BIDDING", "PARTIALLY_AWARDED") }
}

/**
 * The customer's side, shared by its tabs: the book of requests and orders,
 * and which kind of job the Post tab should open on.
 */
class CustomerModel(
    private val requirements: RequirementsApi,
    private val orders: OrdersApi,
    private val travel: TravelApi,
) : ViewModel() {

    private val _state = MutableStateFlow<Loadable<CustomerBook>>(Loadable.Loading)
    val state: StateFlow<Loadable<CustomerBook>> = _state.asStateFlow()

    /** The kind a Home tile asked the Post tab to start on. */
    private val _postKind = MutableStateFlow(RequirementsApi.KIND_MATERIAL)
    val postKind: StateFlow<String> = _postKind.asStateFlow()

    init {
        refresh()
    }

    fun startPost(kind: String) {
        _postKind.value = kind
    }

    fun refresh(silent: Boolean = false) {
        if (!silent) _state.value = Loadable.Loading
        viewModelScope.launch {
            _state.value = try {
                coroutineScope {
                    val requests = async { requirements.mine() }
                    val placed = async { runCatching { orders.list() }.getOrDefault(emptyList()) }
                    val booked = async { runCatching { travel.booked() }.getOrDefault(emptyList()) }
                    Loadable.Ready(CustomerBook(requests.await(), placed.await(), booked.await()))
                }
            } catch (error: Exception) {
                if (silent && _state.value is Loadable.Ready) return@launch
                Loadable.Failed(error.readable())
            }
        }
    }
}
