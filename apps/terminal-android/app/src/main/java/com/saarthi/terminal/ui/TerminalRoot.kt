package com.saarthi.terminal.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ExperimentalAnimationApi
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.windowsizeclass.WindowSizeClass
import androidx.compose.material3.windowsizeclass.WindowWidthSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.saarthi.terminal.domain.TerminalState
import com.saarthi.terminal.kiosk.KioskController
import com.saarthi.terminal.ui.screens.AdminGate
import com.saarthi.terminal.ui.screens.AdminScreen
import com.saarthi.terminal.ui.screens.ApprovalWaitingScreen
import com.saarthi.terminal.ui.screens.ChecklistScreen
import com.saarthi.terminal.ui.screens.CockpitScreen
import com.saarthi.terminal.ui.screens.PairingScreen
import com.saarthi.terminal.ui.screens.RejectedScreen
import com.saarthi.terminal.ui.screens.RevokedScreen
import com.saarthi.terminal.ui.screens.SplashScreen
import com.saarthi.terminal.ui.screens.VehicleIdentityScreen
import com.saarthi.terminal.ui.screens.WelcomeScreen

/**
 * What the terminal shows, decided in one place.
 *
 * The whole app is a function of [TerminalState] — a `when` over a single value
 * the server owns, rather than a navigation graph the app pushes and pops. That
 * is section 8's rule made structural: there is no route a driver can reach that
 * disagrees with the vehicle's actual state, because there is no route at all.
 * A rejection arriving over the socket does not need anybody to pop a back
 * stack; the state changes and the screen follows.
 *
 * The admin surface is the one exception, and it sits *over* the state rather
 * than inside it: an engineer must be able to reach diagnostics whatever the
 * vehicle is doing, including when the terminal is unpaired and broken.
 */
