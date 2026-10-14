package com.saarthi.owner.ui.travel

import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.fleet.FleetMapScreen
import com.saarthi.owner.ui.jobs.JobsScreen
import com.saarthi.owner.ui.shell.TabHeader
import com.saarthi.owner.ui.shell.TabSpec

/** A travel operator's tabs, as the design lays them out: Home, Bookings, Map, Requests. */
fun travelTabs(app: OwnerApp, account: SessionStore.Account): List<TabSpec> = listOf(
    TabSpec(
        key = "home",
        label = "Home",
        icon = Lucide.home,
        header = TabHeader(account.organizationName, "Hi, ${account.firstName}"),
        content = { actions -> TravelHomeScreen(app, actions) },
    ),
    TabSpec(
        key = "bookings",
        label = "Bookings",
        icon = Lucide.calendar,
        header = TabHeader("Trips you run", "Bookings"),
        content = { TravelBookingsScreen(app) },
    ),
    TabSpec(
        key = "map",
        label = "Map",
        icon = Lucide.map,
        header = null,
        content = { FleetMapScreen(app, account) },
    ),
    TabSpec(
        key = "requests",
        label = "Requests",
        icon = Lucide.briefcase,
        header = TabHeader("Cabs & tours near you", "Requests"),
        content = { JobsScreen(app, account, withOrders = false) },
    ),
)
