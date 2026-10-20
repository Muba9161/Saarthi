package com.saarthi.owner.ui.fleet

import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.jobs.JobsScreen
import com.saarthi.owner.ui.shell.TabHeader
import com.saarthi.owner.ui.shell.TabSpec

/** A fleet's tabs, as the design lays them out: Home, Map, Fleet, Jobs. */
fun fleetTabs(app: OwnerApp, account: SessionStore.Account): List<TabSpec> = listOf(
    TabSpec(
        key = "home",
        label = Words.get(R.string.fleet_tab_home),
        icon = Lucide.home,
        header = TabHeader(account.organizationName, Words.get(R.string.fleet_greeting, account.firstName)),
        content = { actions -> FleetHomeScreen(app, account, actions.openAlerts, onOpenMap = { actions.selectTab("map") }) },
    ),
    TabSpec(
        key = "map",
        label = Words.get(R.string.fleet_tab_map),
        icon = Lucide.map,
        header = null,
        content = { FleetMapScreen(app, account) },
    ),
    TabSpec(
        key = "fleet",
        label = Words.get(R.string.fleet_tab_fleet),
        icon = Lucide.truck,
        header = TabHeader(Words.get(R.string.fleet_tab_header_vehicles_drivers), Words.get(R.string.fleet_tab_header_your_fleet)),
        content = { FleetListScreen(app, account) },
    ),
    TabSpec(
        key = "jobs",
        label = Words.get(R.string.fleet_tab_jobs),
        icon = Lucide.briefcase,
        header = TabHeader(Words.get(R.string.fleet_tab_header_on_your_routes), Words.get(R.string.fleet_tab_header_bid_on_work)),
        content = { JobsScreen(app, account) },
    ),
)
