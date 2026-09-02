package com.saarthi.terminal.util

import android.util.Log
import com.saarthi.terminal.BuildConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * An on-device log an installer can read.
 *
 * A terminal is fitted in a yard by somebody with a screwdriver and no laptop.
 * When it will not pair, the useful question is "what did it actually try", and
 * `adb logcat` is not available to the person standing there — so the last few
 * hundred lines are kept in memory and shown on the admin screen.
 *
 * In memory only, and bounded. Writing this to disk would mean a support bundle
 * containing whatever happened to be logged, and a ring buffer that grows
 * without a ceiling is a tablet that runs out of memory on a long shift.
 *
 * Nothing here should ever be handed a credential. The API client logs paths
 * and status codes and not bodies, for exactly this reason.
 */
object DebugLog {

    data class Entry(
        val at: Long,
        val level: String,
        val tag: String,
        val message: String,
    ) {
        fun format(): String = "${TIME.format(Date(at))} $level/$tag  $message"
    }

    private const val TAG = "SaarthiTerminal"
    private const val CAPACITY = 400

    private val TIME = SimpleDateFormat("HH:mm:ss", Locale.UK)

    private val buffer = ArrayDeque<Entry>(CAPACITY)
    private val _entries = MutableStateFlow<List<Entry>>(emptyList())

    /** Newest last, so a Compose list can simply scroll to the bottom. */
    val entries: StateFlow<List<Entry>> = _entries.asStateFlow()

    fun info(tag: String, message: String) = record("I", tag, message)
    fun warn(tag: String, message: String) = record("W", tag, message)
    fun error(tag: String, message: String, cause: Throwable? = null) {
        record("E", tag, if (cause == null) message else "$message — ${cause.message}")
    }

    /**
     * Verbose tracing, compiled out of release builds.
     *
     * Not merely filtered at runtime: a release build must not carry the code
     * paths that produce it, or a stray debug line eventually ships with a
     * payload in it.
     */
    fun debug(tag: String, message: String) {
        if (!BuildConfig.DEVELOPER_TOOLS) return
        record("D", tag, message)
    }

    @Synchronized
    private fun record(level: String, tag: String, message: String) {
        val entry = Entry(System.currentTimeMillis(), level, tag, message)
        if (buffer.size >= CAPACITY) buffer.removeFirst()
        buffer.addLast(entry)
        _entries.value = buffer.toList()

        when (level) {
            "E" -> Log.e(TAG, "[$tag] $message")
            "W" -> Log.w(TAG, "[$tag] $message")
            "D" -> Log.d(TAG, "[$tag] $message")
            else -> Log.i(TAG, "[$tag] $message")
        }
    }

    @Synchronized
    fun clear() {
        buffer.clear()
        _entries.value = emptyList()
    }

    /** The whole buffer as text, for a support ticket. */
    @Synchronized
    fun dump(): String = buffer.joinToString("\n") { it.format() }
}
