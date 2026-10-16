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
import com.saarthi.owner.ui.sharing.SharedScopeRequest
import com.saarthi.owner.ui.sos.SosAlertScreen
import com.saarthi.owner.ui.travel.TravelBookingScreen
import com.saarthi.owner.ui.trips.TripScreen

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
                app.sos.get(id)?.let { incident -> AlertTarget.Screen("sos-$id") { SosAlertScreen(app.sos, account, incident) } }

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

            // A trip: for a customer or seller, the order it carries (the trip itself is the
            // fleet's, figures and all); for whoever runs the vehicle, the trip and its map.
            path.startsWith("trips/") -> {
                val trip = app.trips.get(id)
                when (type) {
                    AccountType.CUSTOMER, AccountType.SELLER ->
                        trip?.order?.id?.takeIf { it.isNotBlank() }?.let { orderId -> openOrder(app, account, orderId) }
                    else -> trip?.let { AlertTarget.Screen("trip-$id") { TripScreen(app, it) } }
                }
            }

            path == "fleet/terminal-approvals" -> {
                val session = query.split('&').firstOrNull { it.startsWith("session=") }?.substringAfter('=')
                app.fleet.waitingApprovals().firstOrNull { it.id == session }
                    ?.let { approval -> AlertTarget.Screen("approval-${approval.id}") { DriverApprovalScreen(app, approval, canApprove = account.can("terminal.approve")) {} } }
                    ?: AlertTarget.Tab("home")
            }

            // A vehicle shared with this account, or the vehicles list (the web adds ?view=shared,
            // which opens the list on Shared with me).
            path.startsWith("fleet/shared") || path == "fleet/vehicles" -> {
                if (path.startsWith("fleet/shared") || query.contains("view=shared")) SharedScopeRequest.open.value = true
                vehiclesTab(type)
            }

            path.startsWith("fleet/documents") -> when (type) {
                AccountType.PERSONAL -> AlertTarget.Tab("papers")
                AccountType.FLEET -> AlertTarget.Tab("fleet")
                else -> null
            }

            // Lists whose live items sit on Home: the SOS queue, the command centre, the desk.
            path == "sos" || path == "dashboard" || path == "association" -> AlertTarget.Tab("home")

            path == "travel/provider/bookings" || path == "travel/bookings" -> when (type) {
                AccountType.TRAVEL -> AlertTarget.Tab("bookings")
                AccountType.CUSTOMER -> AlertTarget.Tab("orders")
                else -> null
            }

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

/** Where an account keeps its vehicles; a travel operator finds them on the map. */
private fun vehiclesTab(type: AccountType): AlertTarget? = when (type) {
    AccountType.FLEET -> AlertTarget.Tab("fleet")
    AccountType.PERSONAL -> AlertTarget.Tab("vehicles")
    AccountType.TRAVEL -> AlertTarget.Tab("map")
    else -> null
}

private fun jobsTab(type: AccountType): AlertTarget? = when (type) {
    AccountType.FLEET -> AlertTarget.Tab("jobs")
    AccountType.TRAVEL -> AlertTarget.Tab("requests")
    else -> null
}
