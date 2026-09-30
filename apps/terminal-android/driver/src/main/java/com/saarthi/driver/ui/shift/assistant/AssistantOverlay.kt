package com.saarthi.driver.ui.shift.assistant

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
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
import androidx.core.content.ContextCompat
import com.saarthi.core.domain.AssistantState
import com.saarthi.core.ui.CockpitVoice
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.AlwaysDark
import com.saarthi.driver.ui.design.BrandMark
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.rise

/**
 * Saarthi, the voice assistant: speak, or type.
 *
 * Opens listening, as the design does, unless Saarthi is already busy — woken
 * by its phrase, or still holding an answer. Everything shown is the view
 * model's: the state, what was heard, the answer with its caveats and sources.
 * Without a microphone — refused, or no recogniser on the phone — the typed
 * field takes over, because a driver must always be able to ask.
 */
@Composable
fun AssistantOverlay(visible: Boolean, cockpit: TerminalViewModel, voice: CockpitVoice, onClose: () -> Unit) {
    val assistant by cockpit.assistant.collectAsState()
    val close = {
        voice.hush(assistant.state, cockpit.settings.wakeWordEnabled)
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
    assistant: TerminalViewModel.AssistantUi,
    onClose: () -> Unit,
) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = remember { FocusRequester() }
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
        voice.hush(assistant.state, cockpit.settings.wakeWordEnabled)
        when {
            !context.microphoneGranted() -> microphone.launch(Manifest.permission.RECORD_AUDIO)
            !voice.listenNow() -> typeInstead(R.string.assistant_no_mic)
        }
    }

    fun ask(question: String) {
        val cleaned = question.trim()
        if (cleaned.isEmpty() || assistant.state == AssistantState.THINKING) return
        voice.hush(assistant.state, cockpit.settings.wakeWordEnabled)
        cockpit.ask(cleaned, spoken = false)
        typed = ""
        keyboard?.hide()
    }

    LaunchedEffect(Unit) {
        if (assistant.state == AssistantState.IDLE && assistant.answer == null) listen()
    }

    val state = assistant.state
    val line = when (state) {
        AssistantState.LISTENING -> R.string.assistant_listening
        AssistantState.THINKING -> R.string.assistant_thinking
        AssistantState.SPEAKING -> R.string.assistant_answer
        AssistantState.ERROR -> R.string.assistant_error
        AssistantState.IDLE -> if (assistant.answer != null) R.string.assistant_answer else typingOnly ?: R.string.assistant_idle
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
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                // While it listens or thinks the blob stops it, as the design has it; otherwise it listens again.
                val stops = state == AssistantState.LISTENING || state == AssistantState.THINKING
                SaarthiBlob(
                    state,
                    voice.amplitude,
                    Modifier.pressable(
                        scale = 0.96f,
                        label = stringResource(if (stops) R.string.assistant_stop else R.string.assistant_speak),
                        onClick = { if (stops) onClose() else listen() },
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
            // A new question clears the old exchange from view, as the design's listening screen shows none.
            val heard = assistant.transcript
            if (heard != null && state != AssistantState.LISTENING) {
                key(heard) { TranscriptBubble(heard, Modifier.rise(distance = 16.dp, durationMs = 600)) }
            }
            val answer = assistant.answer
            if (answer != null && state != AssistantState.LISTENING && state != AssistantState.THINKING) {
                key(answer) {
                    AnswerBubble(answer, assistant.caveats, assistant.sources, Modifier.rise(distance = 16.dp, durationMs = 600))
                }
            }
        }
        Suggestions(onAsk = ::ask)
        AskField(
            value = typed,
            onValueChange = { typed = it },
            canSend = typed.isNotBlank() && state != AssistantState.THINKING,
            onSend = { ask(typed) },
            focus = focus,
        )
    }
}

/** The mark, Saarthi's name, and close. */
@Composable
private fun AssistantHeader(onClose: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(56.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        BrandMark(height = 32.dp, plated = true)
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
 * Quiet Saarthi before it is closed or asked something else.
 *
 * A question being listened for is only cancelled when the wake phrase is
 * off: with it on, the recogniser is the wake loop's too, and stopping it
 * would switch "Hey Saarthi" off for the rest of the shift.
 */
private fun CockpitVoice.hush(state: AssistantState, wakeWordOn: Boolean) {
    when (state) {
        AssistantState.SPEAKING -> engine.stopSpeaking()
        AssistantState.LISTENING -> if (!wakeWordOn) engine.stopListening()
        else -> Unit
    }
}

private fun Context.microphoneGranted(): Boolean =
    ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

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