@OptIn(ExperimentalAnimationApi::class)
@Composable
fun TerminalRoot(
    viewModel: TerminalViewModel,
    windowSize: WindowSizeClass,
    kiosk: KioskController,
    onReducedMotionChanged: (Boolean) -> Unit,
    onDarkThemeChanged: (Boolean) -> Unit,
    onEnterKiosk: () -> Unit,
    onExitKiosk: () -> Unit,
) {
    val uiState by viewModel.uiState.collectAsState()
    val reducedMotion = LocalReducedMotion.current
    val context = LocalContext.current

    var showSplash by remember { mutableStateOf(true) }
    var showAdmin by remember { mutableStateOf(false) }

    /*
     * The diagnostics gate (section 46).
     *
     * Unlocked per visit rather than remembered. A terminal left on the
     * diagnostics screen at the end of a shift must not still be open on it in
     * the morning for whoever gets in the cab next.
     */
    var adminUnlocked by remember { mutableStateOf(false) }

    /*
     * The splash lasts exactly as long as it takes to be useful.
     *
     * Section 58: a short, polished entrance that does not delay startup. So it
     * is dismissed on a timer *or* the moment the first state arrives, whichever
     * comes first — a terminal that already knows what to show should show it.
     */
    LaunchedEffect(uiState.server) {
        if (uiState.server != null) showSplash = false
    }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(1_400)
        showSplash = false
    }

    /** A tablet is 600dp or wider. Everything narrower gets the phone layout. */
    val expanded = windowSize.widthSizeClass != WindowWidthSizeClass.Compact

    Box(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        AnimatedContent(
            targetState = when {
                showSplash -> Screen.SPLASH
                showAdmin && !adminUnlocked -> Screen.ADMIN_LOCKED
                showAdmin -> Screen.ADMIN
                uiState.revoked -> Screen.REVOKED
                else -> when (uiState.state) {
                    TerminalState.UNPAIRED, TerminalState.PAIRING -> Screen.PAIRING
                    TerminalState.VEHICLE_PAIRED,
                    TerminalState.AWAITING_DRIVER,
                    -> Screen.VEHICLE_IDENTITY

                    TerminalState.DRIVER_IDENTIFIED,
                    TerminalState.SELFIE_SUBMITTED,
                    TerminalState.PENDING_APPROVAL,
                    -> Screen.WAITING

                    TerminalState.APPROVED -> Screen.WELCOME
                    TerminalState.CHECKLIST_REQUIRED -> Screen.CHECKLIST
                    TerminalState.READY,
                    TerminalState.TRIP_ACTIVE,
                    TerminalState.TRIP_COMPLETED,
                    -> Screen.COCKPIT

                    TerminalState.REJECTED -> Screen.REJECTED
                    TerminalState.REVOKED -> Screen.REVOKED
                }
            },
            transitionSpec = {
                // Section 57 asks for polished transitions; section 23 asks that
                // nothing distracting happens while driving. A cross-fade is the
                // compromise: it reads as deliberate and it does not move.
                val duration = if (reducedMotion) 0 else 320
                fadeIn(tween(duration)) togetherWith fadeOut(tween(duration))
            },
            label = "terminal-screen",
        ) { screen ->
            Box(Modifier.fillMaxSize()) {
                when (screen) {
                    Screen.SPLASH -> SplashScreen()

                    Screen.PAIRING -> PairingScreen(
                        viewModel = viewModel,
                        expanded = expanded,
                        onOpenAdmin = { showAdmin = true },
                    )

                    Screen.VEHICLE_IDENTITY -> VehicleIdentityScreen(
                        viewModel = viewModel,
                        expanded = expanded,
                        onOpenAdmin = { showAdmin = true },
                    )

                    Screen.WAITING -> ApprovalWaitingScreen(viewModel = viewModel)

                    Screen.WELCOME -> WelcomeScreen(viewModel = viewModel)

                    Screen.CHECKLIST -> ChecklistScreen(
                        viewModel = viewModel,
                        expanded = expanded,
                    )

                    Screen.COCKPIT -> CockpitScreen(
                        viewModel = viewModel,
                        expanded = expanded,
                        onOpenAdmin = { showAdmin = true },
                    )

                    Screen.REJECTED -> RejectedScreen(viewModel = viewModel)

                    Screen.REVOKED -> RevokedScreen(
                        viewModel = viewModel,
                        onOpenAdmin = { showAdmin = true },
                    )

                    Screen.ADMIN_LOCKED -> AdminGate(
                        settings = viewModel.settings,
                        onUnlocked = { adminUnlocked = true },
                        onCancel = { showAdmin = false },
                    )

                    Screen.ADMIN -> AdminScreen(
                        viewModel = viewModel,
                        kiosk = kiosk,
                        onClose = {
                            showAdmin = false
                            adminUnlocked = false
                        },
                        onReducedMotionChanged = onReducedMotionChanged,
                        onDarkThemeChanged = onDarkThemeChanged,
                        onEnterKiosk = onEnterKiosk,
                        onExitKiosk = onExitKiosk,
                    )
                }
            }
        }
    }
}

private enum class Screen {
    SPLASH,
    PAIRING,
    VEHICLE_IDENTITY,
    WAITING,
    WELCOME,
    CHECKLIST,
    COCKPIT,
    REJECTED,
    REVOKED,
    ADMIN_LOCKED,
    ADMIN,
}

/**
 * A page frame with the system-bar padding every screen needs.
 *
 * Scrolls by default, and that default is the fix for a real bug: this was a
 * plain `Column`, so on a phone — where the vehicle QR and the detail panel
 * stack rather than sitting side by side — everything below the fold was simply
 * unreachable. On a 10-inch tablet in landscape the same screens fit and the
 * scroll never engages, which is why it went unnoticed.
 *
 * `scrollable = false` is for the screens that manage their own scrolling: a
 * `LazyColumn` inside a scrolling parent has infinite height available and
 * throws, and a full-bleed map must not scroll at all.
 */
@Composable
fun TerminalPage(
    modifier: Modifier = Modifier,
    scrollable: Boolean = true,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    val base = modifier
        .fillMaxSize()
        .systemBarsPadding()

    Column(
        if (scrollable) {
            base.verticalScroll(rememberScrollState()).padding(Gutter)
        } else {
            base.padding(Gutter)
        },
        content = content,
    )
}
