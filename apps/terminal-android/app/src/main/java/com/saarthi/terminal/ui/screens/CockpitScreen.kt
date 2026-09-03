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
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
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
import com.saarthi.terminal.domain.NavigationAnnouncer
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
import com.saarthi.terminal.util.DebugLog
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
     * to yank it straight back, which made looking ahead impossible. Panning
     * stops the tracking and raises the recentre control.
     *
     * And then it comes back on its own. That second half was missing, and its
     * absence was most of what "the map does not move with the marker" described:
     * a tablet bracketed beside a gear lever collects accidental touches all day,
     * every one of them ended tracking permanently, and the driver was left
     * dragging the map back by hand for the rest of the shift. Every navigator
     * resumes after a quiet interval, and so does this — while leaving the
     * recentre control for a driver who wants it back immediately.
     */
    var followVehicle by remember { mutableStateOf(true) }

    /** Bumped on every pan, so the resume timer restarts rather than stacking. */
    var panEpoch by remember { mutableStateOf(0) }

    LaunchedEffect(followVehicle, panEpoch) {
        if (followVehicle) return@LaunchedEffect
        delay(RESUME_FOLLOW_MS)
        followVehicle = true
    }

    /** Panels cleared away, map to the edges. See the note on this screen. */
    var expandMap by remember { mutableStateOf(false) }

    val moving = state.moving
    val telemetry = state.telemetry
    val context = LocalContext.current
    val route by viewModel.route.collectAsState()

    /*
     * The journey, as the view model is following it.
     *
     * The next turn, what is left, whether the driver has come off the route and
     * whether they have arrived — all computed against the polyline on every
     * fix, in one object. It used to be recomputed here, inside the composition,
     * from whichever manoeuvre point happened to be nearest in a straight line:
     * so the banner pointed at junctions already behind the cab, and it
     * refreshed when the clock ticked rather than when the vehicle moved.
     */
    val navigation by viewModel.navigation.collectAsState()

    /*
     * Show the driver where they are going, once.
     *
     * Incremented when the destination changes, which is the map's cue to frame
     * the whole route before handing the camera back to the vehicle. Choosing a
     * petrol pump and being shown no more of the map than you could already see
     * is the other half of what was reported.
     */
    var frameRouteRequest by remember { mutableStateOf(0) }
    LaunchedEffect(route?.destination?.latitude, route?.destination?.longitude) {
        if (route != null) {
            followVehicle = true
            frameRouteRequest += 1
        }
    }

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
            // The engine reports the transition itself through `onStateChange`,
            // including the case where waking fails to open the microphone. This
            // is only the hook for anything else that should happen on a wake.
            onWake = {},
            onUtterance = { heard -> viewModel.ask(heard, spoken = true) },
            /*
             * The engine drives the state, rather than each caller setting it on
             * the way in and nobody clearing it on the way out.
             *
             * That was the old arrangement, and it meant the assistant showed as
             * listening from the first wake word until a driver happened to
             * dismiss a card — so the one indicator that says whether the cab
             * microphone is live was permanently stuck on. Transitions now come
             * from the class that actually knows.
             */
            onStateChange = { next -> viewModel.setAssistantState(next) },
        )
    }
    val voiceAmplitude by voice.amplitude.collectAsState()
    val assistantBusy by voice.assistantBusy.collectAsState()

    /*
     * The speaker and the microphone have different lifetimes.
     *
     * Text-to-speech comes up with the cockpit and stays: spoken turn
     * instructions are the whole reason navigation is usable at speed, and they
     * must not depend on a wake word that is off by default. Listening is the
     * one that waits to be asked for — a microphone in a cab where people have
     * private conversations, and a real cost in battery.
     *
     * They used to be started together, which is why a terminal with the default
     * settings could navigate a driver across a state in complete silence.
     */
    DisposableEffect(Unit) {
        voice.prepareSpeech()
        onDispose { voice.releaseSpeech() }
    }

    DisposableEffect(viewModel.settings.wakeWordEnabled) {
        if (viewModel.settings.wakeWordEnabled) voice.startListening()
        onDispose { voice.stopListening() }
    }

    /*
     * Turn instructions, spoken.
     *
     * The banner tells a driver where to turn on a screen they must not be
     * looking at, which makes it half a feature. This is the other half.
     *
     * All the judgement — which cue, which band, how often, in what words — is
     * in [NavigationAnnouncer], which is pure and tested. What lives here is
     * only the two things that need the running app: whether the driver has
     * asked for silence, and whether Saarthi is already using the speaker.
     */
    val guidanceOn by viewModel.voiceGuidance.collectAsState()
    val guidanceMuted = !guidanceOn
    val announcer = remember { NavigationAnnouncer() }

    LaunchedEffect(navigation, telemetry.at, guidanceMuted, assistantBusy) {
        if (guidanceMuted || !voice.canSpeak) return@LaunchedEffect

        /*
         * Never talk over the driver, or over Saarthi answering them.
         *
         * Gated on the *audio channel* rather than on `assistant.state`, which
         * describes the card on screen and stays in SPEAKING until somebody
         * dismisses it — waiting on that would silence navigation for the rest
         * of the shift after a single question. THINKING is included because it
         * is the gap between the driver asking and the answer arriving, and
         * filling it with a turn instruction reads as the terminal ignoring them.
         *
         * The whole evaluation is skipped rather than the sentence discarded, so
         * the announcer's state does not advance — on the next fix the vehicle
         * is closer and the cue that gets spoken is the one that is true *then*,
         * rather than a stale instruction queued behind a conversation.
         */
        if (assistantBusy || assistant.state == AssistantState.THINKING) return@LaunchedEffect

        // A previewed route is a drawing, not a journey. Passing a null key
        // resets the announcer, so pressing Start opens with "Heading to …"
        // rather than resuming mid-sentence from a route the driver was only
        // looking at.
        val route = navigation.route?.takeIf { navigation.guiding }
        val cue = announcer.next(
            NavigationAnnouncer.Input(
                journeyKey = route?.let {
                    "${it.destination.name}|${it.destination.latitude}|${it.destination.longitude}"
                },
                // The polyline's own identity, so a re-route to the same place
                // resets the manoeuvres without repeating the opening line.
                routeKey = route?.let { "${it.geometry.size}|${it.distanceKm}|${it.summary}" },
                destinationName = route?.destination?.name.orEmpty(),
                routeDistanceKm = route?.distanceKm ?: 0.0,
                routeDurationMinutes = route?.durationMinutes ?: 0,
                instruction = navigation.step?.instruction,
                maneuver = navigation.step?.maneuver,
                modifier = navigation.step?.modifier,
                roadName = navigation.step?.name,
                stepMetres = navigation.stepMetres,
                speedKph = telemetry.value(Metric.SPEED) ?: 0.0,
                rerouting = navigation.rerouting,
                rerouteFailed = navigation.rerouteFailed,
                arrived = navigation.arrived,
                nowMs = System.currentTimeMillis(),
            ),
        )

        if (cue != null) voice.speakGuidance(cue)
    }

    /*
     * The assistant always goes away.
     *
     * Every path out of a non-idle state used to depend on something else
     * finishing: speech ending, an answer arriving, a driver tapping a card. Any
     * one of those failing — no speech engine, a request that never returns, a
     * recogniser that dies mid-phrase — left the blob on screen for the rest of
     * the session with nothing on the cockpit able to clear it.
     *
     * Those individual paths are fixed, but a visible indicator that *can* get
     * stuck is a class of bug worth closing rather than a list of cases worth
     * chasing. This is the backstop: whatever the assistant is doing, if it is
     * still doing it well past the point of plausibility, it stops.
     *
     * The budgets differ because the states do — listening is bounded by the
     * recogniser's own timeout, thinking by a network round trip, speaking by
     * the length of an answer. `setAssistantState` rather than `dismiss`, so a
     * spoken answer stays on screen to be read after the blob has gone.
     */
    LaunchedEffect(assistant.state) {
        val budget = when (assistant.state) {
            AssistantState.IDLE -> return@LaunchedEffect
            AssistantState.LISTENING -> 15_000L
            AssistantState.THINKING -> 25_000L
            AssistantState.SPEAKING -> 45_000L
            AssistantState.ERROR -> 8_000L
        }
        delay(budget)
        DebugLog.warn("voice", "Assistant stuck in ${assistant.state}; clearing")
        viewModel.setAssistantState(AssistantState.IDLE)
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
                    navigation = navigation,
                    moving = moving,
                    followVehicle = followVehicle,
                    frameRouteRequest = frameRouteRequest,
                    guidanceMuted = guidanceMuted,
                    onStartNavigation = { viewModel.startNavigation() },
                    onToggleGuidance = {
                        viewModel.setVoiceGuidance(guidanceMuted)
                        // Stop mid-sentence. A driver reaching for the mute
                        // button wants the talking to stop now, not at the end
                        // of the road name.
                        if (!guidanceMuted) voice.stopSpeaking()
                    },
                    showStatus = !expanded,
                    fullBleed = expandMap,
                    onRecentre = { followVehicle = true },
                    onPanned = {
                        followVehicle = false
                        panEpoch += 1
                    },
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

        /*
         * Saarthi, when Saarthi is actually doing something.
         *
         * Hidden at idle and floated over the map the moment the wake phrase
         * lands — which is what "pops up when I say Hey Saarthi" means, and also
         * what makes the shape informative: a blob on screen now means the
         * microphone is live or an answer is coming, rather than meaning nothing
         * at all because it is always there.
         *
         * Over the map rather than in the bar, because at that moment it is the
         * only thing the driver is interacting with, and 88dp of it is readable
         * in peripheral vision where 52dp in a row of six was not.
         */
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
                    amplitude = voiceAmplitude,
                    // Tapping the blob puts it away. A driver who set it off by
                    // accident — and the wake phrase does fire on road noise —
                    // needs one obvious way to stop it that is not a menu.
                    onClick = { viewModel.dismissAssistant() },
                )
                assistant.transcript?.takeIf { it.isNotBlank() }?.let { heard ->
                    Spacer(Modifier.height(12.dp))
                    Surface(
                        shape = RoundedCornerShape(14.dp),
                        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
                        shadowElevation = 6.dp,
                    ) {
                        Text(
                            "“$heard”",
                            Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                            style = MaterialTheme.typography.bodyLarge,
                            maxLines = 2,
                        )
                    }
                }
            }
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

