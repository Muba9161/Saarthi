package com.saarthi.driver.ui.shift

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.core.domain.DrivingHours
import com.saarthi.core.domain.TerminalState
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.core.ui.rememberCockpitVoice
import com.saarthi.driver.R
import com.saarthi.driver.SaarthiDriverApp
import com.saarthi.driver.data.DriverPreferences
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.design.AppName
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.MapInk
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.profile.PinSetupOverlay
import com.saarthi.driver.ui.profile.ProfileActions
import com.saarthi.driver.ui.profile.ProfileContent
import com.saarthi.driver.ui.profile.ShiftDetails
import com.saarthi.driver.ui.profile.TOAST_MS
import com.saarthi.driver.ui.shift.adapter.AdapterSheet
import com.saarthi.driver.ui.shift.assistant.AssistantOverlay
import com.saarthi.driver.ui.shift.checklist.ChecklistFlow
import com.saarthi.driver.ui.shift.fuel.FuelSlipFlow
import com.saarthi.driver.ui.shift.home.HomeActions
import com.saarthi.driver.ui.shift.home.HomeTab
import com.saarthi.driver.ui.shift.map.ControlActions
import com.saarthi.driver.ui.shift.map.FullMapScreen
import com.saarthi.driver.ui.shift.map.MapActions
import com.saarthi.driver.ui.shift.map.MapTab
import com.saarthi.driver.ui.shift.map.ShiftCardActions
import com.saarthi.driver.ui.shift.nearby.NearbySheet
import com.saarthi.driver.ui.shift.notices.NoticesPanel
import com.saarthi.driver.ui.shift.papers.PapersTab
import com.saarthi.driver.ui.shift.trips.TripsTab
import com.saarthi.driver.ui.shift.vehicle.VehicleSheet
import com.saarthi.driver.ui.start.AddLicenceSheet
import kotlinx.coroutines.delay

/** What can sit over the tabs. One at a time, so no two ever fight for the screen. */
private enum class Overlay { NONE, NOTICES, CHECK, FUEL, NEARBY, FULL_MAP, ASSISTANT, VEHICLE, ADAPTER, SOS, PIN, LICENCE, SIGN_OFF, SIGN_OUT }

/**
 * The shift: five tabs under a floating header and tab bar, and every sheet and
 * flow a driver opens from them.
 *
 * The voice (spoken turns, the wake word) is created here, once, so guidance
 * keeps talking whichever tab is on screen.
 */
