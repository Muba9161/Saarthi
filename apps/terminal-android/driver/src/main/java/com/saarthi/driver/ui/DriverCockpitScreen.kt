package com.saarthi.driver.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.DirectionsCar
import androidx.compose.material.icons.rounded.LocalGasStation
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.ReceiptLong
import androidx.compose.material.icons.rounded.Sensors
import androidx.compose.material.icons.rounded.Storefront
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.saarthi.core.domain.AssistantState
import com.saarthi.core.domain.TerminalState
import com.saarthi.core.telemetry.Metric
import com.saarthi.core.ui.AiBlob
import com.saarthi.core.ui.TerminalMap
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.core.ui.rememberCockpitVoice
import com.saarthi.core.ui.screens.AdapterSheet
import com.saarthi.core.ui.screens.AssistantSheet
import com.saarthi.core.ui.screens.CockpitSheet
import com.saarthi.core.ui.screens.NavigationBanner
import com.saarthi.core.ui.screens.ServicesSheet
import com.saarthi.core.ui.screens.VehicleSheet
import com.saarthi.driver.ui.design.AlertRed
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.CautionAmber
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.CircleAction
import com.saarthi.driver.ui.design.FleetCard
import com.saarthi.driver.ui.design.FleetEnter
import com.saarthi.driver.ui.design.FleetMetric
import com.saarthi.driver.ui.design.FleetNotice
import com.saarthi.driver.ui.design.FleetOutlineButton
import com.saarthi.driver.ui.design.FleetRadius
import com.saarthi.driver.ui.design.FleetReadout
import com.saarthi.driver.ui.design.FleetScreen
import com.saarthi.driver.ui.design.FleetSlideAction
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.FleetSpeedBadge
import com.saarthi.driver.ui.design.FleetTile
import com.saarthi.driver.ui.design.FleetTouchTarget
import com.saarthi.driver.ui.design.LiveGreen
import com.saarthi.driver.ui.design.Obsidian
import com.saarthi.driver.ui.design.SectionHeader
import com.saarthi.driver.ui.design.Slate
import com.saarthi.driver.ui.design.StatusPill
import com.saarthi.driver.ui.design.TileRow
import com.saarthi.driver.ui.design.TrackingCode
import com.saarthi.driver.ui.design.pressable

/**
 * The live view, in the driver app's own language.
 *
 * The fitted terminal's cockpit is a landscape instrument panel: a full-bleed
 * map with glass cards floating on it, four round dials, and a control drawer
 * pulled up from the bottom. It is the right shape for a tablet bolted to a
 * dashboard and the wrong one for a phone — held in one hand, in portrait, at
 * arm's length, usually in a cradle off to the driver's left. Cards floating on
 * a moving map are hard to hit and harder to read; dials shrink into decoration;
 * a drawer hides the two controls that matter behind a gesture.
 *
 * So this is the same machinery in a different arrangement: one scrolling
 * column of the same cards the rest of the driver app is built from, with the
 * map as the first of them rather than as the ground everything else sits on.
 * Nothing the old cockpit could do is missing — the map, navigation and its
 * spoken guidance, the four readings, the odometer, nearby services, the
 * vehicle sheet, Saarthi, the OBD adapter, security, SOS, and starting and
 * ending the trip are all here.
 *
 * Two things changed on purpose rather than by translation:
 *
 *  * **Ending a trip is a slide, not a tap.** It was a plain button in a drawer.
 *    Ending a trip closes a record a fleet pays against, and a phone in a cradle
 *    collects accidental taps all day. It matches the slide that starts one.
 *  * **The controls are on the page, not under a drawer.** There are six of
 *    them; a phone has room. A gesture that hides them buys nothing here.
 *
 * The voice engine — wake phrase, spoken turns, the stuck-indicator backstop —
 * is [rememberCockpitVoice], shared with `:core` rather than reimplemented, so
 * the two cockpits cannot drift on the parts that involve a live microphone.
 */
