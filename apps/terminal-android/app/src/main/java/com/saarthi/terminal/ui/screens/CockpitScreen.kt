package com.saarthi.terminal.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material.icons.rounded.CloseFullscreen
import androidx.compose.material.icons.rounded.DirectionsCar
import androidx.compose.material.icons.rounded.LocalGasStation
import androidx.compose.material.icons.rounded.Logout
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.OpenInFull
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Sos
import androidx.compose.material.icons.rounded.Storefront
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.saarthi.terminal.domain.AssistantState
import com.saarthi.terminal.domain.TerminalState
import com.saarthi.terminal.network.RouteDto
import com.saarthi.terminal.telemetry.Metric
import com.saarthi.terminal.telemetry.TelemetrySnapshot
import com.saarthi.terminal.ui.AiBlob
import com.saarthi.terminal.ui.ConnectionBanner
import com.saarthi.terminal.ui.GlassBackdrop
import com.saarthi.terminal.ui.GlassCard
import com.saarthi.terminal.ui.Gutter
import com.saarthi.terminal.ui.LivePulse
import com.saarthi.terminal.ui.LocalDarkCockpit
import com.saarthi.terminal.ui.LocalReducedMotion
import com.saarthi.terminal.ui.Radius
import com.saarthi.terminal.ui.Readout
import com.saarthi.terminal.ui.SaarthiDanger
import com.saarthi.terminal.ui.SaarthiSuccess
import com.saarthi.terminal.ui.SaarthiWarning
import com.saarthi.terminal.ui.SimulatedTag
import com.saarthi.terminal.ui.StatusTone
import com.saarthi.terminal.ui.TerminalMap
import com.saarthi.terminal.ui.TerminalViewModel
import com.saarthi.terminal.ui.TouchTarget
import com.saarthi.terminal.voice.VoiceAssistant
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The cockpit (specification sections 22, 23 and 56).
 *
 * **The map is the screen.** It runs edge to edge behind everything, and the
 * instruments, the driver and the controls float on it as frosted panels. The
 * previous version boxed the map into a card at the top of a column and stacked
 * the rest underneath, which is a settings screen with a map in it — the driver
 * got a postcard of the road while three quarters of the display showed grey
 * panels they were not looking at.
 *
 * Three rules follow, and all three come from where this screen lives:
 *
 * **Everything can be cleared away except speed, the route and SOS.** The expand
 * control empties the screen down to the map; those three stay, because a driver
 * who asked for a clearer map has not stopped needing them.
 *
 * **The layout changes when the vehicle moves.** Stationary, the driver gets
 * everything. Moving, most of it goes — section 23's rule that the interface
 * must not encourage complex interaction while driving, honoured by removing the
 * interactions rather than hoping nobody uses them.
 *
 * **The layout changes with the screen.** A dash display puts the controls in
 * one row; a phone stacks them, and the map is full-bleed on both.
 */
