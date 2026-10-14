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
import androidx.compose.runtime.CompositionLocalProvider
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
import com.saarthi.core.domain.AssistantState
import com.saarthi.core.domain.DrivingHours
import com.saarthi.core.domain.TerminalState
import com.saarthi.core.network.SaarthiApi
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
import com.saarthi.driver.ui.shift.assistant.rememberWakeWordMicrophone
import com.saarthi.driver.ui.shift.checklist.ChecklistFlow
import com.saarthi.driver.ui.shift.expense.ExpenseSlipFlow
import com.saarthi.driver.ui.shift.flow.ChromeCover
import com.saarthi.driver.ui.shift.flow.LocalChromeCover
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
import com.saarthi.driver.ui.shift.trips.AddTripFlow
import com.saarthi.driver.ui.shift.trips.HandoverCodeSheet
import com.saarthi.driver.ui.shift.trips.HandoverKind
import com.saarthi.driver.ui.shift.trips.TripsTab
import com.saarthi.driver.ui.shift.vehicle.VehicleSheet
import com.saarthi.driver.ui.start.AddLicenceSheet
import kotlinx.coroutines.delay

/** What can sit over the tabs. One at a time, so no two ever fight for the screen. */
/** The customer's code being asked for: what for, and which of the driver's trips (null: the one holding the vehicle). */
private data class HandoverAsk(val kind: HandoverKind, val tripId: String?)

/** The server refused for the customer's code — missing, wrong, or out of tries. */
private fun Throwable.isHandoverRefusal(): Boolean =
    (this as? SaarthiApi.Failure.Refused)?.code?.startsWith("HANDOVER_CODE") == true