@Composable
fun ShiftShell(
    driver: DriverViewModel,
    cockpit: TerminalViewModel,
    preferences: DriverPreferences,
    fallbackPlate: String?,
) {
    val context = LocalContext.current
    val app = context.applicationContext as SaarthiDriverApp
    val state by cockpit.uiState.collectAsState()
    val hours by cockpit.hours.collectAsState()
    val notifications by cockpit.notifications.collectAsState()
    val sosReference by cockpit.sosReference.collectAsState()
    val instruments by preferences.instruments.collectAsState()
    val account by driver.account.collectAsState()
    val fleet by driver.fleet.collectAsState()
    val voice = rememberCockpitVoice(cockpit)

    var tab by rememberSaveable { mutableStateOf(ShiftTab.HOME) }
    var overlay by rememberSaveable { mutableStateOf(Overlay.NONE) }
    var nearbyCategory by rememberSaveable { mutableStateOf<String?>(null) }
    var dismissedSos by rememberSaveable { mutableStateOf<String?>(null) }
    var toast by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(toast) {
        if (toast == null) return@LaunchedEffect
        delay(TOAST_MS)
        toast = null
    }
    val say: (Int) -> Unit = { toast = context.getString(it) }
    val plate = state.registration ?: fallbackPlate.orEmpty()

    LeaveWhenSessionEnds(state, driver)
    FollowSharedDestinations(app, cockpit, onRouting = {
        overlay = Overlay.NONE
        tab = ShiftTab.MAP
    }, onFailed = { say(R.string.toast_route_failed) })

    val sos = rememberSosController(cockpit, onSent = { overlay = Overlay.NONE })
    val openSos = {
        sos.arm()
        overlay = Overlay.SOS
    }
    val openNearby: (String?) -> Unit = { category ->
        nearbyCategory = category
        overlay = Overlay.NEARBY
    }
    val startTrip = {
        cockpit.startTrip()
        tab = ShiftTab.MAP
        say(R.string.toast_trip_started)
    }

    BackHandler(enabled = overlay == Overlay.NONE && tab != ShiftTab.HOME) { tab = ShiftTab.HOME }
    // Sheets without a back handler of their own close on Back too. Composed
    // before them, so the ones that do handle Back themselves come first.
    BackHandler(enabled = overlay != Overlay.NONE) { overlay = Overlay.NONE }

    Box(
        Modifier
            .fillMaxSize()
            .background(if (tab == ShiftTab.MAP) MapInk.canvas else Saarthi.colors.canvas),
    ) {
        if (overlay == Overlay.FULL_MAP) {
            // One map at a time: the tab's map is let go while this one is up.
            FullMapScreen(cockpit, fallbackPlate, onClose = { overlay = Overlay.NONE }, onSos = openSos)
        } else {
            TabPanes(tab) { shown ->
                when (shown) {
                    ShiftTab.HOME -> HomeTab(
                        cockpit,
                        fallbackPlate,
                        HomeActions(
                            openMap = { tab = ShiftTab.MAP },
                            openCheck = { overlay = Overlay.CHECK },
                            startTrip = startTrip,
                            openNearby = { openNearby(null) },
                            openFuel = { overlay = Overlay.FUEL },
                            openNotices = { overlay = Overlay.NOTICES },
                            checkNotNeeded = { say(R.string.check_not_needed) },
                        ),
                    )
                    ShiftTab.MAP -> MapTab(
                        cockpit = cockpit,
                        offline = app.offlineMaps,
                        showInstruments = instruments,
                        fallbackPlate = fallbackPlate,
                        actions = MapActions(
                            back = { tab = ShiftTab.HOME },
                            sos = openSos,
                            fullScreen = { overlay = Overlay.FULL_MAP },
                            controls = ControlActions(
                                services = { openNearby(null) },
                                assistant = { overlay = Overlay.ASSISTANT },
                                vehicle = { overlay = Overlay.VEHICLE },
                                adapter = { overlay = Overlay.ADAPTER },
                                fuelSlip = { overlay = Overlay.FUEL },
                                fuelNearby = { openNearby(FUEL_CATEGORY) },
                            ),
                            shift = ShiftCardActions(
                                startTrip = startTrip,
                                endTrip = {
                                    cockpit.completeTrip()
                                    say(R.string.toast_trip_ended)
                                },
                                signOff = { overlay = Overlay.SIGN_OFF },
                            ),
                        ),
                    )
                    ShiftTab.TRIPS -> TripsTab(cockpit)
                    ShiftTab.PAPERS -> PapersTab(cockpit)
                    ShiftTab.PROFILE -> ProfileContent(
                        driver = driver,
                        preferences = preferences,
                        shift = ShiftDetails(plate, state.state.driverWord(), DrivingHours.format(hours.todayMs)),
                        actions = ProfileActions(
                            setPin = { overlay = Overlay.PIN },
                            addLicence = { overlay = Overlay.LICENCE },
                            joinFleet = {},
                            fullMap = { overlay = Overlay.FULL_MAP },
                            signOut = { overlay = Overlay.SIGN_OUT },
                            toast = { toast = it },
                        ),
                        modifier = Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                            .padding(start = 20.dp, end = 20.dp, top = headerClearance(), bottom = tabBarClearance()),
                    )
                }
            }

            if (tab != ShiftTab.MAP) {
                val firstName = account?.name?.substringBefore(' ').orEmpty()
                val fleetName = fleet?.name?.takeIf { fleet?.joined == true } ?: AppName.APP
                val (eyebrow, title) = when (tab) {
                    ShiftTab.TRIPS -> fleetName to stringResource(R.string.header_trips)
                    ShiftTab.PAPERS -> stringResource(R.string.header_papers_eyebrow) to stringResource(R.string.header_papers)
                    ShiftTab.PROFILE -> stringResource(R.string.header_profile_eyebrow) to stringResource(R.string.header_profile)
                    else -> fleetName to stringResource(R.string.home_greeting, firstName)
                }
                ShiftHeader(
                    eyebrow = eyebrow,
                    title = title,
                    unread = notifications.unread,
                    onBell = { overlay = Overlay.NOTICES },
                    onSos = openSos,
                    modifier = Modifier.align(Alignment.TopCenter),
                )
            }
            ShiftTabBar(
                active = tab,
                dark = tab == ShiftTab.MAP || Saarthi.colors.dark,
                onSelect = { tab = it },
                modifier = Modifier.align(Alignment.BottomCenter),
            )
        }

        ShellToast(toast)
        SosBanner(sosReference?.takeIf { it != dismissedSos }) { dismissedSos = sosReference }

        NoticesPanel(overlay == Overlay.NOTICES, cockpit) { overlay = Overlay.NONE }
        ChecklistFlow(
            visible = overlay == Overlay.CHECK,
            cockpit = cockpit,
            onClose = { overlay = Overlay.NONE },
            onDone = {
                overlay = Overlay.NONE
                say(R.string.toast_check_done)
            },
        )
        FuelSlipFlow(
            visible = overlay == Overlay.FUEL,
            cockpit = cockpit,
            onClose = { overlay = Overlay.NONE },
            onSaved = {
                overlay = Overlay.NONE
                say(R.string.toast_fuel_saved)
            },
        )
        NearbySheet(
            visible = overlay == Overlay.NEARBY,
            cockpit = cockpit,
            initialCategory = nearbyCategory,
            onClose = { overlay = Overlay.NONE },
            onRouted = { name ->
                overlay = Overlay.NONE
                tab = ShiftTab.MAP
                toast = context.getString(R.string.toast_route_drawn, name)
            },
        )
        AssistantOverlay(overlay == Overlay.ASSISTANT, cockpit, voice) { overlay = Overlay.NONE }
        VehicleSheet(overlay == Overlay.VEHICLE, cockpit) { overlay = Overlay.NONE }
        AdapterSheet(overlay == Overlay.ADAPTER, cockpit) { overlay = Overlay.NONE }
        AddLicenceSheet(overlay == Overlay.LICENCE, driver) {
            overlay = Overlay.NONE
            driver.clearError()
        }
        PinSetupOverlay(
            visible = overlay == Overlay.PIN,
            driver = driver,
            onClose = { overlay = Overlay.NONE },
            onSaved = {
                overlay = Overlay.NONE
                say(R.string.toast_pin_on)
            },
        )
        ConfirmSheet(
            visible = overlay == Overlay.SIGN_OFF,
            title = stringResource(R.string.sign_off_title),
            body = stringResource(R.string.sign_off_body, plate),
            action = stringResource(R.string.shift_sign_off),
            onConfirm = {
                overlay = Overlay.NONE
                cockpit.endSession()
            },
            onDismiss = { overlay = Overlay.NONE },
        )
        ConfirmSheet(
            visible = overlay == Overlay.SIGN_OUT,
            title = stringResource(R.string.sign_out_title),
            body = stringResource(R.string.sign_out_body),
            action = stringResource(R.string.profile_sign_out),
            onConfirm = {
                overlay = Overlay.NONE
                driver.signOut()
            },
            onDismiss = { overlay = Overlay.NONE },
        )
        SosOverlay(
            visible = overlay == Overlay.SOS,
            sending = sos.sending,
            failed = sos.failed,
            position = state.telemetry.position,
            onSend = sos::send,
            onCancel = {
                if (!sos.sending) {
                    sos.cancel()
                    overlay = Overlay.NONE
                }
            },
        )
    }
}