@Composable
fun CockpitScreen(
    viewModel: TerminalViewModel,
    expanded: Boolean,
    onOpenAdmin: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val assistant by viewModel.assistant.collectAsState()
    val sosArmed by viewModel.sosArmed.collectAsState()
    val sosReference by viewModel.sosReference.collectAsState()
    val selfie by viewModel.selfie.collectAsState()

    var sheet by remember { mutableStateOf<CockpitSheet?>(null) }

    /*
     * Whether the camera is still tracking the vehicle.
     *
     * A driver looking ahead down the route drags the map; the next GPS fix used
     * to yank it straight back, which made looking ahead impossible. Panning now
     * stops the tracking and raises the recentre control, and only the driver
     * turns it back on.
     */
    var followVehicle by remember { mutableStateOf(true) }

    /** Panels cleared away, map to the edges. See the note on this screen. */
    var expandMap by remember { mutableStateOf(false) }

    val moving = state.moving
    val telemetry = state.telemetry
    val context = LocalContext.current
    val route by viewModel.route.collectAsState()

    /*
     * The next instruction, recomputed as the vehicle moves.
     *
     * Derived on the device from a route it already holds, so a driver keeps
     * being told where to turn inside a tunnel. `telemetry.at` is the dependency
     * rather than the position itself: it changes on every fix, including one
     * that lands on the same coordinates.
     */
    val nextTurn = remember(route, telemetry.at) { viewModel.nextManeuver() }

    /*
     * Voice.
     *
     * Created here rather than in the application object because it holds a
     * microphone: it exists for exactly as long as the cockpit is on screen, and
     * a driver who signs off gets the recogniser released with the screen rather
     * than left running for the rest of the shift.
     */
    val voice = remember {
        VoiceAssistant(
            context = context,
            onWake = { viewModel.setAssistantState(AssistantState.LISTENING) },
            onUtterance = { heard -> viewModel.ask(heard, spoken = true) },
        )
    }
    val voiceAmplitude by voice.amplitude.collectAsState()

    DisposableEffect(viewModel.settings.wakeWordEnabled) {
        // Off unless the fleet turned it on. Continuous listening costs battery
        // and, more to the point, is a microphone left on in a space where people
        // have private conversations.
        if (viewModel.settings.wakeWordEnabled) voice.start()
        onDispose { voice.stop() }
    }

    // Read the answer aloud when the question was asked aloud. A driver who
    // spoke to the terminal is a driver who cannot look at it.
    LaunchedEffect(assistant.answer) {
        val answer = assistant.answer
        if (answer != null && assistant.state == AssistantState.SPEAKING) {
            voice.speak(answer)
        }
    }

    /*
     * The screen's own ground.
     *
     * The map used to run edge to edge behind everything, which left the cards
     * apparently floating on a road. Android Auto gives the map a bounded panel
     * and stands the cards on the system's background beside it — two areas, not
     * one busy one — so the background is drawn first and the map is placed into
     * its share of it.
     */
    Box(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {

        // Shared by both layouts, so they cannot drift apart.
        val openAssistant: () -> Unit = {
            // Tapping starts listening directly when voice is available;
            // otherwise it opens the sheet, which has a text field. A terminal
            // with no microphone permission must still be able to ask.
            if (voice.available) {
                voice.listenNow()
                viewModel.setAssistantState(AssistantState.LISTENING)
            } else {
                sheet = CockpitSheet.ASSISTANT
            }
        }
        val signOff: () -> Unit = {
            if (state.state == TerminalState.TRIP_ACTIVE) {
                viewModel.completeTrip()
            } else {
                viewModel.endSession()
            }
            Unit
        }

        /*
         * The card column.
         *
         * Two cards, not four. The vehicle's numbers belong together — a driver
         * reads speed, fuel and temperature as one glance at the dashboard, not
         * as four separate objects — and pairing them off into a grid was what
         * produced cards of mismatched heights sitting beside each other.
         */
        val cards: @Composable ColumnScope.() -> Unit = {
            AnimatedVisibility(visible = sosArmed, enter = panelEnter(), exit = panelExit()) {
                SosConfirmation(
                    onConfirm = { viewModel.triggerSos() },
                    onCancel = { viewModel.cancelSos() },
                )
            }

            sosReference?.let { reference -> EmergencyRaisedCard(reference) }

            AnimatedVisibility(
                visible = state.state == TerminalState.READY && !moving,
                enter = panelEnter(),
                exit = panelExit(),
            ) {
                StartTripCard(compact = expanded, onStart = { viewModel.startTrip() })
            }

            assistant.answer?.let { answer ->
                AssistantCard(
                    answer = answer,
                    transcript = assistant.transcript,
                    caveats = assistant.caveats,
                    onDismiss = { viewModel.dismissAssistant() },
                )
            }

            VehicleCard(
                telemetry = telemetry,
                fallbackOdometerKm = state.server?.vehicle?.odometerKm,
                compact = expanded,
                modifier = Modifier.fillMaxWidth(),
            )

            if (state.driverName != null) {
                DriverCard(
                    registration = state.registration,
                    driverName = state.driverName,
                    selfie = selfie,
                    compact = expanded,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        val bar: @Composable (Modifier) -> Unit = { m ->
            CockpitBar(
                modifier = m,
                moving = moving,
                tripActive = state.state == TerminalState.TRIP_ACTIVE,
                assistantState = assistant.state,
                voiceAmplitude = voiceAmplitude,
                sosArmed = sosArmed,
                clockBattery = state.server?.health?.batteryPercent,
                offline = state.offline,
                // Six controls plus a clock plus a wrench do not fit across
                // 360dp: the clock was pushed off the right edge entirely. On a
                // narrow screen the status cluster moves up to the identity
                // pill, where it has room and is still one glance away.
                showStatus = expanded,
                expandMap = expandMap,
                onToggleExpand = { expandMap = !expandMap },
                onSos = { if (sosArmed) viewModel.triggerSos() else viewModel.armSos() },
                onAssistant = openAssistant,
                onServices = { sheet = CockpitSheet.SERVICES },
                onVehicle = { sheet = CockpitSheet.VEHICLE },
                onFuelNearby = {
                    viewModel.findServices("FUEL")
                    sheet = CockpitSheet.SERVICES
                },
                onSignOff = signOff,
                onOpenAdmin = onOpenAdmin,
            )
        }

        /*
         * The layout, and it is the one every in-car system uses: **a map, a
         * column of cards beside or below it, and one bar along the bottom that
         * never moves.**
         *
         *  * **Wide** (tablet, phone in landscape): map left, cards in a rail
         *    down the right at a fixed 360dp. Fixed rather than a fraction,
         *    because 42% of a landscape phone is 336dp and the same fraction of
         *    a tablet is 500 — one was too narrow to read and the other wasted
         *    half the map.
         *  * **Tall and narrow** (phone upright): map on top, cards under it,
         *    full width — where a card has the room to be read at a glance
         *    rather than squeezed into a quadrant.
         */
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = 10.dp, vertical = 8.dp),
        ) {
            Row(
                Modifier.fillMaxWidth().weight(1f),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                /*
                 * The map occupies its own panel, not the whole screen.
                 *
                 * Full-bleed, it ran on underneath the cards — which is why the
                 * right-hand column looked like it was floating on nothing in
                 * particular. Android Auto gives the map a bounded region and
                 * puts the cards beside it, and the boundary is most of what
                 * makes the arrangement read as two areas rather than one busy
                 * one.
                 *
                 * The exception is [expandMap]: asking for a bigger map should
                 * give the whole screen, so the panel drops its inset and its
                 * corners and runs to the edges.
                 */
                MapPanel(
                    state = state,
                    route = route,
                    nextTurn = nextTurn,
                    moving = moving,
                    followVehicle = followVehicle,
                    showStatus = !expanded,
                    fullBleed = expandMap,
                    onRecentre = { followVehicle = true },
                    onPanned = { followVehicle = false },
                    onCancelRoute = { viewModel.clearRoute() },
                    onOpenAdmin = onOpenAdmin,
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                )

                if (expanded) {
                    AnimatedVisibility(
                        visible = !expandMap,
                        enter = panelEnter(),
                        exit = panelExit(),
                    ) {
                        Column(
                            Modifier
                                .width(360.dp)
                                .fillMaxHeight()
                                .verticalScroll(rememberScrollState()),
                            // Tighter than the portrait stack. A landscape phone
                            // has roughly 320dp of rail, and at 10dp the driver
                            // card was left half under the bar.
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            content = cards,
                        )
                    }
                }
            }

            if (!expanded) {
                AnimatedVisibility(visible = !expandMap, enter = panelEnter(), exit = panelExit()) {
                    Column(
                        Modifier.fillMaxWidth().padding(top = 10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                        content = cards,
                    )
                }
            }

            Spacer(Modifier.height(10.dp))
            bar(Modifier.fillMaxWidth())
        }

        // --- Sheets -----------------------------------------------------------
        when (sheet) {
            CockpitSheet.SERVICES -> ServicesSheet(viewModel, expanded) { sheet = null }
            CockpitSheet.VEHICLE -> VehicleSheet(viewModel) { sheet = null }
            CockpitSheet.ASSISTANT -> AssistantSheet(viewModel) { sheet = null }
            null -> Unit
        }
    }
}

internal enum class CockpitSheet { SERVICES, VEHICLE, ASSISTANT }

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

/**
 * Everything the vehicle is reporting, in one card.
 *
 * Speed, fuel, temperature and distance are one glance at a dashboard, not four
 * separate objects — and splitting them across a grid is what produced cards of
 * different heights sitting awkwardly beside one another. Speed leads because it
 * is the only figure that matters at every moment; the rest sit under it in a
 * row, which is also how they appear on the web dashboard.
 */
@Composable
private fun VehicleCard(
    telemetry: TelemetrySnapshot,
    fallbackOdometerKm: Double?,
    /** Tighter where the column is short — a landscape phone's rail. */
    compact: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val speedKph = telemetry.value(Metric.SPEED)
    val reduced = LocalReducedMotion.current
    val target = ((speedKph ?: 0.0) / 120.0).coerceIn(0.0, 1.0).toFloat()

    // Eased rather than snapped. A needle that jumps between fixes reads as a
    // fault; a sweep reads as the vehicle changing speed, which it is.
    val sweep by animateFloatAsState(
        targetValue = target,
        animationSpec = if (reduced) {
            tween(0)
        } else {
            spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessLow)
        },
        label = "speed-sweep",
    )

    val tone = when {
        speedKph == null -> MaterialTheme.colorScheme.onSurfaceVariant
        speedKph >= 90 -> SaarthiWarning
        else -> MaterialTheme.colorScheme.primary
    }
    val track = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)
    val odometer = (telemetry.value(Metric.ODOMETER) ?: fallbackOdometerKm)
        ?.let { "%,d".format(it.toLong()) }

    GlassCard(modifier, contentPadding = if (compact) 12.dp else 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(if (compact) 82.dp else 96.dp), contentAlignment = Alignment.Center) {
                Canvas(Modifier.fillMaxSize()) {
                    val stroke = Stroke(width = 10.dp.toPx(), cap = StrokeCap.Round)
                    val inset = stroke.width / 2
                    val arcSize = Size(size.width - stroke.width, size.height - stroke.width)
                    // 240° starting bottom-left: the shape a driver expects a
                    // dial to have, rather than a closed ring.
                    drawArc(
                        color = track,
                        startAngle = 150f,
                        sweepAngle = 240f,
                        useCenter = false,
                        topLeft = Offset(inset, inset),
                        size = arcSize,
                        style = stroke,
                    )
                    drawArc(
                        color = tone,
                        startAngle = 150f,
                        sweepAngle = 240f * sweep,
                        useCenter = false,
                        topLeft = Offset(inset, inset),
                        size = arcSize,
                        style = stroke,
                    )
                }

                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    /*
                     * The digits move when they change: slide-and-fade rather
                     * than a straight swap, so a changing value registers in
                     * peripheral vision. Instant under reduced motion.
                     */
                    AnimatedContent(
                        targetState = speedKph?.toInt(),
                        transitionSpec = {
                            if (reduced) {
                                fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                            } else {
                                (fadeIn(tween(180)) + slideInVertically { it / 3 }) togetherWith
                                    (fadeOut(tween(140)) + slideOutVertically { -it / 3 })
                            }
                        },
                        label = "speed-digits",
                    ) { value ->
                        Text(
                            value?.toString() ?: "—",
                            style = MaterialTheme.typography.displaySmall,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            color = if (value == null) {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            },
                        )
                    }
                    Text(
                        "km/h",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        softWrap = false,
                    )
                }
            }

            Spacer(Modifier.width(if (compact) 14.dp else 18.dp))

            Column(
                Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(if (compact) 8.dp else 12.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    Readout(
                        label = "Fuel",
                        value = telemetry.value(Metric.FUEL_LEVEL)?.let { it.toInt().toString() },
                        unit = "%",
                        tone = fuelTone(telemetry.value(Metric.FUEL_LEVEL)),
                        simulated = telemetry.isSimulated(Metric.FUEL_LEVEL),
                        modifier = Modifier.weight(1f),
                    )
                    Readout(
                        label = "Coolant",
                        value = telemetry.value(Metric.COOLANT_TEMPERATURE)
                            ?.let { it.toInt().toString() },
                        unit = "°C",
                        tone = coolantTone(telemetry.value(Metric.COOLANT_TEMPERATURE)),
                        simulated = telemetry.isSimulated(Metric.COOLANT_TEMPERATURE),
                        modifier = Modifier.weight(1f),
                    )
                }
                Readout(
                    label = "Odometer",
                    value = odometer,
                    unit = "km",
                    simulated = telemetry.isSimulated(Metric.ODOMETER),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/**
 * The driver, and the face that was photographed to authorise them.
 *
 * Somebody putting their head into the cab is asking a single question — "is the
 * person driving this truck the person Saarthi approved?" — and a name alone
 * cannot answer it.
 */
@Composable
private fun DriverCard(
    registration: String?,
    driverName: String?,
    selfie: android.graphics.Bitmap?,
    compact: Boolean = false,
    modifier: Modifier = Modifier,
) {
    GlassCard(modifier, contentPadding = if (compact) 10.dp else 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            /*
             * Rendered from bytes the terminal fetched with its own credential.
             * The session's `selfieUrl` points at the media endpoint, which
             * authenticates a person rather than a device: the tablet knew that
             * URL and was refused at it every time, so the cab screen showed a
             * name and no face.
             */
            if (selfie != null) {
                Image(
                    bitmap = selfie.asImageBitmap(),
                    contentDescription = "Arrival photo of ${driverName ?: "the driver"}",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .size(if (compact) 42.dp else 52.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                )
                Spacer(Modifier.width(if (compact) 10.dp else 14.dp))
            }

            Column(Modifier.weight(1f)) {
                Text(
                    driverName ?: "No driver signed on",
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                )
                Text(
                    registration ?: "SAARTHI",
                    style = MaterialTheme.typography.bodyMedium,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    softWrap = false,
                )
            }
        }
    }
}

/**
 * What sits on the map itself: who this is, whether the link is live, and where
 * to turn next.
 *
 * Only navigation and identity are overlaid. A map with six floating panels on
 * it is a map you cannot see, which is why everything else moved to the cards.
 */
@Composable
private fun MapPanel(
    state: TerminalViewModel.UiState,
    route: RouteDto?,
    nextTurn: TerminalViewModel.NextManeuverUi?,
    moving: Boolean,
    followVehicle: Boolean,
    /** Clock and battery ride here when the bar has no room for them. */
    showStatus: Boolean,
    /** Edge to edge, with no frame — the driver asked for the whole map. */
    fullBleed: Boolean,
    onRecentre: () -> Unit,
    onPanned: () -> Unit,
    onCancelRoute: () -> Unit,
    onOpenAdmin: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val clock by produceState(initialValue = formatClock()) {
        while (true) {
            value = formatClock()
            delay(20_000)
        }
    }

    val shape = RoundedCornerShape(Radius.xl)
    Box(
        modifier.then(
            // The frame. Dropped in full-bleed, where rounded corners would cut
            // into a map the driver has just asked to see more of.
            if (fullBleed) {
                Modifier
            } else {
                Modifier.clip(shape).border(1.dp, MaterialTheme.colorScheme.outline, shape)
            },
        ),
    ) {
        // Inside the panel, so the map is bounded by it — and inside the
        // backdrop, so the overlays that float on the map can blur it.
        GlassBackdrop(Modifier.fillMaxSize()) {
            TerminalMap(
                position = state.telemetry.position,
                headingDegrees = state.telemetry.value(Metric.HEADING),
                driving = moving,
                routeGeometry = route?.geometry?.map { it.latitude to it.longitude }
                    ?: emptyList(),
                destination = route?.destination?.let { it.latitude to it.longitude },
                followVehicle = followVehicle,
                onUserPannedMap = onPanned,
                vehicleType = state.server?.vehicle?.vehicleType,
                modifier = Modifier.fillMaxSize(),
            )
        }

        /*
         * A scrim only where the overlays sit, so the middle of the map stays as
         * legible as the basemap drew it.
         */
        val dark = LocalDarkCockpit.current
        val scrim = if (dark) Color.Black else Color.White
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0f to scrim.copy(alpha = if (dark) 0.5f else 0.4f),
                        0.28f to Color.Transparent,
                        0.7f to Color.Transparent,
                        1f to scrim.copy(alpha = if (dark) 0.55f else 0.42f),
                    ),
                ),
        )

        Column(
            Modifier
                .align(Alignment.TopStart)
                .padding(if (fullBleed) 0.dp else 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            GlassCard(modifier = Modifier.wrapContentWidth(), contentPadding = 0.dp) {
                Row(
                    Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        state.registration ?: "SAARTHI",
                        style = MaterialTheme.typography.titleMedium,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                    )
                    Spacer(Modifier.width(10.dp))
                    LivePulse(
                        active = !state.offline,
                        tone = if (state.offline) StatusTone.WARN else StatusTone.GOOD,
                    )
                    if (showStatus) {
                        Spacer(Modifier.width(12.dp))
                        Text(
                            clock,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                        )
                        state.server?.health?.batteryPercent?.let { battery ->
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "$battery%",
                                style = MaterialTheme.typography.labelMedium,
                                maxLines = 1,
                                color = if (battery <= 15) {
                                    SaarthiWarning
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                },
                            )
                        }
                        IconButton(onClick = onOpenAdmin, modifier = Modifier.size(34.dp)) {
                            Icon(
                                Icons.Rounded.Build,
                                contentDescription = "Terminal diagnostics",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }
            }

            AnimatedVisibility(
                visible = state.offline || state.pendingUploads > 0,
                enter = panelEnter(),
                exit = panelExit(),
            ) {
                ConnectionBanner(offline = state.offline, pendingUploads = state.pendingUploads)
            }

            // Navigation survives the expand toggle. Clearing the panels is a
            // request for a clearer map, not for fewer instructions.
            AnimatedVisibility(visible = route != null, enter = panelEnter(), exit = panelExit()) {
                route?.let { current ->
                    NavigationBanner(
                        route = current,
                        next = nextTurn,
                        onCancel = onCancelRoute,
                        modifier = Modifier.widthIn(max = 440.dp),
                    )
                }
            }
        }

        AnimatedVisibility(
            visible = !followVehicle,
            enter = panelEnter(),
            exit = panelExit(),
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(12.dp),
        ) {
            FloatingCircle(
                icon = Icons.Rounded.MyLocation,
                description = "Centre the map on this vehicle",
                onClick = onRecentre,
            )
        }

        AnimatedVisibility(
            visible = route != null,
            enter = panelEnter(),
            exit = panelExit(),
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(12.dp),
        ) {
            route?.let { current -> TripSummaryBar(route = current, onCancel = onCancelRoute) }
        }

        /*
         * Speed, kept on the map when everything else has gone.
         *
         * Clearing the panels is a request for a bigger map, not a request to
         * stop being told how fast the vehicle is going — and speed is the one
         * reading a moving vehicle cannot do without. It appears here only in
         * full-bleed, because otherwise the vehicle card is already showing it.
         */
        AnimatedVisibility(
            visible = fullBleed,
            enter = panelEnter(),
            exit = panelExit(),
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(start = 12.dp, end = 12.dp, bottom = 12.dp),
        ) {
            SpeedPill(
                speedKph = state.telemetry.value(Metric.SPEED),
                simulated = state.telemetry.isSimulated(Metric.SPEED),
            )
        }
    }
}

/** Speed alone, for a screen the driver has cleared down to the map. */
@Composable
private fun SpeedPill(speedKph: Double?, simulated: Boolean) {
    GlassCard(modifier = Modifier.wrapContentWidth(), contentPadding = 0.dp) {
        Row(
            Modifier.padding(horizontal = 18.dp, vertical = 10.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Text(
                speedKph?.toInt()?.toString() ?: "—",
                style = MaterialTheme.typography.displaySmall,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
            )
            Spacer(Modifier.width(6.dp))
            Text(
                "km/h",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 6.dp),
            )
            if (simulated) {
                Spacer(Modifier.width(8.dp))
                Box(
                    Modifier
                        .padding(bottom = 12.dp)
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(SaarthiWarning),
                )
            }
        }
    }
}

@Composable
private fun AssistantCard(
    answer: String,
    transcript: String?,
    caveats: List<String>,
    onDismiss: () -> Unit,
) {
    GlassCard(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onDismiss),
        contentPadding = 14.dp,
    ) {
        transcript?.let {
            Text(
                "“$it”",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(6.dp))
        }
        Text(answer, style = MaterialTheme.typography.titleMedium)
        // Caveats are shown, not summarised away. A tool that had to cap or skip
        // something said so, and the driver is the person who needs to know.
        caveats.forEach { caveat ->
            Spacer(Modifier.height(6.dp))
            Text(caveat, style = MaterialTheme.typography.bodyMedium, color = SaarthiWarning)
        }
    }
}

@Composable
private fun EmergencyRaisedCard(reference: String) {
    Surface(
        color = SaarthiDanger,
        shape = RoundedCornerShape(Radius.xl),
        shadowElevation = 10.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(Gutter)) {
            Text(
                "Emergency raised · $reference",
                style = MaterialTheme.typography.titleMedium,
                color = Color.White,
            )
            Text(
                "Your fleet and nearby responders have been alerted. Stay where you are if it is safe.",
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = 0.92f),
            )
        }
    }
}