@Composable
fun DriverCockpitScreen(
    viewModel: TerminalViewModel,
    expanded: Boolean,
    onBack: () -> Unit,
    onOpenSecurity: () -> Unit,
    onOpenFuelSlip: () -> Unit,
    initialSheet: CockpitSheet? = null,
) {
    val state by viewModel.uiState.collectAsState()
    val assistant by viewModel.assistant.collectAsState()
    val navigation by viewModel.navigation.collectAsState()
    val sosArmed by viewModel.sosArmed.collectAsState()
    val sosReference by viewModel.sosReference.collectAsState()
    val dispatch by viewModel.dispatch.collectAsState()

    val telemetry = state.telemetry
    val moving = state.moving

    val voice = rememberCockpitVoice(viewModel)

    var sheet by remember(initialSheet) { mutableStateOf(initialSheet) }

    /*
     * Following the vehicle, and giving it back.
     *
     * A driver who drags the map is looking at something, so tracking stops —
     * but only for as long as they are looking. Without the timer a single
     * accidental knock left the vehicle sliding off the screen for the rest of
     * the shift, which is the complaint this fixes.
     */
    var followVehicle by remember { mutableStateOf(true) }
    var panEpoch by remember { mutableIntStateOf(0) }
    LaunchedEffect(followVehicle, panEpoch) {
        if (followVehicle) return@LaunchedEffect
        kotlinx.coroutines.delay(RESUME_FOLLOW_MS)
        followVehicle = true
    }

    // Frame a newly-arrived route once, so the driver sees where it goes.
    var frameRouteRequest by remember { mutableIntStateOf(0) }
    LaunchedEffect(navigation.route) {
        if (navigation.route != null) {
            followVehicle = true
            frameRouteRequest += 1
        }
    }

    LaunchedEffect(Unit) { viewModel.loadDispatch() }

    val openAssistant: () -> Unit = {
        // Voice where the microphone is available, the typed sheet where it is
        // not. A phone with the permission refused must still be able to ask.
        if (!voice.listenNow()) sheet = CockpitSheet.ASSISTANT
        else viewModel.setAssistantState(AssistantState.LISTENING)
    }

    val signOff: () -> Unit = {
        if (state.state == TerminalState.TRIP_ACTIVE) viewModel.completeTrip()
        else viewModel.endSession()
        Unit
    }

    /*
     * Back closes what is on top, one layer at a time.
     *
     * These sheets are drawn inline rather than as dialogs, so they intercept
     * nothing themselves — without this, a single press fell through to the
     * root's handler and shut the whole cockpit, taking the open sheet with it
     * and dropping the driver on the dashboard. Nested `BackHandler`s run
     * innermost-first, so declaring them here puts them ahead of the root's.
     */
    BackHandler(enabled = sheet != null) { sheet = null }
    BackHandler(enabled = sheet == null && assistant.state != AssistantState.IDLE) {
        viewModel.dismissAssistant()
    }
    BackHandler(enabled = sheet == null && sosArmed) { viewModel.cancelSos() }

    Box(Modifier.fillMaxSize()) {
        FleetScreen {
            Spacer(Modifier.height(FleetSpace.snug))

            // --- Which vehicle, and is the fleet hearing it ------------------
            FleetEnter(index = 0) {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(FleetSpace.snug),
                ) {
                    CircleAction(
                        icon = Icons.AutoMirrored.Rounded.ArrowBack,
                        contentDescription = "Back to your dashboard",
                        onClick = onBack,
                    )
                    Column(Modifier.weight(1f)) {
                        TrackingCode(state.registration ?: "SAARTHI", size = 22.dp.value.sp())
                        Text(
                            when {
                                state.live -> "Live to your fleet"
                                state.offline -> "Saved on this phone"
                                else -> "Reaching your fleet…"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = Ash,
                            maxLines = 1,
                        )
                    }
                    // Same rule as the dashboard: only a connection that has
                    // actually succeeded may read as live.
                    StatusPill(
                        label = when {
                            state.live -> "Live"
                            state.offline -> "Offline"
                            else -> "Connecting…"
                        },
                        tint = when {
                            state.live -> LiveGreen
                            state.offline -> CautionAmber
                            else -> Slate
                        },
                        live = state.live,
                    )
                }
            }

            Spacer(Modifier.height(FleetSpace.base))

            // --- The road ----------------------------------------------------
            FleetEnter(index = 1) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(if (expanded) 420.dp else 320.dp)
                        .clip(RoundedCornerShape(FleetRadius.card)),
                ) {
                    TerminalMap(
                        position = telemetry.position,
                        headingDegrees = telemetry.value(Metric.HEADING),
                        driving = moving,
                        // Remembered against the route so the map is not handed a
                        // freshly-allocated list of several thousand pairs on
                        // every recomposition.
                        routeGeometry = remember(navigation.route) {
                            navigation.route?.geometry?.map { it.latitude to it.longitude }
                                ?: emptyList()
                        },
                        destination = navigation.route?.destination?.let {
                            it.latitude to it.longitude
                        },
                        followVehicle = followVehicle,
                        onUserPannedMap = {
                            followVehicle = false
                            panEpoch += 1
                        },
                        navigating = navigation.guiding,
                        previewingRoute = navigation.previewing,
                        frameRouteRequest = frameRouteRequest,
                        vehicleType = state.server?.vehicle?.vehicleType,
                        modifier = Modifier.fillMaxSize(),
                    )

                    // Turn instructions, over the top of the road they describe.
                    navigation.route?.let { route ->
                        NavigationBanner(
                            route = route,
                            navigation = navigation,
                            guidanceMuted = voice.guidanceMuted,
                            onToggleGuidance = {
                                viewModel.setVoiceGuidance(voice.guidanceMuted)
                            },
                            onCancel = { viewModel.clearRoute() },
                            modifier = Modifier
                                .align(Alignment.TopCenter)
                                .padding(FleetSpace.snug),
                        )
                    }

                    // Speed, where the driver is already looking.
                    MapSpeedOverlay(
                        visible = moving,
                        speedKph = state.speedKph,
                        simulated = telemetry.isSimulated(Metric.SPEED),
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .padding(FleetSpace.snug),
                    )

                    MapRecentreButton(
                        visible = !followVehicle,
                        onClick = { followVehicle = true },
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(FleetSpace.snug),
                    )
                }
            }

            // --- What the fleet is not hearing -------------------------------
            AnimatedVisibility(visible = state.offline || state.pendingUploads > 0) {
                Column {
                    Spacer(Modifier.height(FleetSpace.snug))
                    FleetNotice(
                        message = if (state.offline) {
                            "No signal. Saarthi is saving " +
                                "${state.pendingUploads} reading(s) to send when it returns."
                        } else {
                            "Sending ${state.pendingUploads} saved reading(s)…"
                        },
                        tint = if (state.offline) CautionAmber else LiveGreen,
                    )
                }
            }

            // --- The job the fleet gave this vehicle --------------------------
            //
            // Directly under the map, because the two answer one question
            // between them: where am I taking this, and which way. Below the
            // readings it would be a job a driver had to scroll to find.
            AnimatedVisibility(visible = dispatch != null) {
                Column {
                    Spacer(Modifier.height(FleetSpace.section))
                    FleetEnter(index = 2) {
                        DispatchCard(cockpit = viewModel)
                    }
                }
            }

            Spacer(Modifier.height(FleetSpace.section))

            // --- The readings -------------------------------------------------
            FleetEnter(index = 2) {
                Column(Modifier.fillMaxWidth()) {
                    SectionHeader("Instruments")
                    Spacer(Modifier.height(FleetSpace.snug))

                    val speed = telemetry.value(Metric.SPEED)
                    val rpm = telemetry.value(Metric.RPM)
                    val fuel = telemetry.value(Metric.FUEL_LEVEL)
                    val coolant = telemetry.value(Metric.COOLANT_TEMPERATURE)

                    TileRow {
                        FleetMetric(
                            label = "Speed",
                            value = speed?.let { "%.0f".format(it) },
                            unit = "km/h",
                            tint = if ((speed ?: 0.0) >= 90) CautionAmber else Chalk,
                            fraction = speed?.let { (it / 140.0).toFloat() },
                            simulated = telemetry.isSimulated(Metric.SPEED),
                            modifier = Modifier.weight(1f),
                        )
                        FleetMetric(
                            label = "Engine",
                            value = rpm?.let { "%.0f".format(it) },
                            unit = "rpm",
                            // The redline, in the one place a driver would look.
                            tint = if ((rpm ?: 0.0) >= 3_500) AlertRed else Chalk,
                            fraction = rpm?.let { (it / 5_000.0).toFloat() },
                            simulated = telemetry.isSimulated(Metric.RPM),
                            modifier = Modifier.weight(1f),
                        )
                    }

                    Spacer(Modifier.height(FleetSpace.snug))

                    TileRow {
                        FleetMetric(
                            label = "Fuel",
                            value = fuel?.let { "%.0f".format(it) },
                            unit = "%",
                            tint = when {
                                fuel == null -> Chalk
                                fuel <= 8 -> AlertRed
                                fuel <= 20 -> CautionAmber
                                else -> LiveGreen
                            },
                            fraction = fuel?.let { (it / 100.0).toFloat() },
                            simulated = telemetry.isSimulated(Metric.FUEL_LEVEL),
                            modifier = Modifier.weight(1f),
                        )
                        FleetMetric(
                            label = "Coolant",
                            value = coolant?.let { "%.0f".format(it) },
                            unit = "°C",
                            // Past 100 is hot; past 108 is a stop-the-vehicle
                            // problem.
                            tint = when {
                                coolant == null -> Chalk
                                coolant >= 108 -> AlertRed
                                coolant >= 100 -> CautionAmber
                                else -> Chalk
                            },
                            fraction = coolant?.let { (it / 130.0).toFloat() },
                            simulated = telemetry.isSimulated(Metric.COOLANT_TEMPERATURE),
                            modifier = Modifier.weight(1f),
                        )
                    }

                    Spacer(Modifier.height(FleetSpace.snug))

                    TileRow {
                        FleetReadout(
                            label = "Odometer",
                            value = telemetry.value(Metric.ODOMETER)?.let { "%,.0f".format(it) },
                            unit = "km",
                            simulated = telemetry.isSimulated(Metric.ODOMETER),
                            modifier = Modifier.weight(1f),
                        )
                        FleetReadout(
                            label = "Mileage",
                            // Only while actually burning fuel and actually
                            // moving; anything else is a division by noise.
                            value = run {
                                val rate = telemetry.value(Metric.FUEL_RATE)
                                val kph = telemetry.value(Metric.SPEED)
                                if (rate != null && rate > 0.1 && kph != null && kph > 5.0) {
                                    "%.1f".format(kph / rate)
                                } else {
                                    null
                                }
                            },
                            unit = "km/L",
                            simulated = telemetry.isSimulated(Metric.FUEL_RATE),
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }

            Spacer(Modifier.height(FleetSpace.section))

            // --- What a driver does from here ---------------------------------
            FleetEnter(index = 3) {
                Column(Modifier.fillMaxWidth()) {
                    SectionHeader("Controls")
                    Spacer(Modifier.height(FleetSpace.snug))

                    TileRow {
                        if (moving) {
                            /*
                             * Moving: one destination, and it is fuel.
                             *
                             * A driver at speed asking for anything else should
                             * be asking out loud.
                             */
                            FleetTile(
                                icon = Icons.Rounded.LocalGasStation,
                                title = "Fuel nearby",
                                subtitle = "Stations on your way",
                                onClick = {
                                    viewModel.findServices("FUEL")
                                    sheet = CockpitSheet.SERVICES
                                },
                                accent = true,
                                modifier = Modifier.weight(1f),
                            )
                        } else {
                            FleetTile(
                                icon = Icons.Rounded.Storefront,
                                title = "Services",
                                subtitle = "Fuel, food, repairs",
                                onClick = { sheet = CockpitSheet.SERVICES },
                                modifier = Modifier.weight(1f),
                            )
                        }
                        FleetTile(
                            icon = Icons.Rounded.AutoAwesome,
                            title = "Saarthi",
                            subtitle = if (voice.canListen) "Speak or type" else "Type a question",
                            onClick = openAssistant,
                            modifier = Modifier.weight(1f),
                        )
                    }

                    if (!moving) {
                        Spacer(Modifier.height(FleetSpace.snug))
                        TileRow {
                            FleetTile(
                                icon = Icons.Rounded.DirectionsCar,
                                title = "Vehicle",
                                subtitle = "Details and issues",
                                onClick = { sheet = CockpitSheet.VEHICLE },
                                modifier = Modifier.weight(1f),
                            )
                            FleetTile(
                                icon = Icons.Rounded.Sensors,
                                // Short enough not to ellipsise in a
                                // half-width tile beside a 44dp icon chip.
                                title = "Adapter",
                                subtitle = if (telemetry.isReadingFromObd) {
                                    "Reading the engine"
                                } else {
                                    "Pair over Bluetooth"
                                },
                                accent = telemetry.isReadingFromObd,
                                // Connected is a one-way door. The adapter is the
                                // only source of real engine data, and a driver
                                // who could switch it off mid-shift would leave
                                // the fleet with a journey that silently stopped
                                // reporting anything the GPS cannot see.
                                enabled = !telemetry.isReadingFromObd,
                                onClick = { sheet = CockpitSheet.ADAPTER },
                                modifier = Modifier.weight(1f),
                            )
                        }

                        Spacer(Modifier.height(FleetSpace.snug))
                        FleetTile(
                            icon = Icons.Rounded.Lock,
                            title = "Sign-in and security",
                            subtitle = "PIN and fingerprint",
                            onClick = onOpenSecurity,
                            modifier = Modifier.fillMaxWidth(),
                        )

                        Spacer(Modifier.height(FleetSpace.snug))
                        FleetTile(
                            icon = Icons.Rounded.ReceiptLong,
                            title = "Fuel slip",
                            subtitle = "Photograph it, keep no paper",
                            onClick = onOpenFuelSlip,
                            modifier = Modifier.fillMaxWidth(),
                        )

                        Spacer(Modifier.height(FleetSpace.snug))
                        /*
                         * Offered where the map is, not in a settings screen.
                         *
                         * The moment a driver wants this is the moment they are
                         * looking at the map and about to enter a stretch they
                         * know has no bars.
                         */
                        OfflineMapCard(cockpit = viewModel)
                    }
                }
            }

            Spacer(Modifier.height(FleetSpace.section))

            // --- Starting and ending the shift ---------------------------------
            FleetEnter(index = 4) {
                /*
                 * Stops short of the emergency button.
                 *
                 * The SOS floats over this column at the bottom right, and a
                 * full-width slider ran underneath it — so the last inch of
                 * "slide to end the trip", exactly where a thumb finishes the
                 * gesture, was actually the emergency control. Reserving its
                 * width is the fix; moving the SOS into the page is not, because
                 * an SOS a driver has to scroll to is not an SOS.
                 */
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(end = FleetTouchTarget),
                ) {
                    when (state.state) {
                        TerminalState.READY -> {
                            SectionHeader("Ready to go")
                            Spacer(Modifier.height(FleetSpace.snug))
                            FleetSlideAction(
                                label = "Slide to start your trip",
                                onConfirm = { viewModel.startTrip() },
                            )
                        }

                        TerminalState.TRIP_ACTIVE -> {
                            SectionHeader("Trip under way")
                            Spacer(Modifier.height(FleetSpace.tight))
                            Text(
                                "Ending the trip closes this journey for your fleet.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = Ash,
                            )
                            Spacer(Modifier.height(FleetSpace.snug))
                            FleetSlideAction(
                                label = "Slide to end the trip",
                                onConfirm = signOff,
                            )
                        }

                        else -> {
                            FleetOutlineButton(label = "Sign off", onClick = signOff)
                        }
                    }
                }
            }

            Spacer(Modifier.height(FleetSpace.wide))
            // Room for the SOS button, which floats over this column.
            Spacer(Modifier.height(FleetTouchTarget))
        }

        // --- The emergency, always reachable ----------------------------------
        //
        // Floated over the scrolling column rather than placed in it: an SOS a
        // driver has to scroll to is not an SOS.
        Box(
            Modifier
                .align(Alignment.BottomEnd)
                .padding(FleetSpace.base),
        ) {
            SosControl(
                armed = sosArmed,
                onArm = { viewModel.armSos() },
                onConfirm = { viewModel.triggerSos() },
                onCancel = { viewModel.cancelSos() },
            )
        }

        sosReference?.let { reference ->
            FleetNotice(
                message = "Emergency raised. Your fleet has it as $reference.",
                tint = AlertRed,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(FleetSpace.base),
            )
        }

        // --- Saarthi, when Saarthi is actually doing something -----------------
        AnimatedVisibility(
            visible = assistant.state != AssistantState.IDLE,
            enter = fadeIn(tween(160)) + scaleIn(initialScale = 0.8f, animationSpec = tween(200)),
            exit = fadeOut(tween(140)) + scaleOut(targetScale = 0.8f, animationSpec = tween(160)),
            modifier = Modifier.align(Alignment.Center),
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                AiBlob(
                    state = assistant.state,
                    size = 108.dp,
                    amplitude = voice.amplitude,
                    // A driver who set it off by accident — and the wake phrase
                    // does fire on road noise — needs one obvious way to stop it.
                    onClick = { viewModel.dismissAssistant() },
                )
                assistant.transcript?.takeIf { it.isNotBlank() }?.let { heard ->
                    Spacer(Modifier.height(FleetSpace.snug))
                    FleetCard(padding = FleetSpace.snug) {
                        Text(
                            "“$heard”",
                            style = MaterialTheme.typography.bodyLarge,
                            color = Chalk,
                            maxLines = 2,
                        )
                    }
                }
            }
        }

        // --- Sheets -------------------------------------------------------------
        when (sheet) {
            CockpitSheet.SERVICES -> ServicesSheet(viewModel, expanded) { sheet = null }
            CockpitSheet.VEHICLE -> VehicleSheet(viewModel) { sheet = null }
            CockpitSheet.ASSISTANT -> AssistantSheet(viewModel) { sheet = null }
            CockpitSheet.ADAPTER -> AdapterSheet(viewModel) { sheet = null }
            null -> Unit
        }
    }
}

