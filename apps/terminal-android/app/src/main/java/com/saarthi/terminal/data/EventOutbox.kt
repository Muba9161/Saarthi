package com.saarthi.terminal.data

import android.content.Context
import com.saarthi.terminal.network.TelemetryFrame
import com.saarthi.terminal.util.DebugLog
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.io.File

/**
 * Frames the terminal could not deliver yet.
 *
 * A truck spends a meaningful part of every day somewhere with no signal — a
 * basement dock, a tunnel, a hill road, a yard with one bar. Dropping those
 * positions would leave holes in exactly the parts of a journey a fleet most
 * wants to see, so they are held here and replayed when the link comes back.
 *
 * Four properties, each answering a way this goes wrong:
 *
 *  **Bounded.** 5,000 frames, oldest discarded first. An unbounded queue on a
 *  tablet that has been out of coverage for a week is a full disk and a crash,
 *  and the oldest positions are the least useful ones to keep.
 *
 *  **Aged out.** Frames older than 24 hours are dropped rather than uploaded.
 *  The gateway refuses them anyway, and a terminal that spends its first
 *  reconnection uploading yesterday is a terminal not reporting today.
 *
 *  **Idempotent.** Every frame carries an `eventId` generated before it was
 *  buffered, so a batch that is uploaded, times out on the way back and is
 *  retried is stored once. Retrying is normal here, not exceptional.
 *
 *  **Durable.** Written to disk, because the case this exists for is a tablet
 *  that loses power in a yard. An in-memory queue would be exactly the queue
 *  that is empty when it matters.
 *
 * The file is plain JSON rather than a database. It holds positions and
 * simulated engine values, not credentials, and a schema migration on a tablet
 * that has not been updated in a year is a worse risk than the one this saves.
 */
class EventOutbox(context: Context) {

    private val file = File(context.filesDir, FILE_NAME)
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val lock = Any()

    private val _pendingCount = MutableStateFlow(0)

    /** How many frames are waiting. Reported in every heartbeat. */
    val pendingCount: StateFlow<Int> = _pendingCount.asStateFlow()

    private var buffer: MutableList<TelemetryFrame> = mutableListOf()

    init {
        synchronized(lock) {
            buffer = load().toMutableList()
            _pendingCount.value = buffer.size
        }
    }

    private fun load(): List<TelemetryFrame> = runCatching {
        if (!file.exists()) return emptyList()
        json.decodeFromString(ListSerializer(TelemetryFrame.serializer()), file.readText())
    }.getOrElse { error ->
        // A corrupt buffer is discarded rather than crashing the terminal on
        // launch. Losing a few unsent positions is survivable; a tablet that
        // will not start is a truck that cannot leave.
        DebugLog.warn("outbox", "Could not read the outbox, starting empty: ${error.message}")
        runCatching { file.delete() }
        emptyList()
    }

    private fun persist() {
        runCatching {
            file.writeText(json.encodeToString(ListSerializer(TelemetryFrame.serializer()), buffer))
        }.onFailure { error ->
            DebugLog.warn("outbox", "Could not write the outbox: ${error.message}")
        }
    }

    fun add(frame: TelemetryFrame) {
        synchronized(lock) {
            buffer.add(frame)
            if (buffer.size > MAX_EVENTS) {
                // Drop from the front. The oldest positions are the least useful
                // and the most likely to be refused as stale anyway.
                val overflow = buffer.size - MAX_EVENTS
                repeat(overflow) { buffer.removeAt(0) }
                DebugLog.warn("outbox", "Outbox full; discarded $overflow of the oldest frames")
            }
            _pendingCount.value = buffer.size
            persist()
        }
    }

    /**
     * The next batch to try, oldest first, with stale frames already dropped.
     *
     * Peeked rather than removed: a batch is only forgotten once the server has
     * acknowledged it. Removing on read would mean a failed upload silently ate
     * an hour of a journey.
     */
    fun peek(max: Int = MAX_BATCH): List<TelemetryFrame> = synchronized(lock) {
        pruneExpired()
        buffer.take(max)
    }

    /** Forget frames the server accepted. */
    fun acknowledge(frames: List<TelemetryFrame>) {
        if (frames.isEmpty()) return
        synchronized(lock) {
            val delivered = frames.mapTo(HashSet()) { it.eventId }
            buffer.removeAll { it.eventId in delivered }
            _pendingCount.value = buffer.size
            persist()
        }
    }

    private fun pruneExpired() {
        val cutoff = System.currentTimeMillis() - MAX_AGE_MS
        val before = buffer.size
        buffer.removeAll { frame ->
            // `recordedAt` is ISO-8601 from the moment the frame was built.
            // Anything unparseable is treated as current rather than dropped:
            // discarding data because of a formatting bug would be the wrong way
            // round.
            val at = runCatching { java.time.Instant.parse(frame.recordedAt).toEpochMilli() }
                .getOrDefault(Long.MAX_VALUE)
            at < cutoff
        }
        if (buffer.size != before) {
            DebugLog.info("outbox", "Dropped ${before - buffer.size} frames older than 24 h")
            _pendingCount.value = buffer.size
            persist()
        }
    }

    fun clear() {
        synchronized(lock) {
            buffer.clear()
            _pendingCount.value = 0
            runCatching { file.delete() }
        }
    }

    private companion object {
        const val FILE_NAME = "terminal-outbox.json"

        /** Matches `DEVICE_BUFFER.maxEvents` in `packages/shared`. */
        const val MAX_EVENTS = 5_000

        /** Matches `DEVICE_BUFFER.maxBatchSize`; the gateway accepts up to 200. */
        const val MAX_BATCH = 100

        /** Matches `DEVICE_BUFFER.maxAgeHours`. */
        const val MAX_AGE_MS = 24L * 60 * 60 * 1_000
    }
}