/** The one thing standing between a completed safety check and a trip. */
@Composable
private fun StartTripCard(compact: Boolean = false, onStart: () -> Unit) {
    Surface(
        onClick = onStart,
        shape = RoundedCornerShape(Radius.xl),
        color = SaarthiSuccess.copy(alpha = 0.94f),
        shadowElevation = 8.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(if (compact) 10.dp else 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Rounded.PlayArrow, contentDescription = null, tint = Color.White)
            Spacer(Modifier.width(10.dp))
            Column {
                Text(
                    "Safety check complete",
                    style = MaterialTheme.typography.titleMedium,
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                )
                // The second line is the call to action, and the rail is short:
                // dropping it there keeps the driver card from being pushed
                // under the bar, and the card is a button either way.
                if (!compact) {
                    Text(
                        "Tap to start your trip",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.White.copy(alpha = 0.9f),
                    )
                }
            }
        }
    }
}

/**
 * The bar along the foot, and the reason the rest of the screen can rearrange
 * itself freely.
 *
 * It is the one thing that never moves: the same controls in the same order
 * whether the truck is parked in a yard, doing 60 on a highway, or the screen
 * has been turned sideways. Android Auto puts its launcher, its assistant and
 * its status cluster exactly here for exactly that reason — a driver's hand
 * learns the position once.
 *
 * Left to right: clear the screen, ask the assistant, the destinations, then
 * SOS and the clock. SOS sits inside the bar rather than floating over the map,
 * because a control that hovers above the layout eventually lands on top of
 * something — which is precisely what it did.
 */
