package com.saarthi.terminal.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import com.saarthi.terminal.domain.AssistantState
import com.saarthi.terminal.domain.VoiceClassifier
import com.saarthi.terminal.util.DebugLog
import com.saarthi.terminal.util.DeviceEnvironment
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Locale

/**
 * "Hey Saarthi" (specification sections 33 and 35).
 *
 * Wake-word detection using Android's own on-device recogniser, and the choice
 * is the whole design. Section 33 asks that private audio not be uploaded merely
 * to detect a phrase, and there are three ways to satisfy that:
 *
 *  1. A custom hotword model (Porcupine, Snowboy). Genuinely better at the job,
 *     genuinely on-device — and a licensed binary blob, a per-device fee, and a
 *     model that has to be trained for accented Indian English before it is any
 *     use in the vehicles this ships into.
 *  2. Streaming audio to a server. Rejected outright: that is a microphone in a
 *     cab uploading everything two people say to each other all shift.
 *  3. Android's `SpeechRecognizer` with `EXTRA_PREFER_OFFLINE`, restarted in a
 *     loop, matching the phrase locally.
 *
 * This is (3). It is the least accurate of the three and it is honest about
 * that: it misses the phrase in road noise, and it costs battery, which is why
 * it is **off by default** and turned on deliberately by a fleet rather than
 * starting on its own. When it does hear something, the audio never leaves the
 * device — only the recognised *text* is sent, and only after the wake phrase
 * matched.
 *
 * Emergency utterances are classified locally before anything is sent at all.
 * "Hey Saarthi, SOS" from somebody who has just been hit must not wait for a
 * network round trip.
 */
class VoiceAssistant(
    private val context: Context,
    private val onWake: () -> Unit,
    private val onUtterance: (String) -> Unit,
) {

    private val _state = MutableStateFlow(AssistantState.IDLE)
    val state: StateFlow<AssistantState> = _state.asStateFlow()

    /** 0..1, driven from the recogniser's RMS. Feeds the blob's wobble. */
    private val _amplitude = MutableStateFlow(0f)
    val amplitude: StateFlow<Float> = _amplitude.asStateFlow()

    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null

    @Volatile private var listeningForWake = false
    @Volatile private var capturingCommand = false
    @Volatile private var shouldRun = false

    val available: Boolean
        get() = SpeechRecognizer.isRecognitionAvailable(context) &&
            DeviceEnvironment.microphoneStatus(context) == DeviceEnvironment.Subsystem.OK

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    fun start() {
        if (!available) {
            DebugLog.info("voice", "Speech recognition unavailable or microphone denied")
            return
        }
        if (shouldRun) return
        shouldRun = true

        tts = TextToSpeech(context) { status ->
            if (status == TextToSpeech.SUCCESS) {
                // Indian English where the device has it. A driver in Uttar
                // Pradesh being read a road name in a Californian accent is
                // worse than useless — they have to translate it back.
                val result = tts?.setLanguage(Locale("en", "IN"))
                if (result == TextToSpeech.LANG_MISSING_DATA ||
                    result == TextToSpeech.LANG_NOT_SUPPORTED
                ) {
                    tts?.language = Locale.UK
                }
            }
        }

        recognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
            setRecognitionListener(listener)
        }
        listenForWake()
    }

    fun stop() {
        shouldRun = false
        listeningForWake = false
        capturingCommand = false
        recognizer?.destroy()
        recognizer = null
        tts?.shutdown()
        tts = null
        _state.value = AssistantState.IDLE
    }

    /** Begin capturing a command directly — the tap-the-blob path. */
    fun listenNow() {
        capturingCommand = true
        listeningForWake = false
        _state.value = AssistantState.LISTENING
        startRecognition(offlineOnly = false)
    }

    fun speak(text: String) {
        _state.value = AssistantState.SPEAKING
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "saarthi-answer")
    }

    fun setState(state: AssistantState) {
        _state.value = state
    }

    // -----------------------------------------------------------------------
    // Recognition
    // -----------------------------------------------------------------------

    private fun listenForWake() {
        if (!shouldRun) return
        listeningForWake = true
        capturingCommand = false
        _state.value = AssistantState.IDLE
        startRecognition(offlineOnly = true)
    }

    private fun startRecognition(offlineOnly: Boolean) {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
            )
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            /*
             * Offline for the wake loop.
             *
             * This is the line that makes section 33 true. While waiting for the
             * phrase the recogniser is pinned to the on-device model, so nothing
             * a driver says in the cab reaches a network — including everything
             * they say that is not addressed to Saarthi.
             *
             * Once the phrase has matched, the *command* may use the online
             * model, because at that point the person has deliberately addressed
             * the assistant and accuracy matters more.
             */
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, offlineOnly)
        }

        runCatching { recognizer?.startListening(intent) }
            .onFailure { error ->
                DebugLog.warn("voice", "Could not start listening: ${error.message}")
            }
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() {
            if (capturingCommand) _state.value = AssistantState.LISTENING
        }

        override fun onRmsChanged(rmsdB: Float) {
            // The recogniser reports roughly -2..10 dB. Normalised for the blob,
            // which only needs a shape, not a measurement.
            _amplitude.value = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
        }

        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() {
            _amplitude.value = 0f
        }

        override fun onError(error: Int) {
            _amplitude.value = 0f

            // NO_MATCH and SPEECH_TIMEOUT are the normal outcome of a wake loop
            // in a moving vehicle: most of the time nobody said anything. They
            // are not logged, or the log would be nothing else.
            val expected = error == SpeechRecognizer.ERROR_NO_MATCH ||
                error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT

            if (!expected) {
                DebugLog.debug("voice", "Recogniser error $error")
            }

            if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                // No amount of restarting fixes this, and a loop that keeps
                // trying would spin for the rest of the shift.
                shouldRun = false
                _state.value = AssistantState.ERROR
                return
            }

            if (capturingCommand) {
                capturingCommand = false
                _state.value = AssistantState.IDLE
            }
            listenForWake()
        }

        override fun onResults(results: Bundle?) {
            _amplitude.value = 0f
            val heard = results
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()
                .orEmpty()

            if (heard.isBlank()) {
                listenForWake()
                return
            }

            if (capturingCommand) {
                capturingCommand = false
                _state.value = AssistantState.THINKING
                onUtterance(heard)
                listenForWake()
                return
            }

            if (VoiceClassifier.containsWakePhrase(heard)) {
                val remainder = VoiceClassifier.stripWakePhrase(heard)
                onWake()

                if (remainder.isNotBlank()) {
                    // "Hey Saarthi, find fuel" arrived whole. Acting on it is
                    // both faster and what the person expected — asking them to
                    // repeat the question they just asked is the single most
                    // irritating thing a voice assistant does.
                    _state.value = AssistantState.THINKING
                    onUtterance(remainder)
                    listenForWake()
                } else {
                    listenNow()
                }
                return
            }

            listenForWake()
        }

        override fun onPartialResults(partialResults: Bundle?) {
            val partial = partialResults
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()
                .orEmpty()

            // An emergency recognised in a *partial* result, before the person
            // has finished speaking. Several hundred milliseconds, and in the
            // situation this exists for they matter.
            if (partial.isNotBlank() &&
                VoiceClassifier.classify(partial) ==
                com.saarthi.terminal.domain.VoiceIntent.SOS
            ) {
                capturingCommand = false
                onUtterance(partial)
            }
        }

        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }
}
