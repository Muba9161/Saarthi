package com.saarthi.owner.ui.personal

import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.fleet.FleetListScreen
import com.saarthi.owner.ui.fleet.FleetMapScreen
import com.saarthi.owner.ui.shell.TabHeader
import com.saarthi.owner.ui.shell.TabSpec

/**
 * A personal account's tabs: Home, Vehicles, Map, Papers.
 *
 * Home shows one vehicle at a time; Vehicles is the whole list, the fleet's own
 * board without its drivers, so every vehicle on the account is one tap away.
 */
fun personalTabs(app: OwnerApp, account: SessionStore.Account): List<TabSpec> = listOf(
    TabSpec(
        key = "home",
        label = "Home",
        icon = Lucide.home,
        header = TabHeader("Personal", "Hi, ${account.firstName}"),
        content = { actions -> PersonalHomeScreen(app, account, actions) },
    ),
    TabSpec(
        key = "vehicles",
        label = "Vehicles",
        icon = Lucide.car,
        header = TabHeader("Personal", "Your vehicles"),
        content = { FleetListScreen(app, account, withDrivers = false) },
    ),
    TabSpec(
        key = "map",
        label = "Map",
        icon = Lucide.map,
        header = null,
        content = { FleetMapScreen(app, account) },
    ),
    TabSpec(
        key = "papers",
        label = "Papers",
        icon = Lucide.fileText,
        header = TabHeader("Your vehicles", "Your papers"),
        content = { PersonalPapersScreen(app) },
    ),
)
