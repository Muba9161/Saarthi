package com.saarthi.driver.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ExperimentalAnimationApi
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.ui.unit.IntOffset
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.windowsizeclass.WindowSizeClass
import androidx.compose.material3.windowsizeclass.WindowWidthSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.collectAsState
import com.saarthi.core.ui.screens.CockpitScreen
import com.saarthi.core.ui.screens.SplashScreen
import kotlinx.coroutines.delay

/**
 * The whole of the driver app, as one surface.
 *
 * Which screen shows is derived from where the driver is, never from navigation
 * history — the same rule the fitted terminal follows and for the same reason.
 * A driver approved onto a truck cannot press Back into the scanner, because
 * "unscanning" is not a thing the fleet that approved them would recognise.
 *
 * The last stage hands over entirely: once approved and paired, this is the
 * cockpit from `:core`, the same code the tablet runs, with no driver-app
 * chrome around it. That is the point of the whole split — a driver gets the
 * fitted-terminal experience on a phone they already own.
 */
@OptIn(ExperimentalAnimationApi::class)
@Composable
fun DriverRoot(
    driver: DriverViewModel,
    cockpit: com.saarthi.core.ui.TerminalViewModel,
    windowSize: WindowSizeClass,
    onDarkThemeChanged: (Boolean) -> Unit,
) {
    val stage by driver.stage.collectAsState()
    val expanded = windowSize.widthSizeClass != WindowWidthSizeClass.Compact

    /*
     * Settings, over the cockpit rather than beside it.
     *
     * A driver signed on to a vehicle never goes back to the screen where they
     * chose it, so the account controls have to be reachable from where they
     * actually are. Kept as an overlay rather than a stage because it is not a
     * step in the shift — closing it must put them back exactly where they were,
     * mid-trip and all.
     */
    var showSecurity by rememberSaveable { mutableStateOf(false) }
    var showProfile by rememberSaveable { mutableStateOf(false) }
    val driverAccount by driver.account.collectAsState()

    /*
     * Poll while the fleet is deciding.
     *
     * The realtime channel needs a device credential, and the phone has not
     * earned one yet — pairing is what approval buys. So this stretch is the one
     * place the app polls, and it stops the moment the answer arrives.
     */
    LaunchedEffect(stage) {
        if (stage !is DriverViewModel.Stage.AwaitingApproval) return@LaunchedEffect
        while (true) {
            delay(APPROVAL_POLL_MS)
            driver.refreshAssignment()
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .let { it },
    ) {
        AnimatedContent(
            targetState = stage::class,
            /*
             * Forward motion, not a cross-fade.
             *
             * A shift is a sequence — sign in, choose a vehicle, wait, drive —
             * and a screen that slides in from the right says so, where a fade
             * says only that something changed. The spring is lightly damped so
             * it settles rather than bounces: this is a working app in a cab,
             * not a showcase.
             *
             * `SizeTransform(clip = false)` because the cockpit's map must not
             * be clipped to the previous screen's height while it arrives.
             */
            transitionSpec = {
                val motion = spring<IntOffset>(
                    dampingRatio = Spring.DampingRatioNoBouncy,
                    stiffness = Spring.StiffnessMediumLow,
                )
                (
                    slideInHorizontally(motion) { it / 6 } +
                        fadeIn(spring(stiffness = Spring.StiffnessMediumLow))
                    ) togetherWith (
                    slideOutHorizontally(motion) { -it / 8 } +
                        fadeOut(spring(stiffness = Spring.StiffnessMedium))
                    ) using SizeTransform(clip = false)
            },
            label = "driver-stage",
        ) { _ ->
            when (val current = stage) {
                is DriverViewModel.Stage.Restoring -> SplashScreen()

                is DriverViewModel.Stage.SignedOut -> SignInScreen(driver)

                is DriverViewModel.Stage.Locked ->
                    QuickLoginScreen(driver, current.methods)

                is DriverViewModel.Stage.OfferQuickLogin ->
                    QuickLoginOfferScreen(driver, current.driver)

                is DriverViewModel.Stage.ChooseVehicle ->
                    ScanVehicleScreen(
                        viewModel = driver,
                        driver = current.driver,
                        onDarkThemeChanged = onDarkThemeChanged,
                        onOpenProfile = { showProfile = true },
                    )

                is DriverViewModel.Stage.Selfie ->
                    SelfieCaptureScreen(driver, current.assignment)

                is DriverViewModel.Stage.AwaitingApproval ->
                    AwaitingApprovalScreen(driver, current.assignment)

                is DriverViewModel.Stage.Rejected ->
                    AssignmentRejectedScreen(driver, current.assignment)

                is DriverViewModel.Stage.Driving ->
                    CockpitScreen(
                        viewModel = cockpit,
                        expanded = expanded,
                        onOpenSecurity = { showProfile = true },
                        // No admin surface on a driver's own phone. The tablet
                        // has one because an engineer may need diagnostics on a
                        // unit nobody can reach; a phone's owner can simply
                        // reinstall the app.
                        onOpenAdmin = {},
                    )
            }
        }

        /*
         * Profile and security, over the top.
         *
         * Slid up rather than swapped in, because they are a detour from the
         * shift rather than a step in it — and closing one has to put the driver
         * back exactly where they were, mid-trip and all.
         */
        AnimatedVisibility(
            visible = showProfile,
            enter = slideInVertically(
                spring(dampingRatio = Spring.DampingRatioNoBouncy),
            ) { it } + fadeIn(),
            exit = slideOutVertically { it } + fadeOut(),
        ) {
            val account = driverAccount
            if (account != null) {
                DriverProfileScreen(driver, cockpit, account) { showProfile = false }
            }
        }

        AnimatedVisibility(
            visible = showSecurity,
            enter = slideInVertically(
                spring(dampingRatio = Spring.DampingRatioNoBouncy),
            ) { it } + fadeIn(),
            exit = slideOutVertically { it } + fadeOut(),
        ) {
            DriverSecurityScreen(driver) { showSecurity = false }
        }
    }
}

/** How often to ask whether the fleet has decided. */
private const val APPROVAL_POLL_MS = 5_000L