/**
 * How long the map stays where the driver put it before tracking resumes.
 *
 * Long enough to read the road ahead or check a junction; short enough that an
 * accidental knock does not leave the vehicle sliding off the screen for the
 * rest of the shift. Twelve seconds is roughly what in-car systems settle on,
 * and it is the number that matters most to the complaint this fixes: without
 * it, every stray touch was permanent.
 */
private const val RESUME_FOLLOW_MS = 12_000L

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
    val rpm = telemetry.value(Metric.RPM)
    val odometer = (telemetry.value(Metric.ODOMETER) ?: fallbackOdometerKm)
        ?.let { "%,d".format(it.toLong()) }

    /*
     * Mileage, in the unit an Indian driver actually thinks in.
     *
     * Kilometres per litre, from two readings the vehicle is already giving:
     * road speed and fuel consumption. It is only meaningful while moving —
     * standing still with the engine running is zero km/L and infinite thirst,
     * which is true and useless — so below walking pace it reads as nothing
     * rather than as a number that swings between 0 and absurd at every light.
     */
    val fuelRate = telemetry.value(Metric.FUEL_RATE)
    val speedForMileage = telemetry.value(Metric.SPEED)
    val mileage = if (
        fuelRate != null && fuelRate > 0.1 &&
        speedForMileage != null && speedForMileage > 5.0
    ) {
        "%.1f".format(speedForMileage / fuelRate)
    } else {
        null
    }

    GlassCard(modifier, contentPadding = if (compact) 12.dp else 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            /*
             * Two dials, the pair a driver expects to see together.
             *
             * Speed answers "am I within the limit"; RPM answers "am I in the
             * right gear, and is the engine labouring" — which is the reading a
             * fleet's fuel bill actually turns on. They were never going to be
             * one gauge and a list of numbers.
             */
            Dial(
                value = speedKph,
                maximum = 120.0,
                unit = "km/h",
                warnAbove = 90.0,
                simulated = telemetry.isSimulated(Metric.SPEED),
                size = if (compact) 78.dp else 92.dp,
                label = "speed",
            )

            Spacer(Modifier.width(if (compact) 10.dp else 14.dp))

            Dial(
                value = rpm,
                // 4,000 rather than a car's 8,000: a diesel truck lives between
                // idle and about 2,200, and a scale built for a petrol engine
                // would leave the needle in the first third all day.
                maximum = 4_000.0,
                unit = "rpm",
                warnAbove = 2_600.0,
                simulated = telemetry.isSimulated(Metric.RPM),
                size = if (compact) 78.dp else 92.dp,
                label = "rpm",
            )

            Spacer(Modifier.width(if (compact) 12.dp else 16.dp))

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
                Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    Readout(
                        label = "Mileage",
                        value = mileage,
                        unit = "km/L",
                        simulated = telemetry.isSimulated(Metric.FUEL_RATE),
                        modifier = Modifier.weight(1f),
                    )
                    Readout(
                        label = "Consumption",
                        value = fuelRate?.let { "%.1f".format(it) },
                        unit = "L/h",
                        simulated = telemetry.isSimulated(Metric.FUEL_RATE),
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
 * One instrument: an arc that fills, and the figure inside it.
 *
 * The number has to be read; the shape can be caught. That difference is the
 * whole reason a vehicle has dials rather than a table of values, and it is why
 * speed and RPM get this and fuel level does not — a driver checks fuel when
 * they think about it and checks speed without thinking at all.
 *
 * `maximum` is a display scale, never a limit: past it the arc simply stays
 * full while the figure keeps counting. A gauge that rescaled itself would make
 * the same needle position mean different things a minute apart.
 */
@Composable
private fun Dial(
    value: Double?,
    maximum: Double,
    unit: String,
    warnAbove: Double,
    simulated: Boolean,
    size: Dp,
    label: String,
) {
    val reduced = LocalReducedMotion.current
    val sweep by animateFloatAsState(
        targetValue = ((value ?: 0.0) / maximum).coerceIn(0.0, 1.0).toFloat(),
        // Eased rather than snapped. A needle that jumps between readings looks
        // like a fault; a sweep looks like the vehicle changing, which it is.
        animationSpec = if (reduced) {
            tween(0)
        } else {
            spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessLow)
        },
        label = "$label-sweep",
    )

    val tone = when {
        value == null -> MaterialTheme.colorScheme.onSurfaceVariant
        value >= warnAbove -> SaarthiWarning
        else -> MaterialTheme.colorScheme.primary
    }
    val track = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)

    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = Stroke(width = 10.dp.toPx(), cap = StrokeCap.Round)
            val inset = stroke.width / 2
            val arcSize = Size(this.size.width - stroke.width, this.size.height - stroke.width)
            // 240° starting bottom-left: the shape a driver expects a dial to
            // have, rather than a closed ring.
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
             * The digits move when they change: slide-and-fade rather than a
             * straight swap, so a changing value registers in peripheral vision.
             * Instant under reduced motion.
             */
            AnimatedContent(
                targetState = value?.toInt(),
                transitionSpec = {
                    if (reduced) {
                        fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                    } else {
                        (fadeIn(tween(180)) + slideInVertically { it / 3 }) togetherWith
                            (fadeOut(tween(140)) + slideOutVertically { -it / 3 })
                    }
                },
                label = "$label-digits",
            ) { shown ->
                Text(
                    shown?.toString() ?: "—",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    color = if (shown == null) {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    unit,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    softWrap = false,
                )
                if (simulated) {
                    Spacer(Modifier.width(5.dp))
                    Box(
                        Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(SaarthiWarning),
                    )
                }
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
    navigation: TerminalViewModel.NavigationUi,
    moving: Boolean,
    followVehicle: Boolean,
    /** Bumped to ask the map to frame the whole route once. */
    frameRouteRequest: Int,
    /** Whether spoken turn instructions are silenced. */
    guidanceMuted: Boolean,
    onToggleGuidance: () -> Unit,
    /** The driver pressed Start on a previewed route. */
    onStartNavigation: () -> Unit,
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
                // Remembered against the route, so the map's update path is not
                // handed a freshly-allocated list of several thousand pairs on
                // every recomposition — the clock alone would rebuild it three
                // times a minute.
                routeGeometry = remember(route) {
                    route?.geometry?.map { it.latitude to it.longitude } ?: emptyList()
                },
                destination = route?.destination?.let { it.latitude to it.longitude },
                followVehicle = followVehicle,
                onUserPannedMap = onPanned,
                navigating = navigation.guiding,
                previewingRoute = navigation.previewing,
                frameRouteRequest = frameRouteRequest,
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
            //
            // Only once the driver has started, though: a previewed route has no
            // next turn to show, and the preview card at the foot of the map is
            // already saying everything there is to say about it.
            AnimatedVisibility(
                visible = navigation.guiding,
                enter = panelEnter(),
                exit = panelExit(),
            ) {
                route?.let { current ->
                    NavigationBanner(
                        route = current,
                        navigation = navigation,
                        guidanceMuted = guidanceMuted,
                        onToggleGuidance = onToggleGuidance,
                        onCancel = onCancelRoute,
                        modifier = Modifier.widthIn(max = 440.dp),
                    )
                }
            }
        }

        // Hidden while a route is being previewed: the camera is deliberately
        // showing the whole journey there, so offering to recentre it on the
        // vehicle is offering to undo what the driver just asked for.
        AnimatedVisibility(
            visible = !followVehicle && !navigation.previewing,
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

        /*
         * The foot of the map says one of two things.
         *
         * Before Start: what this journey would be, and the button that begins
         * it. After Start: what is left of it. They share a corner because they
         * are the same question at two moments, and because a driver's thumb
         * already goes there.
         */
        AnimatedVisibility(
            visible = navigation.previewing,
            enter = panelEnter(),
            exit = panelExit(),
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(12.dp),
        ) {
            route?.let { current ->
                RoutePreviewCard(
                    route = current,
                    onStart = onStartNavigation,
                    onDismiss = onCancelRoute,
                    modifier = Modifier.widthIn(max = 420.dp),
                )
            }
        }

        AnimatedVisibility(
            visible = navigation.guiding,
            enter = panelEnter(),
            exit = panelExit(),
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(12.dp),
        ) {
            route?.let { current ->
                TripSummaryBar(
                    route = current,
                    navigation = navigation,
                    onCancel = onCancelRoute,
                )
            }
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
    sosArmed: Boolean,
    clockBattery: Int?,
    offline: Boolean,
    showStatus: Boolean,
    expandMap: Boolean,
    onToggleExpand: () -> Unit,
    onSos: () -> Unit,
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
