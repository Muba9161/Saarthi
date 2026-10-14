package com.saarthi.owner.ui.assistant

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import java.util.Locale

/**
 * Asking Saarthi out loud: the phone's own speech recogniser hears the
 * question, and its own voice reads the answer back. Nothing is recorded or
 * sent anywhere but the words recognised.
 *
 * [amplitude] is how loud the person is while [listening] — what the blob
 * swells and ripples with.
 */
@Stable
class VoiceInput(private val context: Context) {
    var listening by mutableStateOf(false)
        private set
    var speaking by mutableStateOf(false)
        private set
    var amplitude by mutableFloatStateOf(0f)
        private set

    /** What has been heard so far, as the person speaks. */
    var heard by mutableStateOf("")
        private set

    /** Why the last attempt did not work, in words for the person. */
    var problem by mutableStateOf<String?>(null)
        private set

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingSpeech: String? = null

    /** Whether this phone can recognise speech at all. */
    val available: Boolean get() = SpeechRecognizer.isRecognitionAvailable(context)

    /** Start hearing a question; [onHeard] gets the words once the person stops. */
    fun listen(onHeard: (String) -> Unit) {
        stopSpeaking()
        problem = null
        heard = ""
        val engine = recognizer ?: SpeechRecognizer.createSpeechRecognizer(context).also { recognizer = it }
        engine.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                listening = true
            }

            override fun onBeginningOfSpeech() = Unit

            override fun onRmsChanged(rmsdB: Float) {
                // Roughly -2 dB in a quiet room to 10 dB speaking up; the same scale as Humsafar.
                amplitude = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
            }

            override fun onBufferReceived(buffer: ByteArray?) = Unit

            override fun onEndOfSpeech() {
                amplitude = 0f
            }

            override fun onError(error: Int) {
                val stoppedOnPurpose = !listening || error == SpeechRecognizer.ERROR_CLIENT
                listening = false
                amplitude = 0f
                // Stopping it ourselves ends in an error too; that is not a problem to show.
                if (stoppedOnPurpose) return
                problem = when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "I didn't catch that. Tap the mic and try again."
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Saarthi needs the microphone to hear you. Allow it in the phone's settings."
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Voice needs the internet. Check the connection and try again."
                    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "The phone is still busy with the last one. Try again in a moment."
                    else -> "Voice isn't working right now. You can type the question instead."
                }
            }

            override fun onResults(results: Bundle?) {
                listening = false
                amplitude = 0f
                val words = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                heard = words
                if (words.length >= 2) onHeard(words) else problem = "I didn't catch that. Tap the mic and try again."
            }

            override fun onPartialResults(partialResults: Bundle?) {
                partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let { heard = it }
            }

            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, RECOGNITION_LANGUAGE)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        listening = true
        runCatching { engine.startListening(intent) }.onFailure {
            listening = false
            problem = "Voice isn't working right now. You can type the question instead."
        }
    }

    fun stopListening() {
        if (!listening) return
        listening = false
        amplitude = 0f
        runCatching { recognizer?.cancel() }
    }

    /** Read [text] out in the phone's voice. */
    fun speak(text: String) {
        val words = spokenFrom(text)
        if (words.isBlank()) return
        speaking = true
        val engine = tts
        if (engine != null && ttsReady) {
            engine.speak(words, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE)
            return
        }
        pendingSpeech = words
        if (engine == null) {
            tts = TextToSpeech(context) { status ->
                main.post {
                    val ready = tts
                    if (status != TextToSpeech.SUCCESS || ready == null) {
                        speaking = false
                        pendingSpeech = null
                        return@post
                    }
                    val indian = ready.setLanguage(Locale("en", "IN"))
                    if (indian == TextToSpeech.LANG_MISSING_DATA || indian == TextToSpeech.LANG_NOT_SUPPORTED) ready.setLanguage(Locale.ENGLISH)
                    ready.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(utteranceId: String?) = Unit

                        override fun onDone(utteranceId: String?) {
                            main.post { speaking = false }
                        }

                        @Deprecated("Deprecated in Java")
                        override fun onError(utteranceId: String?) {
                            main.post { speaking = false }
                        }
                    })
                    ttsReady = true
                    pendingSpeech?.let { ready.speak(it, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE) }
                    pendingSpeech = null
                }
            }
        }
    }

    fun stopSpeaking() {
        pendingSpeech = null
        runCatching { tts?.stop() }
        speaking = false
    }

    fun release() {
        runCatching { recognizer?.destroy() }
        recognizer = null
        runCatching { tts?.shutdown() }
        tts = null
        ttsReady = false
    }

    private companion object {
        /** Indian English hears Indian place names and amounts best; Hindi joins with the language work. */
        const val RECOGNITION_LANGUAGE = "en-IN"
        const val UTTERANCE = "saarthi-answer"
        const val MAX_SPOKEN = 700

        /**
         * An answer as it should sound: the Markdown marks dropped, a table's
         * cells read as a list, and long answers cut at a sentence end — the
         * rest stays on screen.
         */
        fun spokenFrom(markdown: String): String {
            val plain = markdown.lines()
                .filterNot { line -> line.trim().let { it.startsWith("|") && it.replace("|", "").all { ch -> ch == '-' || ch == ':' || ch.isWhitespace() } } }
                .joinToString(". ") { line ->
                    line.trim().trimStart('#', '-', '*', '•', ' ').replace("**", "").replace("|", ", ").trim(',', ' ')
                }
                .replace(Regex("\\s+"), " ")
                .replace(Regex("(\\. )+"), ". ")
                .trim()
            if (plain.length <= MAX_SPOKEN) return plain
            val cut = plain.substring(0, MAX_SPOKEN)
            val end = cut.lastIndexOf(". ")
            return if (end > MAX_SPOKEN / 2) cut.substring(0, end + 1) else cut
        }
    }
}

@Composable
fun rememberVoiceInput(): VoiceInput {
    val context = LocalContext.current.applicationContext
    val voice = remember { VoiceInput(context) }
    DisposableEffect(voice) { onDispose { voice.release() } }
    return voice
}
