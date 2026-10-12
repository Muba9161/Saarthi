package com.saarthi.core.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.saarthi.core.domain.AssistantState
import com.saarthi.core.telemetry.Metric
import com.saarthi.core.domain.NavigationAnnouncer
import com.saarthi.core.util.DebugLog
import com.saarthi.core.voice.VoiceAssistant
import kotlinx.coroutines.delay

/**
 * Everything the cockpit does with the microphone and the speaker.
 *
 * Pulled out of the cockpit screen so that a second cockpit — the driver app's
 * own, which looks nothing like the fitted tablet's — does not have to carry a
 * second copy of it. None of this is decoration: it is the wake phrase, the
 * spoken turn instructions that make navigation usable at speed, and the
 * backstop that stops a stuck indicator claiming a cab microphone is live when
 * it is not. A duplicated copy of that would drift, and the drift would be
 * silent.
 *
 * The terminal's [com.saarthi.core.ui.screens.CockpitScreen] still holds its own
 * inline version. That is deliberate for now — it is a shipping surface on
 * hardware bolted into vehicles, and moving it over is a change to make on its
 * own rather than folded into a redesign of a different app.
 */
@Stable
class CockpitVoice internal constructor(
    val engine: VoiceAssistant,
    /** Microphone level, for the assistant blob to breathe with. */
    val amplitude: Float,
    /** True when the driver has silenced spoken turn instructions. */
    val guidanceMuted: Boolean,
    /** True while "Hey Saarthi" is being listened for — switched on, and this phone able to. */
    val wakeWordOn: Boolean,
) {
    /** Whether this device can listen at all. False with no recogniser. */
    val canListen: Boolean get() = engine.available

    /** True when the phone's media volume is at zero, so an answer would play silently. */
    val speakerMuted: Boolean get() = engine.speakerMuted

    /** Turn a silent phone up — on the driver's tap only. */
    fun raiseVolume() = engine.raiseVolume()

    /** Stop listening to a question or reading an answer, leaving "Hey Saarthi" as it was. */
    fun hush() = engine.hush()

    /**
     * Start listening now, without a wake phrase.
     *
     * Returns false when the device cannot listen, which is the caller's cue to
     * open the typed assistant sheet instead — a terminal whose microphone
     * permission was refused must still be able to ask a question.
     */
    fun listenNow(): Boolean = engine.available && engine.listenNow()
}

/**
 * Wire the voice engine to a view model for as long as a cockpit is on screen.
 *
 * Deliberately scoped to the composable rather than the view model: the
 * recogniser holds a cab microphone, and a driver who signs off should get it
 * released with the screen rather than left running for the rest of the shift.
 *
 * [wakeWord] is the app's own choice of whether "Hey Saarthi" is listened for.
 * Even when it is on, the phrase is only listened for while the app is in
 * front: a phone in a pocket with the app behind something else is not a cab
 * display, and a microphone open there is one nobody can see.
 */
