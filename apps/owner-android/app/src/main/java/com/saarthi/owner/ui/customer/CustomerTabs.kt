package com.saarthi.owner.ui.customer

import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.shell.TabHeader
import com.saarthi.owner.ui.shell.TabSpec

/** A customer's tabs, as the design lays them out: Home, Post, Orders. */
fun customerTabs(app: OwnerApp, account: SessionStore.Account): List<TabSpec> = listOf(
    TabSpec(
        key = "home",
        label = "Home",
        icon = Lucide.home,
        header = TabHeader(account.organizationName, "Hi, ${account.firstName}"),
        content = { actions -> CustomerHomeScreen(app, actions) },
    ),
    TabSpec(
        key = "post",
        label = "Post",
        icon = Lucide.plus,
        header = TabHeader("Post a need", "Get bids"),
        content = { actions -> PostRequirementScreen(app, actions) },
    ),
    TabSpec(
        key = "orders",
        label = "Orders",
        icon = Lucide.box,
        header = TabHeader("Requests & orders", "Your orders"),
        content = { CustomerOrdersScreen(app) },
    ),
)
