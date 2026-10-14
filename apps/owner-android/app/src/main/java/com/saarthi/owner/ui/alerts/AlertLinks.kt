package com.saarthi.owner.ui.alerts

import androidx.compose.runtime.Composable
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.AccountType
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.ui.association.RespondScreen
import com.saarthi.owner.ui.customer.CustomerBidsScreen
import com.saarthi.owner.ui.customer.CustomerBookingScreen
import com.saarthi.owner.ui.customer.CustomerOrderScreen
import com.saarthi.owner.ui.fleet.DriverApprovalScreen
import com.saarthi.owner.ui.fleet.VehicleScreen
import com.saarthi.owner.ui.jobs.BidScreen
import com.saarthi.owner.ui.orders.FleetOrderScreen
import com.saarthi.owner.ui.seller.SellerOrder
import com.saarthi.owner.ui.seller.SellerOrderScreen
import com.saarthi.owner.ui.sos.SosAlertScreen
import com.saarthi.owner.ui.travel.TravelBookingScreen

/** Where tapping an alert takes the person. */
sealed interface AlertTarget {
    /** One of the account's own tabs. */
    data class Tab(val key: String) : AlertTarget

    /** A screen pushed over the tabs. */
    class Screen(val key: String, val content: @Composable () -> Unit) : AlertTarget
}

/**
 * The screen an alert's link means in this app.
 *
 * The server writes its links for the web ("/orders/…", "/sos/…"); each one
 * this app has a screen for is fetched fresh and opened. Anything else —
 * loans, FASTag top-ups, settings — has no screen here, so the alert is only
 * marked read. Null means nothing to open, or it could not be loaded.
 */
suspend fun resolveAlertLink(app: OwnerApp, account: SessionStore.Account, link: String): AlertTarget? {
    val path = link.substringBefore('?').trim('/')
    val query = link.substringAfter('?', "")
    val parts = path.split('/')
    val id = parts.lastOrNull().orEmpty()
    val type = account.accountType
    return runCatching {
        when {
            // SOS, raised by one of the fleet's drivers.
            path.startsWith("sos/") || path.startsWith("driver/sos/") ->
                app.sos.get(id)?.let { incident -> AlertTarget.Screen("sos-$id") { SosAlertScreen(app.sos, incident) } }

            // A nearby SOS an association is asked to answer.
            path.startsWith("association/alerts/") ->
                app.association.get(id)?.let { alert -> AlertTarget.Screen("respond-$id") { RespondScreen(app, account, alert) {} } }

            path.startsWith("orders/") -> openOrder(app, account, id)

            path.startsWith("travel/bookings/") || path.startsWith("travel/provider/bookings/") ->
                app.travel.get(id)?.let { booking ->
                    if (type == AccountType.TRAVEL) {
                        AlertTarget.Screen("booking-$id") { TravelBookingScreen(app, booking) {} }
                    } else {
                        AlertTarget.Screen("booking-$id") { CustomerBookingScreen(app, booking) {} }
                    }
                }

            // A job to bid on: the board's copy carries this business's own bid.
            path.startsWith("requirements/board/") ->
                app.requirements.board().firstOrNull { it.id == id }
                    ?.let { job -> AlertTarget.Screen("bid-$id") { BidScreen(app, account, job) {} } }
                    ?: jobsTab(type)
            path == "requirements/board" -> jobsTab(type)

            // The customer's own request, with its bids.
            path.startsWith("requirements/") && type == AccountType.CUSTOMER ->
                app.requirements.mine().firstOrNull { it.id == id }
                    ?.let { request -> AlertTarget.Screen("bids-$id") { CustomerBidsScreen(app, request) {} } }

            path.startsWith("fleet/vehicles/") && parts.size >= 3 ->
                app.vehicles.get(parts[2])?.let { vehicle -> AlertTarget.Screen("vehicle-${vehicle.id}") { VehicleScreen(app, account, vehicle) } }

            path.startsWith("trips/") ->
                app.trips.get(id)?.truck?.id?.let { truckId -> app.vehicles.get(truckId) }
                    ?.let { vehicle -> AlertTarget.Screen("vehicle-${vehicle.id}") { VehicleScreen(app, account, vehicle) } }

            path == "fleet/terminal-approvals" -> {
                val session = query.split('&').firstOrNull { it.startsWith("session=") }?.substringAfter('=')
                app.fleet.waitingApprovals().firstOrNull { it.id == session }
                    ?.let { approval -> AlertTarget.Screen("approval-${approval.id}") { DriverApprovalScreen(app, approval) {} } }
                    ?: AlertTarget.Tab("home")
            }

            path.startsWith("fleet/documents") || path == "fleet/vehicles" ->
                if (type == AccountType.PERSONAL) AlertTarget.Tab("papers") else AlertTarget.Tab("fleet")

            else -> null
        }
    }.getOrNull()
}

/** An order, from whichever side this account is on. */
private suspend fun openOrder(app: OwnerApp, account: SessionStore.Account, id: String): AlertTarget? {
    val order = app.orders.get(id) ?: return null
    return when (account.accountType) {
        AccountType.CUSTOMER -> AlertTarget.Screen("order-$id") { CustomerOrderScreen(app, order) {} }
        AccountType.SELLER -> {
            val finance = runCatching { app.orders.finance(id) }.getOrNull()
            AlertTarget.Screen("order-$id") { SellerOrderScreen(app, SellerOrder(order, finance)) {} }
        }
        else -> AlertTarget.Screen("order-$id") { FleetOrderScreen(app, order) }
    }
}

private fun jobsTab(type: AccountType): AlertTarget? = when (type) {
    AccountType.FLEET -> AlertTarget.Tab("jobs")
    AccountType.TRAVEL -> AlertTarget.Tab("requests")
    else -> null
}