@Composable
fun rememberCockpitVoice(viewModel: TerminalViewModel, wakeWord: Boolean): CockpitVoice {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val state by viewModel.uiState.collectAsState()
    val assistant by viewModel.assistant.collectAsState()
    val navigation by viewModel.navigation.collectAsState()
    val telemetry = state.telemetry

    val engine = remember {
        VoiceAssistant(
            context = context,
            // The engine reports the transition itself through `onStateChange`,
            // including the case where waking fails to open the microphone.
            onWake = {},
            onUtterance = { heard -> viewModel.ask(heard, spoken = true) },
            // The engine drives the state rather than each caller setting it on
            // the way in and nobody clearing it on the way out.
            onStateChange = { next -> viewModel.setAssistantState(next) },
            // A phone has no business chiming every two seconds: the phrase is
            // listened for on the phone's offline speech, or not at all.
            quietWake = true,
        )
    }
    val amplitude by engine.amplitude.collectAsState()
    val wakeActive by engine.wakeActive.collectAsState()
    val assistantBusy by engine.assistantBusy.collectAsState()

    /*
     * The speaker and the microphone have different lifetimes.
     *
     * Text-to-speech comes up with the cockpit and stays: spoken turn
     * instructions are the whole reason navigation is usable at speed, and they
     * must not depend on a wake word that is off by default. Listening is the
     * one that waits to be asked for — a microphone in a cab where people have
     * private conversations, and a real cost in battery.
     */
    DisposableEffect(Unit) {
        engine.prepareSpeech()
        onDispose { engine.releaseSpeech() }
    }

    DisposableEffect(wakeWord, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> if (wakeWord) engine.startListening()
                Lifecycle.Event.ON_STOP -> engine.stopListening()
                else -> Unit
            }
        }
        if (wakeWord && lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) engine.startListening()
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            engine.stopListening()
        }
    }

    val guidanceOn by viewModel.voiceGuidance.collectAsState()
    val guidanceMuted = !guidanceOn
    val announcer = remember { NavigationAnnouncer() }

    /*
     * Turn instructions, spoken.
     *
     * All the judgement — which cue, which band, how often, in what words — is
     * in [NavigationAnnouncer], which is pure and tested. What lives here is
     * only the two things that need the running app: whether the driver has
     * asked for silence, and whether Saarthi is already using the speaker.
     */
    LaunchedEffect(navigation, telemetry.at, guidanceMuted, assistantBusy) {
        if (guidanceMuted || !engine.canSpeak) return@LaunchedEffect

        /*
         * Never talk over the driver, or over Saarthi answering them.
         *
         * Gated on the *audio channel* rather than on `assistant.state`, which
         * describes the card on screen and stays in SPEAKING until somebody
         * dismisses it. THINKING is included because it is the gap between the
         * driver asking and the answer arriving.
         *
         * The whole evaluation is skipped rather than the sentence discarded, so
         * the announcer's state does not advance — on the next fix the vehicle
         * is closer and the cue spoken is the one true *then*.
         */
        if (assistantBusy || assistant.state == AssistantState.THINKING) return@LaunchedEffect

        // A previewed route is a drawing, not a journey. A null key resets the
        // announcer, so pressing Start opens with "Heading to …" rather than
        // resuming mid-sentence from a route the driver was only looking at.
        // Google Maps speaks its own turns while it guides; two voices would be worse than one.
        val route = navigation.route?.takeIf { navigation.guiding && !navigation.handedOff }
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

        if (cue != null) engine.speakGuidance(cue)
    }

    /*
     * The assistant always goes away.
     *
     * A visible indicator that *can* get stuck is a class of bug worth closing
     * rather than a list of cases worth chasing — this is the backstop. The
     * budgets differ because the states do: listening is bounded by the
     * recogniser's own timeout, thinking by a network round trip, speaking by
     * the length of an answer. `setAssistantState` rather than `dismiss`, so a
     * spoken answer stays on screen to be read after the blob has gone.
     */
    LaunchedEffect(assistant.state) {
        val budget = when (assistant.state) {
            AssistantState.IDLE -> return@LaunchedEffect
            AssistantState.LISTENING -> 15_000L
            // Past the network's own 30-second limit, so a slow answer ends in
            // "cannot reach Saarthi" rather than in this backstop.
            AssistantState.THINKING -> 35_000L
            AssistantState.SPEAKING -> 45_000L
            AssistantState.ERROR -> 8_000L
        }
        delay(budget)
        DebugLog.warn("voice", "Assistant stuck in ${assistant.state}; clearing")
        // A question given up on is stopped, not just hidden: an answer that
        // arrived after this would otherwise be read out of nowhere.
        if (assistant.state == AssistantState.THINKING) viewModel.stopAssistant()
        else viewModel.setAssistantState(AssistantState.IDLE)
    }

    // Read each answer aloud as it arrives. Keyed on the conversation's length
    // too, so the same words given twice in a row are still spoken twice.
    LaunchedEffect(assistant.answer, assistant.earlier.size) {
        val answer = assistant.answer
        if (answer != null && assistant.state == AssistantState.SPEAKING) {
            engine.speak(answer)
        }
    }

    return remember(amplitude, guidanceMuted, wakeActive) {
        CockpitVoice(engine = engine, amplitude = amplitude, guidanceMuted = guidanceMuted, wakeWordOn = wakeActive)
    }
}