@Composable
private fun CockpitBar(
    modifier: Modifier = Modifier,
    moving: Boolean,
    tripActive: Boolean,
    assistantState: AssistantState,
    voiceAmplitude: Float,
    sosArmed: Boolean,
    clockBattery: Int?,
    offline: Boolean,
    showStatus: Boolean,
    expandMap: Boolean,
    onToggleExpand: () -> Unit,
    onSos: () -> Unit,
    onAssistant: () -> Unit,
    onServices: () -> Unit,
    onVehicle: () -> Unit,
    onFuelNearby: () -> Unit,
    onSignOff: () -> Unit,
    onOpenAdmin: () -> Unit,
) {
    // Re-read every twenty seconds, not every second. A cockpit clock shows
    // hours and minutes, and waking the composition sixty times more often than
    // the display can change is battery spent on nothing.
    val clock by produceState(initialValue = formatClock()) {
        while (true) {
            value = formatClock()
            delay(20_000)
        }
    }

    GlassCard(modifier, contentPadding = 8.dp) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            /*
             * The tiles share whatever is left after SOS.
             *
             * Fixed 52dp each, five of them plus a 64dp emergency button and the
             * gaps between, came to 376dp on a 336dp phone — so SOS was pushed
             * off the right edge and rendered as a red sliver. Weighting the
             * tiles means the row fits at any width, and the one control that
             * must never be missing keeps its full size.
             */
            ActionTile(
                icon = if (expandMap) Icons.Rounded.CloseFullscreen else Icons.Rounded.OpenInFull,
                label = if (expandMap) "Show the instruments" else "Expand the map",
                modifier = Modifier.weight(1f),
                onClick = onToggleExpand,
            )

            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                AiBlob(
                    state = assistantState,
                    size = 52.dp,
                    amplitude = voiceAmplitude,
                    onClick = onAssistant,
                )
            }

            if (moving) {
                // Moving: one destination, and it is fuel. A driver at speed
                // asking for anything else should be asking out loud.
                ActionTile(
                    Icons.Rounded.LocalGasStation,
                    "Fuel nearby",
                    Modifier.weight(1f),
                    onFuelNearby,
                )
            } else {
                ActionTile(Icons.Rounded.Storefront, "Services", Modifier.weight(1f), onServices)
                ActionTile(Icons.Rounded.DirectionsCar, "Vehicle", Modifier.weight(1f), onVehicle)
                ActionTile(
                    Icons.Rounded.Logout,
                    if (tripActive) "End trip" else "Sign off",
                    Modifier.weight(1f),
                    onSignOff,
                )
            }

            if (showStatus) Spacer(Modifier.weight(0.4f))

            SosButton(armed = sosArmed, onClick = onSos)

            if (!showStatus) return@Row

            Spacer(Modifier.width(4.dp))

            Column(horizontalAlignment = Alignment.End) {
                Text(
                    clock,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (offline) {
                        Text(
                            "offline",
                            style = MaterialTheme.typography.labelMedium,
                            color = SaarthiWarning,
                        )
                        Spacer(Modifier.width(6.dp))
                    }
                    clockBattery?.let { battery ->
                        Text(
                            "$battery%",
                            style = MaterialTheme.typography.labelMedium,
                            maxLines = 1,
                            color = if (battery <= 15) {
                                SaarthiWarning
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                    }
                }
            }

            if (!moving) {
                IconButton(onClick = onOpenAdmin, modifier = Modifier.size(36.dp)) {
                    Icon(
                        Icons.Rounded.Build,
                        contentDescription = "Terminal diagnostics",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
        }
    }
}

private fun formatClock(): String =
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/**
 * How a panel arrives.
 *
 * A spring, and a rise from below rather than a dissolve: the panels live at the
 * bottom of the screen, so entering from there is the direction they would move
 * if they were objects. Enough that a driver catches the arrival in peripheral
 * vision without being pulled to look at it.
 *
 * Under reduced motion it becomes an instant cut. Not a slower animation — the
 * point of that setting is that nothing moves on its own, and a gentler slide is
 * still a slide.
 */
@Composable
private fun panelEnter(): EnterTransition {
    if (LocalReducedMotion.current) return EnterTransition.None
    return fadeIn(tween(220)) +
        slideInVertically(
            spring(dampingRatio = Spring.DampingRatioLowBouncy, stiffness = Spring.StiffnessMedium),
        ) { height -> height / 4 }
}

@Composable
private fun panelExit(): ExitTransition {
    if (LocalReducedMotion.current) return ExitTransition.None
    return fadeOut(tween(160)) + slideOutVertically(tween(200)) { height -> height / 4 }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** A round control that floats on the map. */
@Composable
private fun FloatingCircle(
    icon: ImageVector,
    description: String,
    onClick: () -> Unit,
    size: Dp = TouchTarget,
) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 8.dp,
        modifier = Modifier.size(size),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = description, tint = MaterialTheme.colorScheme.primary)
        }
    }
}

