package com.saarthi.owner.ui.seller

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.saarthi.owner.network.MaterialsApi
import com.saarthi.owner.network.OrdersApi
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.readable
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId

/** One order as a seller sees it: the fleet collecting, and whether it has paid. */
data class SellerOrder(val order: OrdersApi.Order, val finance: OrdersApi.Finance?) {
    /** What the fleet pays the seller for the goods. */
    val amount: Double? get() = finance?.supplier?.procurementAmount ?: order.materialPrice

    /** The fleet has paid — the seller may load. */
    val paid: Boolean
        get() = finance?.stage in setOf(
            OrdersApi.STAGE_PROCUREMENT_PAID,
            OrdersApi.STAGE_70_REQUIRED,
            OrdersApi.STAGE_70_PAID,
            OrdersApi.STAGE_FINALIZED,
        ) || order.status == "COMPLETED"

    /** An order from before payments ran through Saarthi: nothing to pay or wait for here. */
    val outsideApp: Boolean get() = finance == null && order.status != "COMPLETED"

    /** A fleet's truck is coming for it and it has not left yet. */
    val comingToLoad: Boolean
        get() = order.fleetName != null && order.status in setOf("CONFIRMED", "ASSIGNED", "PICKUP")
}

/** Everything the seller's tabs show. */
data class SellerBook(
    val orders: List<SellerOrder>,
    val listings: List<MaterialsApi.Listing>,
    val payout: MaterialsApi.PayoutAccount?,
) {
    val comingToLoad: List<SellerOrder> get() = orders.filter { it.comingToLoad }.sortedBy { it.order.pickupAt }

    val awaitingPayment: List<SellerOrder>
        get() = orders.filter { it.order.fleetName != null && it.order.open && !it.paid && !it.outsideApp }

    val received: List<SellerOrder> get() = orders.filter { it.order.fleetName != null && it.paid }

    /**
     * Paid this calendar month, as the Money tab's headline.
     *
     * Counted by when the fleet's payment to the seller went through: a truck
     * that loads on the 31st and is paid for on the 1st is next month's money.
     * Orders paid outside Saarthi, which have no payment on record, fall back to
     * the order's own date.
     */
    fun receivedThisMonth(now: Instant = Instant.now()): Double {
        val month = now.atZone(ZoneId.systemDefault()).let { it.year * 12 + it.monthValue }
        return received.filter { seller ->
            val paidAt = seller.finance?.payments
                ?.lastOrNull { it.stage == "PROCUREMENT" && it.status == "SUCCEEDED" }
                ?.at
                ?.ifBlank { null }
            runCatching { Instant.parse(paidAt ?: seller.order.pickupAt ?: seller.order.createdAt) }.getOrNull()
                ?.atZone(ZoneId.systemDefault())?.let { it.year * 12 + it.monthValue } == month
        }.sumOf { it.amount ?: 0.0 }
    }
}

class SellerModel(private val orders: OrdersApi, private val materials: MaterialsApi) : ViewModel() {

    private val _state = MutableStateFlow<Loadable<SellerBook>>(Loadable.Loading)
    val state: StateFlow<Loadable<SellerBook>> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh(silent: Boolean = false) {
        if (!silent) _state.value = Loadable.Loading
        viewModelScope.launch {
            _state.value = try {
                coroutineScope {
                    val placed = async { orders.list() }
                    val listings = async { materials.mine() }
                    val payout = async { runCatching { materials.payoutAccount() }.getOrNull() }
                    // The money side of each order the seller is part of, read together.
                    val withFinance = placed.await().map { order ->
                        async { SellerOrder(order, runCatching { orders.finance(order.id) }.getOrNull()) }
                    }.awaitAll()
                    Loadable.Ready(SellerBook(withFinance, listings.await(), payout.await()))
                }
            } catch (error: Exception) {
                if (silent && _state.value is Loadable.Ready) return@launch
                Loadable.Failed(error.readable())
            }
        }
    }

    /** A listing changed on the server; show the new one without reading everything again. */
    fun replaceListing(listing: MaterialsApi.Listing) {
        val current = (_state.value as? Loadable.Ready)?.value ?: return
        _state.value = Loadable.Ready(
            current.copy(listings = current.listings.map { if (it.id == listing.id) listing else it }.let { list ->
                if (list.none { it.id == listing.id }) listOf(listing) + list else list
            }),
        )
    }
}
