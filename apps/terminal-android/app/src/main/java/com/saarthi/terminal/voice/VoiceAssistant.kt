package com.saarthi.terminal.voice

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
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
    /**
     * Raised whenever the assistant's real state changes.
     *
     * Without this there were two states — the one this class tracks, which is
     * correct, and the one the cockpit renders, which was set on the way *in* to
     * each step and never on the way out. So the blob showed a microphone from
     * the first wake until somebody dismissed a card, and a driver looking at
     * their cab could not tell whether the terminal was listening to them.
     *
     * One source now: this class owns the transitions and pushes them out.
     */
    private val onStateChange: (AssistantState) -> Unit = {},
) {

    private val _state = MutableStateFlow(AssistantState.IDLE)
    val state: StateFlow<AssistantState> = _state.asStateFlow()

    /** The one place the assistant's state changes, so nothing can drift. */
    private fun moveTo(next: AssistantState) {
        if (_state.value == next) return
        _state.value = next
        main.post { onStateChange(next) }
    }

    /** 0..1, driven from the recogniser's RMS. Feeds the blob's wobble. */
    private val _amplitude = MutableStateFlow(0f)
    val amplitude: StateFlow<Float> = _amplitude.asStateFlow()

    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null

    @Volatile private var listeningForWake = false
    @Volatile private var capturingCommand = false
    @Volatile private var shouldRun = false

    /**
     * True between handing text to the engine and the engine finishing it.
     *
     * The recogniser is deaf for that whole window — see [pauseListening] — so
     * this is also what says whether the wake loop needs restarting afterwards.
     */
    @Volatile private var speaking = false

    /** `SpeechRecognizer` must be driven from the main looper, always. */
    private val main = Handler(Looper.getMainLooper())

    /**
     * True while the driver is talking to Saarthi, or Saarthi is talking back.
     *
     * Deliberately not derived from [AssistantState]. That describes the *card
     * on screen*, which stays in SPEAKING until the driver dismisses it — so
     * anything that waited on it would fall silent for the rest of the shift
     * after the first question. This is the audio channel itself: it goes false
     * the moment the sentence ends, whether or not anybody has tidied the screen.
     */
    private val _assistantBusy = MutableStateFlow(false)
    val assistantBusy: StateFlow<Boolean> = _assistantBusy.asStateFlow()

    /**
     * Whether the engine has finished initialising.
     *
     * `TextToSpeech` hands back an object immediately and becomes usable a
     * moment later, on a callback. Speaking in that window is silently dropped —
     * which on a slow tablet is exactly the window the opening announcement
     * falls into.
     */
    @Volatile private var speechReady = false

    /** Held between requesting the speaker and giving it back. */
    private var focusRequest: AudioFocusRequest? = null

    /**
     * Consecutive wake-loop attempts that failed for a reason other than silence.
     *
     * Silence is the normal outcome and does not count. A recogniser that keeps
     * failing for any other reason is one that is not going to start working,
     * and looping on it opens and closes the microphone for the rest of the
     * shift for no benefit at all.
     */
    @Volatile private var wakeFailures = 0

    /** True once the wake loop has been given up on for this session. */
    @Volatile private var wakeUnavailable = false

    /** Whether this device can listen. Speaking is a separate question. */
    val available: Boolean
        get() = SpeechRecognizer.isRecognitionAvailable(context) &&
            DeviceEnvironment.microphoneStatus(context) == DeviceEnvironment.Subsystem.OK

    /**
     * Whether this device can talk.
     *
     * Deliberately independent of [available]. Spoken turn instructions need a
     * speaker and nothing else, and the wake word is off by default — tying the
     * two together is what made the terminal silent on a journey for want of a
     * microphone permission it was never going to use.
     */
    val canSpeak: Boolean get() = tts != null && speechReady

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    /**
     * Bring up the speech engine.
     *
     * Split from [startListening] on purpose, and the split is what makes spoken
     * navigation possible at all. The two halves of this class answer to
     * different policies: listening is a microphone in a cab where people have
     * private conversations, so it is off unless a fleet turns it on. Speaking
     * is a speaker, it is on while a route is being followed, and it is the
     * whole reason turn-by-turn guidance is usable — a driver cannot read the
     * banner and watch the road at the same time.
     *
     * They used to be started together, which meant a terminal with the wake
     * word off — the default — had no text-to-speech engine at all.
     */
    fun prepareSpeech() {
        if (tts != null) return

        /*
         * Configured on the main thread, *after* the constructor has returned.
         *
         * `TextToSpeech`'s init callback can fire synchronously from inside the
         * constructor when the engine is already bound — before the assignment
         * to `tts` has happened. Every `tts?.` inside the callback is then a
         * no-op against a null field: no language is set, and, far worse, no
         * utterance listener is attached. Nothing then ever reports that speech
         * finished, so the recogniser is never resumed and `speaking` stays true
         * for the life of the app.
         *
         * That is a silent failure that looks exactly like "the voice does not
         * work", which is why it is worth the indirection. Posting guarantees
         * the field is populated before anything reads it.
         */
        val engine = TextToSpeech(context) { status ->
            main.post { configureSpeech(status) }
        }
        tts = engine
    }

    private fun configureSpeech(status: Int) {
        val engine = tts
        if (status != TextToSpeech.SUCCESS || engine == null) {
            DebugLog.warn("voice", "Text-to-speech failed to initialise (status $status)")
            speechReady = false
            tts = null
            return
        }

        /*
         * Announce itself as navigation guidance.
         *
         * Without this the engine plays on the media stream as an anonymous
         * sound: it competes with the radio at the same volume instead of
         * ducking it, and a Bluetooth head unit has no idea it is a direction
         * rather than a track. A driver with music on hears a muddle, which is
         * indistinguishable from the voice not working at all.
         */
        engine.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
        )

        // Indian English where the device has it. A driver in Uttar Pradesh
        // being read a road name in a Californian accent is worse than useless —
        // they have to translate it back.
        val indian = engine.setLanguage(Locale("en", "IN"))
        if (indian == TextToSpeech.LANG_MISSING_DATA || indian == TextToSpeech.LANG_NOT_SUPPORTED) {
            DebugLog.info("voice", "Indian English voice not installed; falling back")
            val fallback = engine.setLanguage(Locale.UK)
            if (fallback == TextToSpeech.LANG_MISSING_DATA ||
                fallback == TextToSpeech.LANG_NOT_SUPPORTED
            ) {
                engine.language = Locale.US
            }
        }

        engine.setOnUtteranceProgressListener(utteranceListener)
        speechReady = true
        DebugLog.info(
            "voice",
            "Text-to-speech ready: ${engine.voice?.locale ?: engine.language} " +
                "via ${engine.defaultEngine ?: "the default engine"}",
        )
    }

    /**
     * Why speech is or is not working, in one line, for the diagnostics screen.
     *
     * "The voice is not working" has four completely different causes — no
     * engine installed, no voice data for the language, the media volume at
     * zero, or the app never having been asked to speak — and a driver in a yard
     * cannot tell them apart. Neither could support, over the phone.
     */
    fun speechDiagnostic(): String {
        val engine = tts ?: return "No text-to-speech engine on this device."
        if (!speechReady) return "Text-to-speech is still starting."

        val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        val volume = audio?.getStreamVolume(AudioManager.STREAM_MUSIC) ?: -1
        val max = audio?.getStreamMaxVolume(AudioManager.STREAM_MUSIC) ?: -1

        val voice = engine.voice?.locale?.toLanguageTag() ?: "unknown voice"
        val level = if (volume < 0) "volume unknown" else "media volume $volume of $max"
        val muted = if (volume == 0) " — the device is muted" else ""

        return "$voice, $level$muted"
    }

    fun releaseSpeech() {
        speaking = false
        speechReady = false
        _assistantBusy.value = false
        abandonAudioFocus()
        tts?.stop()
        tts?.shutdown()
        tts = null
    }

    /**
     * Ask the system for the speaker, politely.
     *
     * `TRANSIENT_MAY_DUCK` is the request a navigator makes: whatever is playing
     * turns down for the instruction and comes back up afterwards, rather than
     * stopping. A truck cab usually has something playing, and guidance that
     * arrives at the same volume as the music is guidance nobody can make out.
     */
    private fun requestAudioFocus() {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest == null) {
                focusRequest = AudioFocusRequest.Builder(
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK,
                )
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build(),
                    )
                    // Nothing to do when focus moves: the utterance is short and
                    // the engine has already been handed the text.
                    .setOnAudioFocusChangeListener {}
                    .build()
            }
            focusRequest?.let { runCatching { audio.requestAudioFocus(it) } }
        } else {
            @Suppress("DEPRECATION")
            runCatching {
                audio.requestAudioFocus(
                    null,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK,
                )
            }
        }
    }

    private fun abandonAudioFocus() {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { runCatching { audio.abandonAudioFocusRequest(it) } }
        } else {
            @Suppress("DEPRECATION")
            runCatching { audio.abandonAudioFocus(null) }
        }
    }

    /** Begin listening for the wake phrase. Requires a microphone. */
    fun startListening() {
        if (shouldRun) return
        if (!ensureRecognizer()) return
        shouldRun = true
        wakeFailures = 0
        wakeUnavailable = false
        listenForWake()
    }

    /**
     * Why the wake phrase is or is not working, for the diagnostics screen.
     *
     * "I said Hey Saarthi and nothing happened" has several causes that look
     * identical from the cab — the microphone refused, no on-device language
     * model is installed, the phrase was simply not heard over road noise — and
     * a driver cannot tell them apart. Neither could support.
     */
    fun wakeDiagnostic(): String = when {
        !available -> "No speech recogniser, or the microphone was refused."
        wakeUnavailable -> "The recogniser kept failing, so listening was stopped."
        shouldRun -> "Listening for “Hey Saarthi”."
        else -> "Wake word is switched off."
    }

    fun stopListening() {
        shouldRun = false
        releaseRecognizer()
        moveTo(AssistantState.IDLE)
    }

    /**
     * Make sure there is a recogniser, creating one if there is not.
     *
     * This is what makes the tap-to-talk button work on a terminal with the wake
     * word switched off — which is the default, and therefore the ordinary case.
     * Previously the recogniser was created only by the wake loop, so tapping
     * the assistant on a normally-configured terminal set the state to listening
     * and then called `startListening` on a null field: the blob appeared, the
     * microphone was never opened, and nothing ever came back to put it away.
     *
     * Must be called from the main thread. `SpeechRecognizer` insists on it, and
     * every caller here is either a click handler or already posted.
     */
    private fun ensureRecognizer(): Boolean {
        if (recognizer != null) return true
        if (!available) {
            DebugLog.info("voice", "Speech recognition unavailable or microphone denied")
            return false
        }
        recognizer = runCatching {
            SpeechRecognizer.createSpeechRecognizer(context).apply {
                setRecognitionListener(listener)
            }
        }.onFailure { error ->
            DebugLog.warn("voice", "Could not create a recogniser: ${error.message}")
        }.getOrNull()
        return recognizer != null
    }

    private fun releaseRecognizer() {
        listeningForWake = false
        capturingCommand = false
        runCatching { recognizer?.destroy() }
        recognizer = null
    }

    /** Begin capturing a command directly — the tap-the-blob path. */
    /**
     * Begin capturing a question directly — the tap-the-button path.
     *
     * Returns false when this device cannot listen at all: no recogniser
     * installed, or the microphone refused. The caller is expected to offer the
     * typed route instead, because a terminal without a microphone must still
     * be able to ask Saarthi something.
     */
    fun listenNow(): Boolean {
        if (!ensureRecognizer()) return false

        capturingCommand = true
        listeningForWake = false
        _assistantBusy.value = true
        moveTo(AssistantState.LISTENING)
        startRecognition(offlineOnly = false)
        return true
    }

    /** Saarthi answering a question. Sets the assistant's own state. */
    fun speak(text: String) {
        val engine = tts
        if (engine == null) {
            /*
             * Nothing to speak with.
             *
             * The answer is still on screen — this only means it will not be
             * read aloud. Returning silently used to leave the assistant stuck
             * in SPEAKING for the rest of the session, because the only thing
             * that ever cleared that state was the utterance finishing. On a
             * device with no text-to-speech engine the blob simply never went
             * away, which is exactly what was reported.
             */
            DebugLog.info("voice", "No speech engine; the answer is shown but not spoken")
            moveTo(AssistantState.IDLE)
            return
        }
        moveTo(AssistantState.SPEAKING)
        _assistantBusy.value = true
        pauseListening()
        requestAudioFocus()
        speaking = true
        engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE_ANSWER)
    }

    /**
     * A navigation instruction.
     *
     * Distinct from [speak] in two ways that matter.
     *
     * It does **not** touch [AssistantState]. Guidance is the map talking, not
     * Saarthi answering — putting the assistant into SPEAKING every thirty
     * seconds would leave the blob pulsing for the length of a journey and make
     * a driver think it was listening to them the whole time.
     *
     * And it flushes rather than queues. A cue is only worth saying while it is
     * still true: if "in five hundred metres, turn left" is still waiting behind
     * something when the vehicle is a hundred metres out, the right thing is to
     * drop it and say the instruction that applies now.
     */
    fun speakGuidance(text: String) {
        val engine = tts ?: return
        pauseListening()
        requestAudioFocus()
        speaking = true
        DebugLog.debug("voice", "Guidance: $text")
        engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE_GUIDANCE)
    }

    /** Stop mid-sentence — the driver muted guidance, or navigation ended. */
    fun stopSpeaking() {
        if (!speaking) return
        tts?.stop()
        speaking = false
        _assistantBusy.value = false
        abandonAudioFocus()
        resumeListening()
    }

    /**
     * Go deaf while the tablet is talking.
     *
     * Without this the recogniser hears the terminal's own voice. On a wake loop
     * that is not merely wasteful — every instruction spoken would be run
     * through wake-phrase matching and through the partial-result emergency
     * classifier, which is a path that must only ever see a human speaking.
     */
    private fun pauseListening() {
        if (recognizer == null) return
        listeningForWake = false
        main.post { runCatching { recognizer?.cancel() } }
    }

    private fun resumeListening() {
        if (!shouldRun || capturingCommand) return
        // Posted, because `onDone` arrives on a binder thread and
        // `SpeechRecognizer` refuses to be started from anywhere but the main
        // looper.
        main.post { if (shouldRun && !speaking) listenForWake() }
    }

    private val utteranceListener = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) = Unit

        override fun onDone(utteranceId: String?) {
            speaking = false
            abandonAudioFocus()
            if (utteranceId == UTTERANCE_ANSWER) {
                _assistantBusy.value = false
                // Back to idle when the sentence ends, not when somebody taps
                // the card away. The blob is how a driver tells whether the cab
                // microphone is live, so it must go quiet the moment it is.
                moveTo(AssistantState.IDLE)
            }
            resumeListening()
        }

        @Deprecated("Required by the platform; the typed overload is called instead.")
        override fun onError(utteranceId: String?) = finishUtterance(utteranceId)

        override fun onError(utteranceId: String?, errorCode: Int) {
            DebugLog.warn("voice", "Speech failed (error $errorCode)")
            finishUtterance(utteranceId)
        }

        private fun finishUtterance(utteranceId: String?) {
            speaking = false
            abandonAudioFocus()
            if (utteranceId == UTTERANCE_ANSWER) {
                _assistantBusy.value = false
                moveTo(AssistantState.IDLE)
            }
            resumeListening()
        }
    }

    fun setState(state: AssistantState) {
        moveTo(state)
    }

    // -----------------------------------------------------------------------
    // Recognition
    // -----------------------------------------------------------------------

    /**
     * Restart the wake loop after a pause.
     *
     * The loop used to restart the instant the recogniser gave up, which on a
     * quiet road is several times a minute, all shift. Every restart re-opens
     * the microphone, and from Android 12 that lights the system privacy
     * indicator — so the cab display showed the microphone dot blinking
     * continuously while nobody was talking to it. It looked like the terminal
     * was recording, and there was no way for a driver to tell that it was not.
     *
     * A pause between attempts does not change what is captured; it changes how
     * often the microphone is acquired, which is what a person can see.
     */
    private fun scheduleWakeRestart(delayMs: Long = WAKE_RESTART_DELAY_MS) {
        if (!shouldRun) return
        main.postDelayed({ if (shouldRun && !speaking) listenForWake() }, delayMs)
    }

    private fun listenForWake() {
        if (!shouldRun) return
        if (!ensureRecognizer()) return
        listeningForWake = true
        capturingCommand = false

        /*
         * Do not tread on a question already in flight.
         *
         * The wake loop restarts the moment a command has been captured — which
         * is *before* Saarthi has answered it. Dropping to idle unconditionally
         * meant the blob stopped showing that anything was happening a fraction
         * of a second after the driver finished speaking, and then flicked back
         * to thinking when the view model caught up.
         */
        if (_state.value == AssistantState.LISTENING) moveTo(AssistantState.IDLE)

        startRecognition(offlineOnly = true)
    }

    /**
     * What to do once a question has been captured, or has failed.
     *
     * With the wake word on, go back to waiting for it. With it off, the
     * microphone was opened for exactly one question and is closed again —
     * leaving it running would be precisely the always-listening arrangement the
     * fleet declined by not enabling it.
     */
    private fun afterCommand() {
        if (shouldRun) scheduleWakeRestart(WAKE_RESTART_AFTER_COMMAND_MS) else releaseRecognizer()
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
            if (capturingCommand) moveTo(AssistantState.LISTENING)
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
                wakeUnavailable = true
                moveTo(AssistantState.ERROR)
                return
            }

            /*
             * Give up on a recogniser that is never going to work.
             *
             * Silence is the normal outcome of a wake loop and resets the count.
             * Anything else — no language model on the device, the service
             * refusing, a client fault — repeated over and over is a recogniser
             * that will not start working by being asked again. Left looping it
             * cycles the microphone all shift and recognises nothing, which is
             * the worst of both: the privacy cost of always-on listening with
             * none of the benefit.
             *
             * `wakeUnavailable` is surfaced through [wakeDiagnostic], so the
             * admin screen can say why the wake phrase is doing nothing instead
             * of leaving it a mystery.
             */
            if (expected) {
                wakeFailures = 0
            } else {
                wakeFailures += 1
                if (wakeFailures >= MAX_WAKE_FAILURES) {
                    shouldRun = false
                    wakeUnavailable = true
                    releaseRecognizer()
                    DebugLog.warn(
                        "voice",
                        "Wake word disabled: the recogniser failed $wakeFailures times " +
                            "in a row (last error $error)",
                    )
                    moveTo(AssistantState.IDLE)
                    return
                }
            }

            if (capturingCommand) {
                capturingCommand = false
                _assistantBusy.value = false
                moveTo(AssistantState.IDLE)
                afterCommand()
                return
            }
            scheduleWakeRestart()
        }

        override fun onResults(results: Bundle?) {
            _amplitude.value = 0f
            val heard = results
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()
                .orEmpty()

            if (heard.isBlank()) {
                scheduleWakeRestart()
                return
            }

            if (capturingCommand) {
                capturingCommand = false
                moveTo(AssistantState.THINKING)
                onUtterance(heard)
                afterCommand()
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
                    moveTo(AssistantState.THINKING)
                    onUtterance(remainder)
                    afterCommand()
                } else if (!listenNow()) {
                    // The phrase matched but the microphone could not be
                    // reopened. Without this the assistant is left showing as
                    // listening for ever, waiting for speech nothing is
                    // capturing — the blob on screen would never go away.
                    DebugLog.warn("voice", "Woken, but the recogniser would not start")
                    moveTo(AssistantState.IDLE)
                    afterCommand()
                }
                return
            }

            // Speech that was not addressed to Saarthi. Heard, discarded, and
            // the microphone released until the next attempt.
            wakeFailures = 0
            scheduleWakeRestart()
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

    private companion object {
        const val UTTERANCE_ANSWER = "saarthi-answer"
        const val UTTERANCE_GUIDANCE = "saarthi-guidance"

        /**
         * How long the microphone stays closed between wake attempts.
         *
         * The whole cost of a missed wake phrase is that the driver says it
         * again. The cost of no pause is a microphone acquired several times a
         * minute for twelve hours, and a privacy indicator blinking on the dash
         * with nothing to explain it.
         */
        const val WAKE_RESTART_DELAY_MS = 1_500L

        /** Shorter after a real command: the driver may still be talking. */
        const val WAKE_RESTART_AFTER_COMMAND_MS = 600L

        /**
         * Consecutive non-silence failures before the wake loop gives up.
         *
         * Roughly half a minute of trying. Enough to ride out a transient
         * recogniser fault, few enough that a device with no on-device language
         * model stops cycling its microphone almost immediately.
         */
        const val MAX_WAKE_FAILURES = 12
    }
}