/**
 * One destination in the bottom bar.
 *
 * Sized to [TouchTarget] rather than to its label, because it is pressed by a
 * hand that the eyes using it are not watching.
 */
@Composable
private fun CockpitAction(
    icon: ImageVector,
    label: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    var pressed by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(
        targetValue = if (pressed && !LocalReducedMotion.current) 0.94f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy),
        label = "action-press",
    )

    LaunchedEffect(pressed) {
        if (pressed) {
            delay(120)
            pressed = false
        }
    }

    Surface(
        modifier = modifier
            .height(TouchTarget)
            .graphicsLayer(scaleX = scale, scaleY = scale),
        onClick = {
            pressed = true
            onClick()
        },
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(6.dp))
            Text(
                label,
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1,
                softWrap = false,
            )
        }
    }
}

/**
 * One destination in the bar.
 *
 * Icon only, and sized to a hand the eyes are not watching. Labels cost roughly
 * three times the width and bought nothing a driver needed: these are the same
 * few destinations on every shift, and the icon is what the hand aims at. The
 * label survives as the content description, so dropping the word from the
 * screen does not drop it from the accessibility tree.
 */
@Composable
private fun ActionTile(
    icon: ImageVector,
    label: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    var pressed by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(
        targetValue = if (pressed && !LocalReducedMotion.current) 0.92f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy),
        label = "tile-press",
    )

    LaunchedEffect(pressed) {
        if (pressed) {
            delay(120)
            pressed = false
        }
    }

    Surface(
        modifier = modifier
            .height(52.dp)
            .graphicsLayer(scaleX = scale, scaleY = scale),
        onClick = {
            pressed = true
            onClick()
        },
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                icon,
                contentDescription = label,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(24.dp),
            )
        }
    }
}

