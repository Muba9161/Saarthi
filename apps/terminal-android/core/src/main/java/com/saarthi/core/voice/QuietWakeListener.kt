package com.saarthi.core.voice

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import com.saarthi.core.util.DebugLog
import java.io.IOException
import kotlin.concurrent.thread

/** Something that listens for the wake phrase until stopped. */
internal interface WakeListener {
    fun start()
    fun stop()
}

/**
 * Whether this phone can listen for "Hey Saarthi" quietly: Android 13 and the
 * phone's own on-device recogniser. Without both, the microphone is opened only
 * when the driver taps it.
 */
fun canListenQuietly(context: Context): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

/** A quiet wake listener when this phone can run one; null when it cannot. */
internal fun quietWakeListener(
    context: Context,
    onHeard: (text: String, final: Boolean) -> Unit,
    onUnavailable: (reason: String) -> Unit,
): WakeListener? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && canListenQuietly(context)) {
        QuietWakeListener(context, onHeard, onUnavailable)
    } else {
        null
    }

/**
 * "Hey Saarthi" without the chime.
 *
 * The wake loop in [VoiceAssistant] restarts Android's recogniser every few
 * seconds, because a recogniser session ends at the first pause. Every restart
 * re-opens the microphone, and Google's speech service plays its listening
 * chime each time: a phone on the dash went *bip* every two seconds for as long
 * as the app was open.
 *
 * This holds **one** microphone stream for as long as it runs and feeds it to
 * the phone's own on-device recogniser, in a single segmented session (Android
 * 13 and later). The service never opens the microphone itself, so it never
 * chimes; the session never ends at a pause, so nothing is restarted; and the
 * recogniser is the on-device one, so nothing said in the cab leaves the phone.
 * The microphone dot shows steadily while it listens, which is the truth.
 *
 * It only *hears*. What counts as the wake phrase, and what happens next, is
 * [onHeard]'s caller's business; this reports each piece of speech it made out.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private class QuietWakeListener(
    private val context: Context,
    /**
     * A piece of speech made out — `final` once the speaker paused, otherwise
     * the words so far. Called on the main thread.
     */
    private val onHeard: (text: String, final: Boolean) -> Unit,
    /** The phone cannot do this after all — no model, or a recogniser that keeps failing. */
    private val onUnavailable: (reason: String) -> Unit,
) : WakeListener {

    private val main = Handler(Looper.getMainLooper())

    private var recognizer: SpeechRecognizer? = null
    private var audio: AudioRecord? = null
    private var source: ParcelFileDescriptor? = null

    /** True between [start] and [stop]. */
    @Volatile private var running = false

    /** Bumped on every session, so a late callback from an old one is ignored. */
    @Volatile private var session = 0

    private var language = PREFERRED_LANGUAGE
    private var failures = 0
    private var downloadRequested = false

    /** Begin listening. Main thread only, as [SpeechRecognizer] requires. */
    override fun start() {
        if (running) return
        if (!microphoneAllowed()) {
            onUnavailable("The microphone is not allowed.")
            return
        }
        running = true
        failures = 0
        beginSession()
    }

    /** Stop listening and give the microphone back. Main thread only. */
    override fun stop() {
        if (!running) return
        running = false
        session += 1
        endSession()
    }

    private fun beginSession() {
        if (!running) return
        endSession()
        val id = ++session

        val recorder = openMicrophone() ?: return fail("The microphone could not be opened.")
        val (read, write) = ParcelFileDescriptor.createPipe()
        val engine = runCatching { SpeechRecognizer.createOnDeviceSpeechRecognizer(context) }
            .getOrNull()
            ?: run {
                recorder.release()
                read.close()
                write.close()
                return fail("No on-device recogniser.")
            }
        engine.setRecognitionListener(listenerFor(id))

        audio = recorder
        source = read
        recognizer = engine

        recorder.startRecording()
        pump(recorder, write, id)
        engine.startListening(intentFor(read))
    }

    private fun endSession() {
        runCatching { recognizer?.cancel() }
        runCatching { recognizer?.destroy() }
        recognizer = null
        runCatching { audio?.stop() }
        runCatching { audio?.release() }
        audio = null
        runCatching { source?.close() }
        source = null
    }

    /** Copy the microphone into the recogniser until the session is replaced or stopped. */
    private fun pump(recorder: AudioRecord, write: ParcelFileDescriptor, id: Int) {
        thread(name = "saarthi-wake-audio", isDaemon = true) {
            val buffer = ByteArray(CHUNK_BYTES)
            try {
                ParcelFileDescriptor.AutoCloseOutputStream(write).use { out ->
                    while (running && session == id) {
                        val read = recorder.read(buffer, 0, buffer.size)
                        if (read < 0) break
                        if (read > 0) out.write(buffer, 0, read)
                    }
                }
            } catch (_: IOException) {
                // The recogniser closed its end: the session is over. Nothing to report.
            } catch (_: IllegalStateException) {
                // The recorder was released under us by [stop].
            }
        }
    }

    private fun openMicrophone(): AudioRecord? {
        if (!microphoneAllowed()) return null
        val minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (minimum <= 0) return null
        @Suppress("MissingPermission") // Checked just above.
        val recorder = runCatching {
            AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                maxOf(minimum, CHUNK_BYTES * 2),
            )
        }.getOrNull() ?: return null
        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            return null
        }
        return recorder
    }

    private fun intentFor(read: ParcelFileDescriptor) = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, read)
        putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
        putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
        putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, SAMPLE_RATE)
        // One session for as long as the audio flows, cut into segments at each pause.
        putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE)
    }

    private fun listenerFor(id: Int) = object : RecognitionListener {
        private fun current() = running && session == id

        private fun report(results: Bundle?, final: Boolean) {
            if (!current()) return
            val heard = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            if (heard.isNotBlank()) {
                failures = 0
                onHeard(heard, final)
            }
        }

        override fun onPartialResults(partialResults: Bundle?) = report(partialResults, final = false)
        override fun onSegmentResults(segmentResults: Bundle) = report(segmentResults, final = true)
        override fun onResults(results: Bundle?) {
            report(results, final = true)
            restartSoon(id)
        }

        override fun onEndOfSegmentedSession() = restartSoon(id)

        override fun onError(error: Int) {
            if (!current()) return
            when (error) {
                SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
                    tryAnotherLanguage()
                // Silence and nothing made out are a session ending normally.
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> restartSoon(id)
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> fail("The microphone is not allowed.")
                else -> {
                    failures += 1
                    if (failures >= MAX_FAILURES) fail("The on-device recogniser kept failing (last error $error).")
                    else restartSoon(id, RETRY_DELAY_MS * failures)
                }
            }
        }

        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }

    /** A new session on the same quiet stream — no chime, because nothing re-opens the service's microphone. */
    private fun restartSoon(id: Int, delayMs: Long = RESTART_DELAY_MS) {
        if (!running || session != id) return
        main.postDelayed({ if (running && session == id) beginSession() }, delayMs)
    }

    /**
     * The phone has no Indian English model: try plain English, then ask the
     * phone to fetch the Indian one for next time.
     */
    private fun tryAnotherLanguage() {
        if (language == PREFERRED_LANGUAGE) {
            language = FALLBACK_LANGUAGE
            // Posted: this runs inside the recogniser's own callback, and the session replaces it.
            main.post { if (running) beginSession() }
            return
        }
        if (!downloadRequested) {
            downloadRequested = true
            runCatching {
                recognizer?.triggerModelDownload(
                    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, PREFERRED_LANGUAGE),
                )
            }
        }
        fail("No offline speech model for English on this phone yet.")
    }

    private fun fail(reason: String) {
        DebugLog.warn("voice", "Quiet wake listening unavailable: $reason")
        running = false
        session += 1
        endSession()
        onUnavailable(reason)
    }

    private fun microphoneAllowed(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private companion object {
        const val PREFERRED_LANGUAGE = "en-IN"
        const val FALLBACK_LANGUAGE = "en-US"

        /** What on-device recognisers are built for. */
        const val SAMPLE_RATE = 16_000

        /** A tenth of a second of 16-bit mono audio. */
        const val CHUNK_BYTES = SAMPLE_RATE / 10 * 2

        const val RESTART_DELAY_MS = 250L
        const val RETRY_DELAY_MS = 2_000L

        /** Failures in a row, other than silence, before giving up for this run. */
        const val MAX_FAILURES = 5
    }
}