/**
 * Speed over the map, fading in when the vehicle starts moving.
 *
 * A composable of its own rather than an inline `AnimatedVisibility`: inside the
 * map's `Box` the enclosing `FleetScreen` column is still an implicit receiver,
 * so the call resolved to `ColumnScope.AnimatedVisibility` and did not compile.
 * Here there is no column in scope and the plain overload applies.
 */
@Composable
private fun MapSpeedOverlay(
    visible: Boolean,
    speedKph: Double?,
    simulated: Boolean,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(tween(200)),
        exit = fadeOut(tween(160)),
        modifier = modifier,
    ) {
        FleetSpeedBadge(speedKph = speedKph, simulated = simulated)
    }
}

/** Hand the camera back to the vehicle after the driver has panned away. */
@Composable
private fun MapRecentreButton(
    visible: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(tween(160)) + scaleIn(initialScale = 0.85f),
        exit = fadeOut(tween(140)) + scaleOut(targetScale = 0.85f),
        modifier = modifier,
    ) {
        Box(
            Modifier
                .clip(RoundedCornerShape(FleetRadius.pill))
                .background(Obsidian.copy(alpha = 0.82f)),
        ) {
            CircleAction(
                icon = Icons.Rounded.MyLocation,
                contentDescription = "Follow the vehicle again",
                onClick = onClick,
            )
        }
    }
}