private enum class Overlay { NONE, NOTICES, CHECK, EXPENSE, ADD_TRIP, END_TRIP, REMOVE_TRIP, NEARBY, FULL_MAP, ASSISTANT, VEHICLE, ADAPTER, SOS, PIN, LICENCE, SIGN_OFF, SIGN_OUT }

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
    val wakeWord by preferences.wakeWord.collectAsState()
    val voice = rememberCockpitVoice(cockpit, wakeWord = rememberWakeWordMicrophone(wakeWord))
    val assistant by cockpit.assistant.collectAsState()

    var tab by rememberSaveable { mutableStateOf(ShiftTab.HOME) }
    var overlay by rememberSaveable { mutableStateOf(Overlay.NONE) }
    // Where closing the assistant goes back to: the full map it was woken over, or nothing.
    var afterAssistant by rememberSaveable { mutableStateOf(Overlay.NONE) }
    var nearbyCategory by rememberSaveable { mutableStateOf<String?>(null) }
    var dismissedSos by rememberSaveable { mutableStateOf<String?>(null) }
    var toast by remember { mutableStateOf<String?>(null) }
    // The customer's code being asked for, for which trip, and how the last try went.
    var handover by remember { mutableStateOf<HandoverAsk?>(null) }
    var handoverBusy by remember { mutableStateOf(false) }
    var handoverError by remember { mutableStateOf<String?>(null) }
    // A papers folder opens inside its tab; while one is up the header and tab bar step aside.
    val chromeCover = remember { ChromeCover() }
    // A trip the driver chose to start before the safety check: started once the check is done.
    var startAfterCheck by rememberSaveable { mutableStateOf<String?>(null) }
    var removing by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(toast) {
        if (toast == null) return@LaunchedEffect
        delay(TOAST_MS)
        toast = null
    }
    val say: (Int) -> Unit = { toast = context.getString(it) }
    /*
     * A trip that has just started goes straight onto the map.
     *
     * The same route Home's "Show me the way" draws — the trip now holding the
     * vehicle, previewed for the driver to set off on — so starting a trip no
     * longer means a detour to Home to see where it goes. A route already on
     * the map is left alone, as that button leaves it, and a start with no trip
     * behind it (setting off on the shift itself) has nowhere to route to.
     */
    val showStartedTrip: () -> Unit = {
        if (cockpit.dispatch.value != null && !cockpit.navigation.value.active) {
            cockpit.navigateToDispatch { routed -> if (!routed) say(R.string.toast_route_failed) }
        }
    }
    val askForCode: (HandoverKind, String?) -> Unit = { kind, tripId ->
        handoverError = null
        handover = HandoverAsk(kind, tripId)
    }
    val startChosenTrip: (String) -> Unit = { tripId ->
        cockpit.startTrip(tripId) { result ->
            result
                .onSuccess {
                    tab = ShiftTab.MAP
                    say(R.string.toast_trip_started)
                    showStartedTrip()
                }
                .onFailure {
                    // A booked ride: the passenger's pickup code first.
                    if (it.isHandoverRefusal()) askForCode(HandoverKind.PICKUP, tripId)
                    else toast = it.message ?: context.getString(R.string.trips_problem)
                }
        }
    }
    val plate = state.registration ?: fallbackPlate.orEmpty()

    // "Hey Saarthi" heard with the assistant shut: open it, so the driver can
    // see what was heard and stop it. Not over a sheet or an emergency, which
    // the driver is in the middle of.
    LaunchedEffect(assistant.state) {
        val woken = assistant.state == AssistantState.LISTENING || assistant.state == AssistantState.THINKING
        if (woken && (overlay == Overlay.NONE || overlay == Overlay.FULL_MAP)) {
            afterAssistant = overlay
            overlay = Overlay.ASSISTANT
        }
    }

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
        if (cockpit.dispatch.value?.needsPickupCode == true) {
            askForCode(HandoverKind.PICKUP, null)
        } else {
            cockpit.startTrip { result ->
                result
                    .onSuccess { showStartedTrip() }
                    .onFailure { if (it.isHandoverRefusal()) askForCode(HandoverKind.PICKUP, null) }
            }
            tab = ShiftTab.MAP
            say(R.string.toast_trip_started)
        }
    }
    // Ending a delivery takes the customer's code; anything else ends as it did.
    val endTrip: () -> Unit = {
        if (cockpit.dispatch.value?.needsDeliveryCode == true) {
            askForCode(HandoverKind.DELIVERY, null)
        } else {
            cockpit.completeTrip { result ->
                result
                    .onSuccess { say(R.string.toast_trip_ended) }
                    .onFailure {
                        if (it.isHandoverRefusal()) askForCode(HandoverKind.DELIVERY, null)
                        else toast = it.message ?: context.getString(R.string.trips_problem)
                    }
            }
        }
    }
    val submitCode: (String) -> Unit = { code ->
        val asked = handover
        if (asked != null) {
            handoverBusy = true
            handoverError = null
            val done: (Result<Unit>) -> Unit = { result ->
                handoverBusy = false
                result
                    .onSuccess {
                        handover = null
                        if (asked.kind == HandoverKind.PICKUP) {
                            tab = ShiftTab.MAP
                            say(R.string.toast_trip_started)
                            showStartedTrip()
                        } else {
                            say(R.string.toast_trip_ended)
                        }
                    }
                    .onFailure {
                        // A wrong code stays on the sheet; anything else closes it and says why.
                        if (it.isHandoverRefusal()) {
                            handoverError = it.message
                        } else {
                            handover = null
                            toast = it.message ?: context.getString(R.string.trips_problem)
                        }
                    }
            }
            if (asked.kind == HandoverKind.PICKUP) cockpit.startTrip(asked.tripId, code, done)
            else cockpit.completeTrip(code, done)
        }
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
            CompositionLocalProvider(LocalChromeCover provides chromeCover) {
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
                                openExpense = { overlay = Overlay.EXPENSE },
                                openPapers = { tab = ShiftTab.PAPERS },
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
                                    expenseSlip = { overlay = Overlay.EXPENSE },
                                    fuelNearby = { openNearby(FUEL_CATEGORY) },
                                ),
                                shift = ShiftCardActions(
                                    startTrip = startTrip,
                                    endTrip = endTrip,
                                    signOff = { overlay = Overlay.SIGN_OFF },
                                ),
                            ),
                        )
                        ShiftTab.TRIPS -> TripsTab(
                            cockpit,
                            onAddTrip = { overlay = Overlay.ADD_TRIP },
                            onStart = { tripId ->
                                if (state.state.checklistOutstanding) {
                                    startAfterCheck = tripId
                                    overlay = Overlay.CHECK
                                } else {
                                    startChosenTrip(tripId)
                                }
                            },
                            onStop = { overlay = Overlay.END_TRIP },
                            onRemove = { tripId ->
                                removing = tripId
                                overlay = Overlay.REMOVE_TRIP
                            },
                            onProblem = { toast = it ?: context.getString(R.string.trips_problem) },
                        )
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
            }

            if (tab != ShiftTab.MAP && chromeCover.held == 0) {
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
            if (chromeCover.held == 0) {
                ShiftTabBar(
                    active = tab,
                    dark = Saarthi.colors.dark,
                    onSelect = { tab = it },
                    modifier = Modifier.align(Alignment.BottomCenter),
                )
            }
        }

        ShellToast(toast)
        SosBanner(sosReference?.takeIf { it != dismissedSos }) { dismissedSos = sosReference }

        NoticesPanel(overlay == Overlay.NOTICES, cockpit) { overlay = Overlay.NONE }
        ChecklistFlow(
            visible = overlay == Overlay.CHECK,
            cockpit = cockpit,
            onClose = {
                overlay = Overlay.NONE
                startAfterCheck = null
            },
            onDone = {
                overlay = Overlay.NONE
                val chosen = startAfterCheck
                startAfterCheck = null
                if (chosen != null) startChosenTrip(chosen) else say(R.string.toast_check_done)
            },
        )
        ExpenseSlipFlow(
            visible = overlay == Overlay.EXPENSE,
            cockpit = cockpit,
            onClose = { overlay = Overlay.NONE },
            onSaved = {
                overlay = Overlay.NONE
                say(R.string.toast_expense_saved)
            },
        )
        AddTripFlow(
            visible = overlay == Overlay.ADD_TRIP,
            cockpit = cockpit,
            onClose = { overlay = Overlay.NONE },
            onCreated = { queued ->
                overlay = Overlay.NONE
                say(if (queued) R.string.toast_trip_queued else R.string.toast_trip_added)
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
        AssistantOverlay(overlay == Overlay.ASSISTANT, cockpit, voice) {
            overlay = afterAssistant
            afterAssistant = Overlay.NONE
        }
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
            visible = overlay == Overlay.END_TRIP,
            title = stringResource(R.string.trips_stop_title),
            body = stringResource(R.string.trips_stop_body),
            action = stringResource(R.string.trips_stop_confirm),
            onConfirm = {
                overlay = Overlay.NONE
                endTrip()
            },
            onDismiss = { overlay = Overlay.NONE },
        )
        HandoverCodeSheet(
            kind = handover?.kind,
            busy = handoverBusy,
            error = handoverError,
            onSubmit = submitCode,
            onDismiss = {
                if (!handoverBusy) {
                    handover = null
                    handoverError = null
                }
            },
        )
        ConfirmSheet(
            visible = overlay == Overlay.REMOVE_TRIP,
            title = stringResource(R.string.trips_remove_title),
            body = stringResource(R.string.trips_remove_body),
            action = stringResource(R.string.trips_remove_confirm),
            onConfirm = {
                overlay = Overlay.NONE
                removing?.let { tripId ->
                    cockpit.tripQueue.remove(tripId) { result ->
                        result
                            .onSuccess { say(R.string.toast_trip_removed) }
                            .onFailure { toast = it.message ?: context.getString(R.string.trips_problem) }
                    }
                }
                removing = null
            },
            onDismiss = {
                overlay = Overlay.NONE
                removing = null
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