/** The tabs, sliding the way the tab bar moved. */
@Composable
private fun TabPanes(tab: ShiftTab, content: @Composable (ShiftTab) -> Unit) {
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
        label = "shift-tabs",
    ) { shown -> content(shown) }
}

/**
 * Back to "Choose your vehicle" once the vehicle session is over — signed off
 * here, ended by the fleet, or revoked — by asking the server where the driver
 * now stands rather than guessing from the cockpit state.
 */
@Composable
private fun LeaveWhenSessionEnds(state: TerminalViewModel.UiState, driver: DriverViewModel) {
    var wasSignedOn by remember { mutableStateOf(false) }
    LaunchedEffect(state.server != null, state.state) {
        if (state.server == null) return@LaunchedEffect
        val current = state.state
        when {
            current == TerminalState.REVOKED -> driver.refreshAssignment()
            current.signedOnToVehicle -> wasSignedOn = true
            wasSignedOn -> driver.refreshAssignment()
        }
    }
}

/** A place shared into the app from another one becomes a route on the map. */
@Composable
private fun FollowSharedDestinations(
    app: SaarthiDriverApp,
    cockpit: TerminalViewModel,
    onRouting: () -> Unit,
    onFailed: () -> Unit,
) {
    val pending by app.sharedDestinations.pending.collectAsState()
    LaunchedEffect(pending) {
        val destination = app.sharedDestinations.take() ?: return@LaunchedEffect
        onRouting()
        cockpit.navigateToPoint(destination.latitude, destination.longitude, destination.label) { routed ->
            if (!routed) onFailed()
        }
    }
}

/** The category the "Fuel nearby" control opens the services sheet on. */
private const val FUEL_CATEGORY = "FUEL"
