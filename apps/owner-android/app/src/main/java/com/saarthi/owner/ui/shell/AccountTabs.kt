package com.saarthi.owner.ui.shell

import androidx.compose.runtime.Composable
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.AccountType
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.ui.account.AccountScreen
import com.saarthi.owner.ui.association.associationTabs
import com.saarthi.owner.ui.customer.customerTabs
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.fleet.fleetTabs
import com.saarthi.owner.ui.home.businessTabs
import com.saarthi.owner.ui.personal.personalTabs
import com.saarthi.owner.ui.seller.sellerTabs
import com.saarthi.owner.ui.travel.travelTabs

/**
 * Which tabs an account opens on — each kind of business lists its own.
 *
 * The Account tab is added after these by the shell, the same for everyone.
 */
@Composable
fun tabsFor(app: OwnerApp, account: SessionStore.Account): List<TabSpec> = when (account.accountType) {
    AccountType.FLEET -> fleetTabs(app, account)
    AccountType.CUSTOMER -> customerTabs(app, account)
    AccountType.SELLER -> sellerTabs(app, account)
    AccountType.TRAVEL -> travelTabs(app, account)
    AccountType.ASSOCIATION -> associationTabs(app, account)
    AccountType.PERSONAL -> personalTabs(app, account)
    else -> businessTabs(app, account)
}

/** The last tab of every account: who is signed in, how the app looks, the way out. */
fun accountTab(app: OwnerApp, account: SessionStore.Account, onSignOut: () -> Unit) = TabSpec(
    key = "account",
    label = "Account",
    icon = Lucide.user,
    header = TabHeader("Your account", "Account"),
    content = { AccountScreen(account = account, preferences = app.preferences, api = app.api, onSignOut = onSignOut) },
)
