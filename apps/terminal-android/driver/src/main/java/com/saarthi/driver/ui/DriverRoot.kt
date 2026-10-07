package com.saarthi.driver.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.data.DriverPreferences
import com.saarthi.driver.ui.auth.QuickLoginOfferFlow
import com.saarthi.driver.ui.auth.SignedOutFlow
import com.saarthi.driver.ui.auth.UnlockScreen
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.shift.ShiftShell
import com.saarthi.driver.ui.shift.adapter.AdapterSheet
import com.saarthi.driver.ui.splash.SplashScreen
import com.saarthi.driver.ui.start.ApprovedScreen
import com.saarthi.driver.ui.start.ArrivalPhotoScreen
import com.saarthi.driver.ui.start.AwaitingApprovalScreen
import com.saarthi.driver.ui.start.ChooseVehicleScreen
import com.saarthi.driver.ui.start.RejectedScreen
import kotlinx.coroutines.delay

/**
 * The whole of the driver app, as one surface.
 *
 * Which screen shows is derived from where the driver is, never from navigation
 * history — the same rule the fitted terminal follows. A driver approved onto a
 * truck cannot press Back into the scanner, because "unscanning" is not a thing
 * the fleet that approved them would recognise.
 */
@Composable
fun DriverRoot(
    driver: DriverViewModel,
    cockpit: TerminalViewModel,
    preferences: DriverPreferences,
) {
    val stage by driver.stage.collectAsState()

    /*
     * The splash holds for at least a moment.
     *
     * A session usually restores in well under a second, which would flash the
     * logo and cut it off mid-stroke. Holding it until the lockup has drawn
     * itself is the difference between a brand moment and a flicker.
     */
    var splashDone by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(SPLASH_MIN_MS)
        splashDone = true
    }

    // Which of sign-in and registration just succeeded, for the screen after.
    var creatingAccount by rememberSaveable { mutableStateOf(false) }

    /*
     * The fleet's yes, celebrated once.
     *
     * Raised only when the driver watched the wait and approval arrived — not
     * when they reopen the app already signed on, which would celebrate the
     * same approval every morning.
     */
    var sawWaiting by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(stage) {
        when (stage) {
            is DriverViewModel.Stage.AwaitingApproval -> sawWaiting = true
            is DriverViewModel.Stage.ChooseVehicle, is DriverViewModel.Stage.SignedOut -> sawWaiting = false
            else -> Unit
        }
    }

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

    /*
     * Keep connecting while on shift without the vehicle.
     *
     * Pairing is attempted when the shift opens, and nothing tried again: a
     * phone that was offline at that moment, or whose identity Saarthi later
     * refused, sat on "Not connected" until the app was restarted. Asking where
     * the driver stands re-pairs them if the shift still holds, and moves them
     * on if it does not.
     */
    val cockpitState by cockpit.uiState.collectAsState()
    val unpairedOnShift = stage is DriverViewModel.Stage.Driving && !cockpitState.state.pairedToVehicle
    LaunchedEffect(unpairedOnShift) {
        if (!unpairedOnShift) return@LaunchedEffect
        while (true) {
            delay(PAIRING_RETRY_MS)
            driver.refreshAssignment()
        }
    }

    val fleet by driver.fleet.collectAsState()

    val slide = with(LocalDensity.current) { 48.dp.roundToPx() }
    val shown: DriverViewModel.Stage =
        if (!splashDone) DriverViewModel.Stage.Restoring else stage
    val obdSetup by driver.obdSetup.collectAsState()

    Box(Modifier.fillMaxSize()) {
        AnimatedContent(
            targetState = shown::class,
            transitionSpec = {
                (slideInHorizontally(tween(550, easing = Ease.out)) { slide } + fadeIn(tween(550, easing = Ease.out))) togetherWith
                    fadeOut(tween(220))
            },
            label = "driver-stage",
        ) { _ ->
            when (val current = shown) {
                is DriverViewModel.Stage.Restoring -> SplashScreen()
                is DriverViewModel.Stage.SignedOut -> SignedOutFlow(driver, onCreating = { creatingAccount = it })
                is DriverViewModel.Stage.Locked -> UnlockScreen(driver, current.methods)
                is DriverViewModel.Stage.OfferQuickLogin ->
                    QuickLoginOfferFlow(driver, current.driver, creatingAccount)
                is DriverViewModel.Stage.ChooseVehicle ->
                    ChooseVehicleScreen(driver, current.driver, preferences)
                is DriverViewModel.Stage.Selfie -> ArrivalPhotoScreen(driver, current.assignment)
                is DriverViewModel.Stage.AwaitingApproval -> AwaitingApprovalScreen(driver, current.assignment)
                is DriverViewModel.Stage.Rejected -> RejectedScreen(driver, current.assignment)
                // Decided in the same frame the stage changes, so the shell never
                // flashes up before the celebration replaces it.
                is DriverViewModel.Stage.Driving -> if (sawWaiting) {
                    ApprovedScreen(
                        plate = current.assignment.registrationNumber,
                        fleetName = fleet?.name,
                        onContinue = { sawWaiting = false },
                    )
                } else {
                    ShiftShell(driver, cockpit, preferences, fallbackPlate = current.assignment.registrationNumber)
                }
            }
        }

        /*
         * The vehicle just scanned has a Saarthi OBD: connect it now, while the
         * driver is standing at it, with the same sheet the shift uses later.
         */
        AdapterSheet(visible = obdSetup, cockpit = cockpit, onClose = driver::dismissObdSetup)
    }
}

/** Long enough for the lockup to trace and flood in. */
private const val SPLASH_MIN_MS = 2_200L

/** How often to ask whether the fleet has decided. */
private const val APPROVAL_POLL_MS = 5_000L

/**
 * How often an unpaired phone on shift tries the vehicle again. Slower than
 * the approval poll: each attempt mints a pairing code on the server.
 */
private const val PAIRING_RETRY_MS = 30_000L
