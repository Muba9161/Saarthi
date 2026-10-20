package com.saarthi.owner.ui.customer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SegmentedControl
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.travel.BookingRow

/** Every request the customer has posted, and every order that came of one. */
@Composable
fun CustomerOrdersScreen(app: OwnerApp) {
    val model = viewModel { CustomerModel(app.requirements, app.orders, app.travel) }
    val state by model.state.collectAsStateWithLifecycle()
    var showOrders by rememberSaveable { mutableStateOf(false) }
    val navigator = LocalNavigator.current
    val c = Saarthi.colors

    val top = headerClearance()
    val bottom = tabBarClearance()
    when (val shown = state) {
        Loadable.Loading -> SkeletonCards(modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = top))
        is Loadable.Failed -> FailedCard(shown.message, { model.refresh() }, Modifier.padding(start = 20.dp, end = 20.dp, top = top))
        is Loadable.Ready -> {
            val book = shown.value
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = top, bottom = bottom),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item(key = "switch") {
                    SegmentedControl(
                        options = listOf(
                            stringResource(R.string.customer_orders_requests_tab, book.requests.size),
                            stringResource(R.string.customer_orders_orders_tab, book.orders.size + book.bookings.size),
                        ),
                        selected = if (showOrders) 1 else 0,
                        onSelect = { showOrders = it == 1 },
                        modifier = Modifier.rise(),
                    )
                }
                if (!showOrders) {
                    val (open, closed) = book.requests.partition { it in book.openRequests }
                    if (book.requests.isEmpty()) {
                        item(key = "empty") { Text(stringResource(R.string.customer_orders_no_requests), style = SType.small, color = c.muted, modifier = Modifier.padding(top = 20.dp)) }
                    }
                    if (open.isNotEmpty()) item(key = "open") { GroupLabel(stringResource(R.string.customer_orders_collecting_bids)) }
                    items(open, key = { it.id }) { request ->
                        RequestRow(request) {
                            navigator.push("bids-${request.id}") { CustomerBidsScreen(app, request) { model.refresh(silent = true) } }
                        }
                    }
                    if (closed.isNotEmpty()) item(key = "closed") { GroupLabel(stringResource(R.string.customer_orders_earlier)) }
                    items(closed, key = { it.id }) { request ->
                        RequestRow(request) {
                            navigator.push("bids-${request.id}") { CustomerBidsScreen(app, request) { model.refresh(silent = true) } }
                        }
                    }
                } else {
                    if (book.orders.isEmpty() && book.bookings.isEmpty()) {
                        item(key = "empty-orders") {
                            Text(stringResource(R.string.customer_orders_no_orders), style = SType.small, color = c.muted, modifier = Modifier.padding(top = 20.dp))
                        }
                    }
                    // A cab or tour still to happen comes first; finished ones wait below the goods.
                    val (upcoming, pastTrips) = book.bookings.partition { it.open }
                    if (upcoming.isNotEmpty()) item(key = "trips-open") { GroupLabel(stringResource(R.string.customer_orders_cabs_tours)) }
                    items(upcoming, key = { it.id }) { booking ->
                        BookingRow(booking, look = customerBookingLook(booking.status)) {
                            navigator.push("booking-${booking.id}") { CustomerBookingScreen(app, booking) { model.refresh(silent = true) } }
                        }
                    }
                    if (book.bookings.isNotEmpty() && book.orders.isNotEmpty()) item(key = "goods") { GroupLabel(stringResource(R.string.customer_orders_goods)) }
                    items(book.orders, key = { it.id }) { order ->
                        CustomerOrderRow(order) {
                            navigator.push("order-${order.id}") { CustomerOrderScreen(app, order) { model.refresh(silent = true) } }
                        }
                    }
                    if (pastTrips.isNotEmpty()) item(key = "trips-past") { GroupLabel(stringResource(if (upcoming.isEmpty()) R.string.customer_orders_cabs_tours else R.string.customer_orders_earlier_trips)) }
                    items(pastTrips, key = { it.id }) { booking ->
                        BookingRow(booking, look = customerBookingLook(booking.status)) {
                            navigator.push("booking-${booking.id}") { CustomerBookingScreen(app, booking) { model.refresh(silent = true) } }
                        }
                    }
                }
            }
        }
    }
}
