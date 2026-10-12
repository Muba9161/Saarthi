package com.saarthi.driver.ui.shift.assistant

import android.Manifest
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.StringRes
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.core.data.AssistantUi
import com.saarthi.core.domain.AssistantState
import com.saarthi.core.ui.CockpitVoice
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.AlwaysDark
import com.saarthi.driver.ui.design.BrandLockup
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.rise
import kotlinx.coroutines.delay

/**
 * Saarthi, the voice assistant: speak, or type — a conversation, as the web
 * chat holds one.
 *
 * Opens listening, as the design does, unless Saarthi is already busy — woken
 * by its phrase, or still holding an answer. The microphone, Send and Stop
 * share the one button beside the field; Stop quiets Saarthi and leaves the
 * conversation on screen, and closing stops whatever was under way, so nothing
 * is read out after the driver has moved on. Without a microphone — refused,
 * or no recogniser on the phone — the typed field takes over, because a driver
 * must always be able to ask.
 */
@Composable
fun AssistantOverlay(visible: Boolean, cockpit: TerminalViewModel, voice: CockpitVoice, onClose: () -> Unit) {
    val assistant by cockpit.assistant.collectAsState()
    val close = {
        voice.hush()
        cockpit.dismissAssistant()
        onClose()
    }
    BackHandler(enabled = visible, onBack = close)
    val reduced = Saarthi.reducedMotion
    AnimatedVisibility(
        visible = visible,
        enter = if (reduced) EnterTransition.None else fadeIn(tween(450)),
        exit = if (reduced) ExitTransition.None else fadeOut(tween(250)),
    ) {
        AlwaysDark { AssistantScreen(cockpit, voice, assistant, close) }
    }
}

