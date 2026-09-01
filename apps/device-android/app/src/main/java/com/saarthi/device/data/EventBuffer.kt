package com.saarthi.device.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * The offline buffer.
 *
 * When the phone loses signal — a ghat section, a basement dock, a village with
 * one bar — positions keep being produced and have to go somewhere. This is
 * that somewhere, and section 18 of the specification is mostly a list of the
 * ways a naive implementation of it goes wrong.
 *
 * ## Why SQLite directly
 *
 * No Room, no ORM. The whole store is one table with four columns and three
 * queries, and doing it by hand means no annotation processing in the build, no
 * generated code to keep in step, and a schema a reader can hold in their head.
 * The value an ORM adds here is smaller than the build complexity it costs.
 *
 * ## The rules
 *
 * * **Bounded.** A phone out of coverage for a week must not fill its own
 *   storage. When the queue is full the *oldest* rows go, because the newest
 *   positions are the ones anybody still cares about.
 * * **Aged out.** Events older than the backend's acceptance window are dropped
 *   locally rather than uploaded and rejected — a round trip that costs a
 *   driver's data to be told what we already knew.
 * * **Idempotent.** Every row carries an event id generated when it was
 *   queued, so an upload that succeeds but whose response is lost can be
 *   retried without writing the position twice.
 * * **Deleted only on acknowledgement.** Rows are read, uploaded, and removed
 *   afterwards — never removed optimistically. A crash between the two costs a
 *   duplicate upload, which the event id makes harmless; the other order costs
 *   the data.
 */
class EventBuffer(context: Context) {

    private val helper = object : SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE $TABLE (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT NOT NULL UNIQUE,
                    kind TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    recorded_at INTEGER NOT NULL
                )
                """.trimIndent(),
            )
            db.execSQL("CREATE INDEX idx_${TABLE}_recorded ON $TABLE (recorded_at)")
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            // The buffer holds nothing that is not also either already uploaded
            // or a few minutes old. Dropping it on a schema change is cheaper
            // and safer than migrating a queue.
            db.execSQL("DROP TABLE IF EXISTS $TABLE")
            onCreate(db)
        }
    }

    enum class Kind { LOCATION, FRAME }

    data class Buffered(
        val rowId: Long,
        val eventId: String,
        val kind: Kind,
        val payload: String,
        val recordedAt: Long,
    )

    /**
     * Queue an event.
     *
     * Returns false when the event id was already present, which happens if the
     * caller retries a queue operation. Silently ignoring the duplicate is
     * correct: the event is already safe.
     */
    fun enqueue(eventId: String, kind: Kind, payload: String, recordedAt: Long): Boolean {
        val db = helper.writableDatabase
        val values = ContentValues().apply {
            put("event_id", eventId)
            put("kind", kind.name)
            put("payload", payload)
            put("recorded_at", recordedAt)
        }
        val inserted = db.insertWithOnConflict(TABLE, null, values, SQLiteDatabase.CONFLICT_IGNORE)
        if (inserted != -1L) trim(db)
        return inserted != -1L
    }

    /**
     * Read a batch, oldest first.
     *
     * Oldest first so a replayed buffer arrives in the order it was recorded,
     * which is what lets the backend derive distance and harsh-event detection
     * correctly rather than seeing a vehicle teleport backwards.
     */
    fun peek(limit: Int, kind: Kind): List<Buffered> {
        val db = helper.readableDatabase
        val rows = mutableListOf<Buffered>()
        db.query(
            TABLE,
            arrayOf("id", "event_id", "kind", "payload", "recorded_at"),
            "kind = ?",
            arrayOf(kind.name),
            null,
            null,
            "recorded_at ASC",
            limit.toString(),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                rows += Buffered(
                    rowId = cursor.getLong(0),
                    eventId = cursor.getString(1),
                    kind = Kind.valueOf(cursor.getString(2)),
                    payload = cursor.getString(3),
                    recordedAt = cursor.getLong(4),
                )
            }
        }
        return rows
    }

    /** Remove rows Saarthi has confirmed it holds. */
    fun acknowledge(rowIds: List<Long>) {
        if (rowIds.isEmpty()) return
        val db = helper.writableDatabase
        val placeholders = rowIds.joinToString(",") { "?" }
        db.delete(TABLE, "id IN ($placeholders)", rowIds.map { it.toString() }.toTypedArray())
    }

    fun count(): Int {
        val db = helper.readableDatabase
        db.rawQuery("SELECT COUNT(*) FROM $TABLE", null).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
    }

    /**
     * Drop events too old for the backend to accept.
     *
     * The gateway refuses anything older than its maximum age, so uploading
     * these would cost a driver's data to be told what we could have worked out
     * locally. Called before a flush rather than on a timer, so a phone that is
     * doing nothing is not woken to tidy up.
     */
    fun dropExpired(maxAgeMillis: Long): Int {
        val db = helper.writableDatabase
        val cutoff = System.currentTimeMillis() - maxAgeMillis
        return db.delete(TABLE, "recorded_at < ?", arrayOf(cutoff.toString()))
    }

    fun clear() {
        helper.writableDatabase.delete(TABLE, null, null)
    }

    /**
     * Enforce the ceiling.
     *
     * Deletes from the front. A week of stale positions is worth less than the
     * last hour of them, and a full disk is worth less than either.
     */
    private fun trim(db: SQLiteDatabase) {
        val total = db.rawQuery("SELECT COUNT(*) FROM $TABLE", null).use { cursor ->
            if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
        if (total <= MAX_EVENTS) return

        val excess = total - MAX_EVENTS
        db.execSQL(
            "DELETE FROM $TABLE WHERE id IN (SELECT id FROM $TABLE ORDER BY recorded_at ASC LIMIT ?)",
            arrayOf<Any>(excess),
        )
    }

    companion object {
        private const val DB_NAME = "saarthi_device_buffer.db"
        private const val DB_VERSION = 1
        private const val TABLE = "buffered_events"

        /** Matches `DEVICE_BUFFER.maxEvents` in the shared contract. */
        const val MAX_EVENTS = 5_000

        /** Matches `DEVICE_BUFFER.maxBatchSize`. */
        const val MAX_BATCH = 100

        /** Matches `DEVICE_BUFFER.maxAgeHours`, in milliseconds. */
        const val MAX_AGE_MILLIS = 24L * 60 * 60 * 1000
    }
}
