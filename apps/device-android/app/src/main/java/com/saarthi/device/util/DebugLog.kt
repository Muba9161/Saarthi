package com.saarthi.device.util

import com.saarthi.device.BuildConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The in-app debug console.
 *
 * Section 31 asks for a running log a developer can watch while a phone is
 * bolted to a windscreen, and is equally clear about what must never appear in
 * it: tokens, secrets, keys, personal data. Both halves are enforced here
 * rather than left to whoever writes the next `add()` call.
 *
 * **Absent from release builds.** Not hidden behind a setting — a setting can be
 * switched on. `BuildConfig.DEBUG_CONSOLE` is false in release, `add()` returns
 * immediately, and nothing is ever held.
 *
 * **Redacted on the way in.** Anything that looks like a credential is
 * scrubbed before it is stored, so a careless caller cannot leak one. The
 * patterns are deliberately broad: a false positive costs a line of log, a
 * false negative costs a device secret on somebody's screen in a workshop.
 *
 * **Bounded.** A device left running for a week must not accumulate a log until
 * the app is killed for memory. The oldest lines go.
 */
object DebugLog {

    private const val MAX_LINES = 300

    private val formatter = SimpleDateFormat("HH:mm:ss", Locale.UK)

    private val _lines = MutableStateFlow<List<String>>(emptyList())
    val lines: StateFlow<List<String>> = _lines.asStateFlow()

    val enabled: Boolean get() = BuildConfig.DEBUG_CONSOLE

    /**
     * Patterns that must never reach the screen.
     *
     * A JWT is matched structurally rather than by field name, because the
     * thing that leaks one is usually a message that pasted a whole response
     * body without meaning to.
     */
    private val redactions = listOf(
        Regex("""eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}""") to "«token»",
        Regex("""(?i)"?(secret|password|token|accessToken|authorization|apiKey)"?\s*[:=]\s*"?[^",\s}]+""") to "$1=«redacted»",
        Regex("""(?i)bearer\s+[A-Za-z0-9._-]+""") to "Bearer «redacted»",
    )

    fun add(message: String) {
        if (!enabled) return

        var safe = message
        for ((pattern, replacement) in redactions) {
            safe = pattern.replace(safe, replacement)
        }

        val line = "${formatter.format(Date())}  $safe"
        _lines.value = (_lines.value + line).takeLast(MAX_LINES)
    }

    fun clear() {
        _lines.value = emptyList()
    }
}
