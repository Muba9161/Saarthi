package com.saarthi.owner.ui.travel

import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.fleet.FleetListScreen
import com.saarthi.owner.ui.fleet.FleetMapScreen
import com.saarthi.owner.ui.jobs.JobsScreen
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.shell.Navigator
import com.saarthi.owner.ui.shell.TabHeader
import com.saarthi.owner.ui.shell.TabSpec

/**
 * A travel operator's tabs: Home, Bookings, Fleet, Requests. The fleet's
 * vehicles and drivers have a tab of their own, as on the web; the map opens
 * from that tab and from Home, so the bar keeps room for its labels.
 */
fun travelTabs(app: OwnerApp, account: SessionStore.Account): List<TabSpec> = listOf(
    TabSpec(
        key = "home",
        label = Words.get(R.string.fleet_tab_home),
        icon = Lucide.home,
        header = TabHeader(account.organizationName, Words.get(R.string.fleet_greeting, account.firstName)),
        content = { actions -> TravelHomeScreen(app, account, actions) },
    ),
    TabSpec(
        key = "bookings",
        label = Words.get(R.string.fleet_travel_tab_bookings),
        icon = Lucide.calendar,
        header = TabHeader(Words.get(R.string.fleet_travel_header_trips_you_run), Words.get(R.string.fleet_travel_tab_bookings)),
        content = { TravelBookingsScreen(app) },
    ),
    TabSpec(
        key = "fleet",
        label = Words.get(R.string.fleet_tab_fleet),
        icon = Lucide.truck,
        header = TabHeader(Words.get(R.string.fleet_tab_header_vehicles_drivers), Words.get(R.string.fleet_tab_header_your_fleet)),
        content = {
            val navigator = LocalNavigator.current
            FleetListScreen(app, account, onOpenMap = { openFleetMap(navigator, app, account) })
        },
    ),
    TabSpec(
        key = "requests",
        label = Words.get(R.string.fleet_travel_tab_requests),
        icon = Lucide.briefcase,
        header = TabHeader(Words.get(R.string.fleet_travel_header_cabs_tours), Words.get(R.string.fleet_travel_tab_requests)),
        content = { JobsScreen(app, account, withOrders = false) },
    ),
)

/** The live map of the operator's vehicles, opened as a page. */
internal fun openFleetMap(navigator: Navigator, app: OwnerApp, account: SessionStore.Account) {
    navigator.push("fleet-map") { FleetMapScreen(app, account, onBack = { navigator.pop() }) }
}
