package com.saarthi.owner.ui.shell

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.AccountType
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.ui.account.AccountScreen
import com.saarthi.owner.ui.alerts.AlertsScreen
import com.saarthi.owner.ui.common.OwnerHeader
import com.saarthi.owner.ui.design.Ease
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.fleet.FleetListScreen
import com.saarthi.owner.ui.home.HomeScreen
import kotlinx.coroutines.delay

/** A tab along the foot of the app. */
enum class Tab(val label: String, val icon: String) {
    HOME("Home", Lucide.home),
    FLEET("Fleet", Lucide.truck),
    ACCOUNT("Account", Lucide.user),
}

/** The tabs an account carries: only a business that runs vehicles has a fleet to list. */
fun tabsFor(type: AccountType): List<Tab> = when (type) {
    AccountType.FLEET, AccountType.PERSONAL, AccountType.TRAVEL -> listOf(Tab.HOME, Tab.FLEET, Tab.ACCOUNT)
    else -> listOf(Tab.HOME, Tab.ACCOUNT)
}

/** How often the bell asks for its count while the app is open. */
private const val UNREAD_POLL_MS = 30_000L

/**
 * Inside an account: the current tab under a fixed header, with the tab bar
 * floating over the foot — the driver app's shell.
 *
 * Alerts slide in over everything from the bell rather than taking a tab.
 */
@Composable
fun HomeShell(app: OwnerApp, account: SessionStore.Account, onSignOut: () -> Unit) {
    val tabs = tabsFor(account.accountType)
    var tab by rememberSaveable { mutableStateOf(Tab.HOME) }
    var alertsOpen by rememberSaveable { mutableStateOf(false) }
    var unread by rememberSaveable { mutableIntStateOf(0) }
    val c = Saarthi.colors

    // The bell's count, re-read on a slow clock and whenever alerts close.
    LaunchedEffect(alertsOpen) {
        if (alertsOpen) return@LaunchedEffect
        while (true) {
            runCatching { app.alerts.unreadCount() }.onSuccess { unread = it }
            delay(UNREAD_POLL_MS)
        }
    }

    BackHandler(enabled = alertsOpen || tab != Tab.HOME) {
        if (alertsOpen) alertsOpen = false else tab = Tab.HOME
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(c.canvas),
    ) {
        TabPanes(tab) { shown ->
            when (shown) {
                Tab.HOME -> HomeScreen(app = app, account = account, onOpenAlerts = { alertsOpen = true })
                Tab.FLEET -> FleetListScreen(app = app, account = account)
                Tab.ACCOUNT -> AccountScreen(account = account, preferences = app.preferences, onSignOut = onSignOut)
            }
        }

        OwnerHeader(
            eyebrow = when (tab) {
                Tab.HOME -> account.organizationName
                Tab.FLEET -> "Vehicles & drivers"
                Tab.ACCOUNT -> "Your account"
            },
            title = when (tab) {
                Tab.HOME -> "Hi, ${account.firstName}"
                Tab.FLEET -> if (account.accountType == AccountType.FLEET) "Your fleet" else "Your vehicles"
                Tab.ACCOUNT -> "Account"
            },
            unread = unread,
            onBell = { alertsOpen = true },
            modifier = Modifier.align(Alignment.TopCenter),
        )

        OwnerTabBar(
            tabs = tabs,
            active = tab,
            onSelect = { tab = it },
            modifier = Modifier.align(Alignment.BottomCenter),
        )

        AnimatedVisibility(
            visible = alertsOpen,
            enter = slideInHorizontally(tween(450, easing = Ease.out)) { it / 3 } + fadeIn(tween(350)),
            exit = slideOutHorizontally(tween(300, easing = Ease.standard)) { it / 3 } + fadeOut(tween(250)),
        ) {
            AlertsScreen(api = app.alerts, onBack = { alertsOpen = false })
        }
    }
}

/** The tabs, sliding the way the tab bar moved. */
@Composable
private fun TabPanes(tab: Tab, content: @Composable (Tab) -> Unit) {
    val shift = with(LocalDensity.current) { 36.dp.roundToPx() }
    val reduced = Saarthi.reducedMotion
    AnimatedContent(
        targetState = tab,
        transitionSpec = {
            val forward = targetState.ordinal > initialState.ordinal
            if (reduced) {
                fadeIn(tween(0)) togetherWith fadeOut(tween(0))
            } else {
                (slideInHorizontally(tween(500, easing = Ease.out)) { if (forward) shift else -shift } + fadeIn(tween(500, easing = Ease.out))) togetherWith
                    fadeOut(tween(200))
            }
        },
        label = "owner-tabs",
    ) { shown -> content(shown) }
}
