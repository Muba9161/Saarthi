package com.saarthi.owner.ui.fleet

import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.jobs.JobsScreen
import com.saarthi.owner.ui.shell.TabHeader
import com.saarthi.owner.ui.shell.TabSpec

/** A fleet's tabs, as the design lays them out: Home, Map, Fleet, Jobs. */
fun fleetTabs(app: OwnerApp, account: SessionStore.Account): List<TabSpec> = listOf(
    TabSpec(
        key = "home",
        label = "Home",
        icon = Lucide.home,
        header = TabHeader(account.organizationName, "Hi, ${account.firstName}"),
        content = { actions -> FleetHomeScreen(app, account, actions.openAlerts, onOpenMap = { actions.selectTab("map") }) },
    ),
    TabSpec(
        key = "map",
        label = "Map",
        icon = Lucide.map,
        header = null,
        content = { FleetMapScreen(app, account) },
    ),
    TabSpec(
        key = "fleet",
        label = "Fleet",
        icon = Lucide.truck,
        header = TabHeader("Vehicles & drivers", "Your fleet"),
        content = { FleetListScreen(app, account) },
    ),
    TabSpec(
        key = "jobs",
        label = "Jobs",
        icon = Lucide.briefcase,
        header = TabHeader("On your routes", "Bid on work"),
        content = { JobsScreen(app, account) },
    ),
)
