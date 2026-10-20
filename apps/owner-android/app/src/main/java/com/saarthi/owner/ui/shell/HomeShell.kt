package com.saarthi.owner.ui.shell

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.AlertsApi
import com.saarthi.owner.push.Push
import com.saarthi.owner.ui.alerts.AlertTarget
import com.saarthi.owner.ui.alerts.AlertsScreen
import com.saarthi.owner.ui.alerts.resolveAlertLink
import com.saarthi.owner.ui.assistant.AssistantScreen
import com.saarthi.owner.ui.common.OwnerHeader
import com.saarthi.owner.ui.design.Ease
import com.saarthi.owner.ui.design.Saarthi
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** How often the bell asks for its count while the app is open. */
private const val UNREAD_POLL_MS = 30_000L

/**
 * Inside an account: the current tab under a fixed header, the tab bar
 * floating over the foot — the driver app's shell — and any screens opened
 * on top sliding in over both.
 *
 * Which tabs there are is the account's business (see [tabsFor]); the shell
 * adds the Account tab and the alerts to every one of them.
 */
@Composable
fun HomeShell(app: OwnerApp, account: SessionStore.Account, onSignOut: () -> Unit) {
    val navigator = remember { Navigator() }
    val overlays = remember { OverlayHost() }
    // Every screen model belongs to this signed-in session and goes with it:
    // signing in as somebody else must never show the last person's fleet.
    val models = remember(account.userId, account.organizationId) {
        object : ViewModelStoreOwner {
            override val viewModelStore = ViewModelStore()
        }
    }
    DisposableEffect(models) { onDispose { models.viewModelStore.clear() } }
    val tabs = tabsFor(app, account) + accountTab(app, account, onSignOut)
    var current by rememberSaveable { mutableStateOf(tabs.first().key) }
    val tab = tabs.firstOrNull { it.key == current } ?: tabs.first()
    var unread by rememberSaveable { mutableIntStateOf(0) }
    val c = Saarthi.colors

    val scope = rememberCoroutineScope()
    /** Open what an alert or a tapped push is about: a tab, or a screen over it. */
    val followLink: (String) -> Unit = { link ->
        scope.launch {
            when (val target = resolveAlertLink(app, account, link)) {
                is AlertTarget.Tab -> {
                    navigator.popAll()
                    current = target.key
                }
                is AlertTarget.Screen -> navigator.push(target.key, target.content)
                null -> Unit
            }
        }
    }
    val followAlert: (AlertsApi.Alert) -> Unit = { alert -> alert.actionUrl?.let(followLink) }

    // Push: this phone gets this person's news while signed in, and a tapped
    // notification opens what it is about.
    val context = LocalContext.current
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(account.userId) {
        if (!Push.enabled) return@LaunchedEffect
        runCatching { Push.register(app.api) }
        val missing = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        if (missing && !app.preferences.notificationsAsked) {
            app.preferences.notificationsAsked = true
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    val pendingLink by Push.pendingLink.collectAsStateWithLifecycle()
    LaunchedEffect(pendingLink) {
        pendingLink?.let { link ->
            Push.consumeLink()
            followLink(link)
        }
    }
    val openAlerts = {
        navigator.push("alerts") { AlertsScreen(api = app.alerts, onBack = navigator::pop, onFollow = followAlert) }
    }
    val actions = remember(navigator) {
        ShellActions(openAlerts = openAlerts, selectTab = { key -> current = key })
    }

    // The bell's count, re-read on a slow clock and whenever the screens on top change.
    LaunchedEffect(navigator.stack.size) {
        while (true) {
            runCatching { app.alerts.unreadCount() }.onSuccess { unread = it }
            delay(UNREAD_POLL_MS)
        }
    }

    BackHandler(enabled = navigator.canPop || tab.key != tabs.first().key) {
        if (navigator.canPop) navigator.pop() else current = tabs.first().key
    }

    CompositionLocalProvider(
        LocalNavigator provides navigator,
        LocalOverlayHost provides overlays,
        LocalViewModelStoreOwner provides models,
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .background(c.canvas),
        ) {
            TabPanes(tab, tabs) { shown -> shown.content(actions) }

            tab.header?.let { header ->
                OwnerHeader(
                    eyebrow = header.eyebrow,
                    title = header.title,
                    unread = unread,
                    onBell = openAlerts,
                    // Both, as the server asks: the role may use the assistant and the plan includes it.
                    onAssistant = if (account.can("ai.use") && account.hasFeature("ai.copilot")) {
                        { navigator.push("assistant") { AssistantScreen(app.assistant, account) } }
                    } else {
                        null
                    },
                    modifier = Modifier.align(Alignment.TopCenter),
                )
            }

            OwnerTabBar(
                tabs = tabs,
                active = tab,
                onSelect = { current = it.key },
                modifier = Modifier.align(Alignment.BottomCenter),
            )

            // Sheets a tab opened, above its own tab bar.
            overlays.Draw()

            navigator.stack.forEach { entry ->
                key(entry) { Opened(entry, navigator) }
            }
        }
    }
}

/** One opened screen, sliding in from the right and back out the same way. */
@Composable
private fun Opened(entry: Navigator.Entry, navigator: Navigator) {
    val reduced = Saarthi.reducedMotion
    AnimatedVisibility(
        visibleState = entry.visibility,
        enter = if (reduced) fadeIn(tween(0)) else slideInHorizontally(tween(450, easing = Ease.out)) { it / 3 } + fadeIn(tween(350)),
        exit = if (reduced) fadeOut(tween(0)) else slideOutHorizontally(tween(280, easing = Ease.standard)) { it / 3 } + fadeOut(tween(240)),
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Saarthi.colors.canvas),
        ) {
            entry.content()
        }
    }
    LaunchedEffect(entry.visibility.isIdle, entry.visibility.currentState) {
        if (entry.visibility.isIdle && !entry.visibility.currentState) navigator.forget(entry)
    }
}

/** The tabs, sliding the way the tab bar moved. */
@Composable
private fun TabPanes(tab: TabSpec, tabs: List<TabSpec>, content: @Composable (TabSpec) -> Unit) {
    val shift = with(LocalDensity.current) { 36.dp.roundToPx() }
    val reduced = Saarthi.reducedMotion
    AnimatedContent(
        targetState = tab.key,
        transitionSpec = {
            val forward = tabs.indexOfFirst { it.key == targetState } > tabs.indexOfFirst { it.key == initialState }
            if (reduced) {
                fadeIn(tween(0)) togetherWith fadeOut(tween(0))
            } else {
                (slideInHorizontally(tween(500, easing = Ease.out)) { if (forward) shift else -shift } + fadeIn(tween(500, easing = Ease.out))) togetherWith
                    fadeOut(tween(200))
            }
        },
        label = "owner-tabs",
    ) { key -> tabs.firstOrNull { it.key == key }?.let { content(it) } }
}