/**
 * The emergency control (specification section 36).
 *
 * Always present, in every layout — including with the panels cleared — at the
 * same place on the screen. A driver reaching for it in an emergency should not
 * have to look for it.
 *
 * Two taps rather than one. A large red button on a screen mounted beside a gear
 * lever gets pressed by a coat sleeve, and a false emergency costs a responder a
 * journey and teaches a fleet to distrust the alarm. Arming is the first tap and
 * firing is a deliberate second one; the voice path skips this entirely, because
 * somebody who has said "Hey Saarthi, SOS" out loud has already been deliberate.
 */
@Composable
private fun SosButton(armed: Boolean, onClick: () -> Unit) {
    // Grows while armed, so a control waiting for a second tap looks like it is
    // waiting rather than like it ignored the first.
    val scale by animateFloatAsState(
        targetValue = if (armed && !LocalReducedMotion.current) 1.08f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy),
        label = "sos-armed",
    )

    Surface(
        modifier = Modifier
            .size(TouchTarget)
            .graphicsLayer(scaleX = scale, scaleY = scale)
            .clip(CircleShape)
            .clickable(onClick = onClick),
        shape = CircleShape,
        color = if (armed) SaarthiDanger else SaarthiDanger.copy(alpha = 0.92f),
        border = if (armed) {
            androidx.compose.foundation.BorderStroke(3.dp, Color.White)
        } else {
            null
        },
        shadowElevation = 10.dp,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                Icons.Rounded.Sos,
                contentDescription = if (armed) "Confirm emergency" else "Emergency",
                tint = Color.White,
                modifier = Modifier.size(30.dp),
            )
        }
    }
}

