package com.saarthi.owner.ui.seller

import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.shell.TabHeader
import com.saarthi.owner.ui.shell.TabSpec

/** A seller's tabs, as the design lays them out: Home, Stock, Loading, Money. */
fun sellerTabs(app: OwnerApp, account: SessionStore.Account): List<TabSpec> = listOf(
    TabSpec(
        key = "home",
        label = "Home",
        icon = Lucide.home,
        header = TabHeader(account.organizationName, "Hi, ${account.firstName}"),
        content = { actions -> SellerHomeScreen(app, actions) },
    ),
    TabSpec(
        key = "stock",
        label = "Stock",
        icon = Lucide.box,
        header = TabHeader("What fleets see", "Stock & prices"),
        content = { SellerStockScreen(app) },
    ),
    TabSpec(
        key = "loading",
        label = "Loading",
        icon = Lucide.truck,
        header = TabHeader("Fleets collecting", "Loading"),
        content = { SellerLoadingScreen(app) },
    ),
    TabSpec(
        key = "money",
        label = "Money",
        icon = Lucide.receipt,
        header = TabHeader("Paid by fleets", "Money"),
        content = { SellerMoneyScreen(app) },
    ),
)