@Composable
private fun AssistantScreen(
    cockpit: TerminalViewModel,
    voice: CockpitVoice,
    assistant: AssistantUi,
    onClose: () -> Unit,
) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = remember { FocusRequester() }
    val scroll = rememberScrollState()
    var typed by rememberSaveable { mutableStateOf("") }
    // Why the microphone is not an option, once that is known; the field then takes the focus.
    var typingOnly by remember { mutableStateOf<Int?>(null) }

    fun typeInstead(@StringRes reason: Int) {
        typingOnly = reason
        runCatching { focus.requestFocus() }
    }

    val microphone = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        when {
            !granted -> typeInstead(R.string.assistant_mic_refused)
            !voice.listenNow() -> typeInstead(R.string.assistant_no_mic)
        }
    }

    fun listen() {
        voice.hush()
        when {
            !context.microphoneAllowed() -> microphone.launch(Manifest.permission.RECORD_AUDIO)
            !voice.listenNow() -> typeInstead(R.string.assistant_no_mic)
        }
    }

    /** Quiet Saarthi and stop waiting, keeping the conversation on screen. */
    fun stop() {
        voice.hush()
        cockpit.stopAssistant()
    }

    fun ask(question: String) {
        val cleaned = question.trim()
        if (cleaned.isEmpty()) return
        voice.hush()
        cockpit.ask(cleaned, spoken = false)
        typed = ""
        keyboard?.hide()
    }

    LaunchedEffect(Unit) {
        if (assistant.state == AssistantState.IDLE && assistant.answer == null) listen()
    }

    // The newest message in view as the conversation grows.
    LaunchedEffect(assistant.transcript, assistant.answer, assistant.earlier.size) {
        scroll.animateScrollTo(scroll.maxValue)
    }

    // Checked while the assistant is open: the volume is changed with the
    // phone's own keys, which tell nobody.
    var speakerMuted by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        while (true) {
            speakerMuted = voice.speakerMuted
            delay(VOLUME_CHECK_MS)
        }
    }

    val state = assistant.state
    val busy = state == AssistantState.LISTENING || state == AssistantState.THINKING || state == AssistantState.SPEAKING
    val line = when (state) {
        AssistantState.LISTENING -> R.string.assistant_listening
        AssistantState.THINKING -> R.string.assistant_thinking
        AssistantState.SPEAKING -> R.string.assistant_answer
        AssistantState.ERROR -> R.string.assistant_error
        AssistantState.IDLE -> typingOnly ?: if (voice.wakeWordOn) R.string.assistant_idle_wake else R.string.assistant_idle
    }

    Column(
        Modifier
            .fillMaxSize()
            .drawBehind { drawNightSky() }
            .windowInsetsPadding(WindowInsets.statusBars)
            .windowInsetsPadding(WindowInsets.navigationBars)
            .imePadding()
            .padding(start = 20.dp, end = 20.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        AssistantHeader(onClose)
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(scroll),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                // Busy, the blob stops Saarthi; quiet, it listens.
                SaarthiBlob(
                    state,
                    voice.amplitude,
                    Modifier.pressable(
                        scale = 0.96f,
                        label = stringResource(if (busy) R.string.assistant_stop else R.string.assistant_speak),
                        onClick = { if (busy) stop() else listen() },
                    ),
                )
                Text(
                    stringResource(line),
                    style = SType.cardTitle.copy(fontSize = 17.sp),
                    color = c.fg,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
                when (state) {
                    AssistantState.LISTENING -> ListeningBars(voice.amplitude)
                    AssistantState.THINKING -> ThinkingDots()
                    else -> Unit
                }
            }
            assistant.earlier.forEach { exchange ->
                TranscriptBubble(exchange.question)
                AnswerBubble(exchange.answer, exchange.caveats, exchange.sources)
            }
            assistant.transcript?.let { heard ->
                key(heard, assistant.earlier.size) { TranscriptBubble(heard, Modifier.rise(distance = 16.dp, durationMs = 600)) }
            }
            assistant.answer?.let { answer ->
                key(answer, assistant.earlier.size) {
                    AnswerBubble(answer, assistant.caveats, assistant.sources, Modifier.rise(distance = 16.dp, durationMs = 600))
                }
            }
        }
        if (speakerMuted) SpeakerNotice(onTurnUp = { voice.raiseVolume() })
        // Offered before the first question, as the web chat's welcome does — and
        // never while Saarthi is busy or the driver is typing. Once a
        // conversation is under way its room belongs to the answers.
        val fresh = assistant.transcript == null && assistant.earlier.isEmpty()
        if (fresh && !busy && typed.isBlank()) Suggestions(onAsk = ::ask)
        AskField(
            value = typed,
            onValueChange = { typed = it },
            action = when {
                busy -> AskAction.STOP
                typed.isNotBlank() || typingOnly != null -> AskAction.SEND
                else -> AskAction.LISTEN
            },
            onAction = {
                when {
                    busy -> stop()
                    typed.isNotBlank() -> ask(typed)
                    typingOnly == null -> listen()
                }
            },
            focus = focus,
        )
    }
}

/** The logo, Saarthi's name, and close. */
@Composable
private fun AssistantHeader(onClose: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(56.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        BrandLockup(height = 52.dp, plated = true)
        Text(stringResource(R.string.assistant_title), style = SType.headerTitle, color = Saarthi.colors.fg, modifier = Modifier.weight(1f))
        CircleButton(
            Lucide.close,
            stringResource(R.string.action_close),
            onClose,
            background = Color.White.copy(alpha = 0.1f),
            elevated = false,
            stroke = 2f,
        )
    }
}

/**
 * The design's ground: `radial-gradient(120% 70% at 50% 30%, #17193A, #0B0B12 70%)`.
 * An ellipse, drawn as a circle under a vertical scale.
 */
private fun DrawScope.drawNightSky() {
    drawRect(SkyEdge)
    val centre = Offset(size.width / 2f, size.height * 0.3f)
    val radiusX = size.width * 1.2f
    val radiusY = size.height * 0.7f
    scale(scaleX = 1f, scaleY = radiusY / radiusX, pivot = centre) {
        drawCircle(
            Brush.radialGradient(0f to SkyCentre, 0.7f to SkyEdge, center = centre, radius = radiusX),
            radius = radiusX,
            center = centre,
        )
    }
}

private val SkyCentre = Color(0xFF17193A)
private val SkyEdge = Color(0xFF0B0B12)

/** How often the media volume is looked at while the assistant is open. */
private const val VOLUME_CHECK_MS = 1_500L