@Composable
private fun SosConfirmation(onConfirm: () -> Unit, onCancel: () -> Unit) {
    Surface(
        color = SaarthiDanger,
        shape = RoundedCornerShape(20.dp),
        shadowElevation = 12.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(Gutter)) {
            Text(
                "Raise an emergency?",
                style = MaterialTheme.typography.titleLarge,
                color = Color.White,
            )
            Text(
                "Your fleet, nearby Saarthi vehicles and your truck association will be alerted with your location.",
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = 0.92f),
            )
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Surface(
                    modifier = Modifier
                        .weight(1f)
                        .height(TouchTarget)
                        .clickable(onClick = onCancel),
                    shape = RoundedCornerShape(12.dp),
                    color = Color.White.copy(alpha = 0.2f),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            "Cancel",
                            color = Color.White,
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                }
                Surface(
                    modifier = Modifier
                        .weight(1f)
                        .height(TouchTarget)
                        .clickable(onClick = onConfirm),
                    shape = RoundedCornerShape(12.dp),
                    color = Color.White,
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            "Raise emergency",
                            color = SaarthiDanger,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }
}

private fun fuelTone(value: Double?): StatusTone = when {
    value == null -> StatusTone.NEUTRAL
    value <= 8 -> StatusTone.CRITICAL
    value <= 20 -> StatusTone.WARN
    else -> StatusTone.NEUTRAL
}

private fun coolantTone(value: Double?): StatusTone = when {
    value == null -> StatusTone.NEUTRAL
    value >= 108 -> StatusTone.CRITICAL
    value >= 100 -> StatusTone.WARN
    else -> StatusTone.NEUTRAL
}