/**
 * The emergency control.
 *
 * Two presses, never one. The first arms it and the second sends it, because a
 * single-tap SOS on a phone wedged in a cradle would be raised by a pothole —
 * and a fleet that learns to ignore Saarthi's emergencies has no emergencies.
 */
@Composable
private fun SosControl(
    armed: Boolean,
    onArm: () -> Unit,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    if (!armed) {
        Box(
            Modifier
                .size(FleetTouchTarget)
                .clip(RoundedCornerShape(FleetRadius.pill))
                .background(AlertRed)
                .pressable(scaleTo = 0.92f, onClick = onArm),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "SOS",
                style = MaterialTheme.typography.labelLarge,
                color = Color.White,
            )
        }
    } else {
        FleetCard(padding = FleetSpace.base) {
            Text(
                "Raise an emergency?",
                style = MaterialTheme.typography.titleMedium,
                color = Chalk,
            )
            Spacer(Modifier.height(FleetSpace.tight))
            Text(
                "Your fleet is alerted with your position straight away.",
                style = MaterialTheme.typography.bodySmall,
                color = Ash,
            )
            Spacer(Modifier.height(FleetSpace.snug))
            Row(horizontalArrangement = Arrangement.spacedBy(FleetSpace.tight)) {
                Box(
                    Modifier
                        .weight(1f)
                        .height(FleetTouchTarget)
                        .clip(RoundedCornerShape(FleetRadius.field))
                        .background(AlertRed)
                        .pressable(onClick = onConfirm),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "Send it",
                        style = MaterialTheme.typography.labelLarge,
                        color = Color.White,
                    )
                }
                Box(
                    Modifier
                        .weight(1f)
                        .height(FleetTouchTarget)
                        .clip(RoundedCornerShape(FleetRadius.field))
                        .background(com.saarthi.driver.ui.design.OnyxRaised)
                        .pressable(onClick = onCancel),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "Cancel",
                        style = MaterialTheme.typography.labelLarge,
                        color = Ash,
                    )
                }
            }
        }
    }
}

/** How long the map stays where the driver put it before tracking resumes. */
private const val RESUME_FOLLOW_MS = 12_000L

/** Local helper so a dp figure can size type without importing sp at each call. */
private fun Float.sp() = androidx.compose.ui.unit.TextUnit(
    this,
    androidx.compose.ui.unit.TextUnitType.Sp,
)
