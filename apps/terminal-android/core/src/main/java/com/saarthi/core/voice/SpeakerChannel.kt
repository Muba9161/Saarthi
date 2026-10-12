package com.saarthi.core.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import com.saarthi.core.util.DebugLog

/**
 * The phone's speaker, as Saarthi's voice uses it: asking for it politely,
 * giving it back, and knowing when it has been turned down to nothing.
 */
internal class SpeakerChannel(private val context: Context) {

    /** Held between asking for the speaker and giving it back. */
    private var focusRequest: AudioFocusRequest? = null

    /**
     * True when the media volume — the channel Saarthi's voice plays on — is at
     * zero on the speaker in use.
     *
     * The most common reason "Saarthi does not talk" on a phone: the answer is
     * spoken, and the phone plays it silently. Worth saying on screen, because
     * nothing else tells a driver why.
     */
    val muted: Boolean
        get() = audio()?.getStreamVolume(AudioManager.STREAM_MUSIC) == 0

    /**
     * Bring the media volume up to a level that can be heard in a cab.
     *
     * Only ever on the driver's tap. The phone's volume is the driver's choice,
     * and Saarthi raising it on its own would be overriding it.
     */
    fun raise() {
        val audio = audio() ?: return
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val audible = (max * AUDIBLE_SHARE).toInt().coerceAtLeast(1)
        if (audio.getStreamVolume(AudioManager.STREAM_MUSIC) >= audible) return
        runCatching {
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, audible, AudioManager.FLAG_SHOW_UI)
        }.onFailure { error -> DebugLog.warn("voice", "Could not raise the volume: ${error.message}") }
    }

    /** "media volume 9 of 15", for the diagnostics screen. */
    fun describeLevel(): String {
        val audio = audio()
        val volume = audio?.getStreamVolume(AudioManager.STREAM_MUSIC) ?: -1
        val max = audio?.getStreamMaxVolume(AudioManager.STREAM_MUSIC) ?: -1
        val level = if (volume < 0) "volume unknown" else "media volume $volume of $max"
        val silent = if (volume == 0) " - the device is muted" else ""
        return "$level$silent"
    }

    /**
     * Ask the system for the speaker, politely.
     *
     * `TRANSIENT_MAY_DUCK` is the request a navigator makes: whatever is playing
     * turns down for the instruction and comes back up afterwards, rather than
     * stopping. A truck cab usually has something playing, and guidance that
     * arrives at the same volume as the music is guidance nobody can make out.
     */
    fun claim() {
        val audio = audio() ?: return

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

    /** Give the speaker back, so whatever was ducked comes back up. */
    fun release() {
        val audio = audio() ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { runCatching { audio.abandonAudioFocusRequest(it) } }
        } else {
            @Suppress("DEPRECATION")
            runCatching { audio.abandonAudioFocus(null) }
        }
    }

    private fun audio(): AudioManager? = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

    private companion object {
        /** What [raise] turns a silent phone up to: well short of loud, plainly audible. */
        const val AUDIBLE_SHARE = 0.6
    }
}
