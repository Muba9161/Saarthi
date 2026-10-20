package com.saarthi.owner.ui.seller

import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.shell.TabHeader
import com.saarthi.owner.ui.shell.TabSpec

/** A seller's tabs, as the design lays them out: Home, Stock, Loading, Money. */
fun sellerTabs(app: OwnerApp, account: SessionStore.Account): List<TabSpec> = listOf(
    TabSpec(
        key = "home",
        label = Words.get(R.string.market_seller_tab_home),
        icon = Lucide.home,
        header = TabHeader(account.organizationName, Words.get(R.string.market_seller_tab_greeting, account.firstName)),
        content = { actions -> SellerHomeScreen(app, actions) },
    ),
    TabSpec(
        key = "stock",
        label = Words.get(R.string.market_seller_stock),
        icon = Lucide.box,
        header = TabHeader(Words.get(R.string.market_seller_what_fleets_see), Words.get(R.string.market_seller_tab_stock_title)),
        content = { SellerStockScreen(app, account) },
    ),
    TabSpec(
        key = "loading",
        label = Words.get(R.string.market_seller_tab_loading),
        icon = Lucide.truck,
        header = TabHeader(Words.get(R.string.market_seller_tab_loading_eyebrow), Words.get(R.string.market_seller_tab_loading)),
        content = { SellerLoadingScreen(app) },
    ),
    TabSpec(
        key = "money",
        label = Words.get(R.string.market_seller_tab_money),
        icon = Lucide.receipt,
        header = TabHeader(Words.get(R.string.market_seller_tab_money_eyebrow), Words.get(R.string.market_seller_tab_money)),
        content = { SellerMoneyScreen(app) },
    ),
)
