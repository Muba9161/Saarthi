package com.saarthi.owner.ui.customer

import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.shell.TabHeader
import com.saarthi.owner.ui.shell.TabSpec

/** A customer's tabs, as the design lays them out: Home, Post, Orders. */
fun customerTabs(app: OwnerApp, account: SessionStore.Account): List<TabSpec> = listOf(
    TabSpec(
        key = "home",
        label = Words.get(R.string.customer_tab_home),
        icon = Lucide.home,
        header = TabHeader(account.organizationName, Words.get(R.string.customer_tab_home_title, account.firstName)),
        content = { actions -> CustomerHomeScreen(app, actions) },
    ),
    TabSpec(
        key = "post",
        label = Words.get(R.string.customer_tab_post),
        icon = Lucide.plus,
        header = TabHeader(Words.get(R.string.customer_tab_post_eyebrow), Words.get(R.string.customer_tab_post_title)),
        content = { actions -> PostRequirementScreen(app, actions) },
    ),
    TabSpec(
        key = "orders",
        label = Words.get(R.string.customer_tab_orders),
        icon = Lucide.box,
        header = TabHeader(Words.get(R.string.customer_tab_orders_eyebrow), Words.get(R.string.customer_your_orders)),
        content = { CustomerOrdersScreen(app) },
    ),
)
