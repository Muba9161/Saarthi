package com.saarthi.driver.ui

import androidx.activity.compose.BackHandler
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
import androidx.compose.material3.windowsizeclass.WindowSizeClass
import androidx.compose.material3.windowsizeclass.WindowWidthSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.runtime.collectAsState
import com.saarthi.core.domain.TerminalState
import com.saarthi.driver.SaarthiDriverApp
import com.saarthi.core.ui.screens.ChecklistScreen
import com.saarthi.core.ui.screens.CockpitSheet
import com.saarthi.driver.ui.design.FleetSplash
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
    val app = LocalContext.current.applicationContext as SaarthiDriverApp
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

    /*
     * Whether the driver has gone through to the map.
     *
     * Kept here rather than as a stage: it is a view the driver chose, not a
     * step the shift is at, and coming back from it must not disturb anything
     * the server thinks is happening.
     */
    var showCockpit by rememberSaveable { mutableStateOf(false) }

    /*
     * Which sheet the cockpit should arrive on.
     *
     * Deliberately not saved across process death: it is the tail end of a tap
     * the driver made seconds ago, and restoring a phone into a half-opened
     * sheet they no longer remember asking for would be worse than restoring it
     * to the map.
     */
    var cockpitEntry by remember { mutableStateOf<CockpitSheet?>(null) }

    /*
     * The safety check, which the driver app could not reach.
     *
     * `ChecklistScreen` was routed only from `TerminalRoot` - the fitted tablet.
     * A driver on their own phone therefore arrived at CHECKLIST_REQUIRED and
     * stopped there for good: no way to answer the check, so no way to reach
     * READY, so no way to start a trip. The whole point of this app is that a
     * driver starts their shift without opening anything else, and the shift
     * could not be started at all.
     *
     * Closed by the state rather than by a button: the check is finished when
     * the server says the vehicle has moved on from CHECKLIST_REQUIRED, and
     * anything else would let the screen linger over a shift already under way.
     */
    var showChecklist by rememberSaveable { mutableStateOf(false) }

    /*
     * Three screens that are detours, not steps.
     *
     * Papers, trips and notices are all things a driver looks at and comes back
     * from — never a stage the shift is at — so they are booleans over the
     * dashboard rather than entries in the stage machine. Closing one must put
     * the driver exactly where they were, mid-trip and all.
     */
    var showPapers by rememberSaveable { mutableStateOf(false) }
    var showTrips by rememberSaveable { mutableStateOf(false) }
    var showNotices by rememberSaveable { mutableStateOf(false) }
    var showFuelSlip by rememberSaveable { mutableStateOf(false) }

    /*
     * A destination somebody sent, taken up as soon as there is a vehicle.
     *
     * Held rather than applied on arrival: a pin can land while the driver is
     * still signing in or waiting to be approved, and dropping it would send
     * them to another app to find it again. Once they are on a vehicle the route
     * is drawn and the map opened — drawn, not started, because a person shared
     * a place and only the driver decides they are going.
     */
    val sharedDestination by app.sharedDestinations.pending.collectAsState()
    LaunchedEffect(sharedDestination, stage) {
        val destination = sharedDestination ?: return@LaunchedEffect
        if (stage !is DriverViewModel.Stage.Driving) return@LaunchedEffect

        app.sharedDestinations.take()
        showChecklist = false
        cockpitEntry = null
        showCockpit = true
        cockpit.navigateToPoint(
            latitude = destination.latitude,
            longitude = destination.longitude,
            label = destination.label,
        )
    }
    val cockpitState by cockpit.uiState.collectAsState()
    LaunchedEffect(cockpitState.state) {
        /*
         * Leave the checklist when it stops being the thing to do.
         *
         * Both states mean the check is outstanding — APPROVED is the platform's
         * word for "authorised, check not done yet" and CHECKLIST_REQUIRED is the
         * same moment named more plainly. Watching only for the second would shut
         * the screen under a driver halfway down it the instant the server
         * reported the first.
         */
        if (!cockpitState.state.checklistOutstanding) showChecklist = false
    }
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
                is DriverViewModel.Stage.Restoring -> FleetSplash()

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

                is DriverViewModel.Stage.Driving -> if (showChecklist) {
                    ChecklistScreen(viewModel = cockpit, expanded = expanded)
                } else if (showPapers) {
                    DriverPapersScreen(cockpit = cockpit, onBack = { showPapers = false })
                } else if (showTrips) {
                    DriverTripsScreen(cockpit = cockpit, onBack = { showTrips = false })
                } else if (showNotices) {
                    DriverNoticesScreen(cockpit = cockpit, onBack = { showNotices = false })
                } else if (showFuelSlip) {
                    FuelSlipScreen(cockpit = cockpit, onBack = { showFuelSlip = false })
                } else if (!showCockpit) {
                    /*
                     * The dashboard first, the map second.
                     *
                     * A driver standing at a loading bay wants to know which
                     * vehicle they are on and whether the fleet is receiving
                     * them; a full-screen map answers neither. The cockpit is
                     * one slide away and is where they stay once moving.
                     */
                    val account = driverAccount
                    if (account != null) {
                        DriverDashboardScreen(
                            cockpit = cockpit,
                            account = account,
                            onOpenProfile = { showProfile = true },
                            onOpenChecklist = { showChecklist = true },
                            onOpenPapers = { showPapers = true },
                            onOpenTrips = { showTrips = true },
                            onOpenNotices = { showNotices = true },
                            onOpenCockpit = {
                                cockpitEntry = null
                                showCockpit = true
                            },
                            onOpenNearby = {
                                cockpitEntry = CockpitSheet.SERVICES
                                showCockpit = true
                            },
                            onSos = {
                                /*
                                 * Arm, do not raise.
                                 *
                                 * `armSos` only opens the confirmation gate the
                                 * cockpit already draws; `triggerSos` is what
                                 * actually calls out a fleet, and no single tap
                                 * on a dashboard tile should be able to do that.
                                 * The driver confirms on the next screen.
                                 */
                                cockpit.armSos()
                                cockpitEntry = null
                                showCockpit = true
                            },
                        )
                    }
                } else {
                    /*
                     * The driver app's own live view, not the tablet's.
                     *
                     * `:core`'s `CockpitScreen` is a landscape instrument panel
                     * for a tablet bolted to a dashboard, and it looked it on a
                     * phone. This is the same machinery — same view model, same
                     * map, same sheets, same voice engine — in the shape the
                     * rest of this app is built in. The tablet keeps its own.
                     *
                     * No admin surface either way: the tablet has one because an
                     * engineer may need diagnostics on a unit nobody can reach,
                     * and a phone's owner can simply reinstall the app.
                     */
                    DriverCockpitScreen(
                        viewModel = cockpit,
                        expanded = expanded,
                        onBack = {
                            showCockpit = false
                            cockpitEntry = null
                        },
                        onOpenSecurity = { showProfile = true },
                        onOpenFuelSlip = { showFuelSlip = true },
                        initialSheet = cockpitEntry,
                    )
                }
            }
        }

        // Back out of the map to the dashboard, not out of the app.
        BackHandler(enabled = showCockpit && !showProfile && !showSecurity) {
            showCockpit = false
            cockpitEntry = null
        }

        BackHandler(enabled = showChecklist && !showProfile && !showSecurity) {
            showChecklist = false
        }

        BackHandler(enabled = showPapers && !showProfile && !showSecurity) { showPapers = false }
        BackHandler(enabled = showTrips && !showProfile && !showSecurity) { showTrips = false }
        BackHandler(enabled = showNotices && !showProfile && !showSecurity) { showNotices = false }
        BackHandler(enabled = showFuelSlip && !showProfile && !showSecurity) {
            showFuelSlip = false
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
