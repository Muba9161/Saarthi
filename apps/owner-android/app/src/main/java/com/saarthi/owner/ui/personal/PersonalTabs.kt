package com.saarthi.owner.ui.personal

import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.fleet.FleetListScreen
import com.saarthi.owner.ui.fleet.FleetMapScreen
import com.saarthi.owner.ui.shell.TabHeader
import com.saarthi.owner.ui.shell.TabSpec

/**
 * A personal account's tabs: Home, Vehicles, Map, Papers.
 *
 * Home shows one vehicle at a time; Vehicles is the whole list, the fleet's own
 * board with its vehicles and drivers, so every vehicle on the account is one
 * tap away.
 */
fun personalTabs(app: OwnerApp, account: SessionStore.Account): List<TabSpec> = listOf(
    TabSpec(
        key = "home",
        label = Words.get(R.string.fleet_tab_home),
        icon = Lucide.home,
        header = TabHeader(Words.get(R.string.fleet_personal_header_personal), Words.get(R.string.fleet_greeting, account.firstName)),
        content = { actions -> PersonalHomeScreen(app, account, actions) },
    ),
    TabSpec(
        key = "vehicles",
        label = Words.get(R.string.fleet_personal_tab_vehicles),
        icon = Lucide.car,
        header = TabHeader(Words.get(R.string.fleet_personal_header_personal), Words.get(R.string.fleet_personal_header_your_vehicles)),
        content = { FleetListScreen(app, account) },
    ),
    TabSpec(
        key = "map",
        label = Words.get(R.string.fleet_tab_map),
        icon = Lucide.map,
        header = null,
        content = { FleetMapScreen(app, account) },
    ),
    TabSpec(
        key = "papers",
        label = Words.get(R.string.fleet_personal_tab_papers),
        icon = Lucide.fileText,
        header = TabHeader(Words.get(R.string.fleet_personal_header_your_vehicles), Words.get(R.string.fleet_personal_header_your_papers)),
        content = { PersonalPapersScreen(app) },
    ),
)
