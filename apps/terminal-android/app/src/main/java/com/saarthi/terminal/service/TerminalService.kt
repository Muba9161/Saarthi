package com.saarthi.terminal.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.saarthi.terminal.MainActivity
import com.saarthi.terminal.R
import com.saarthi.terminal.SaarthiTerminalApp
import com.saarthi.terminal.util.DebugLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The terminal's heartbeat, in the literal sense.
 *
 * A foreground service, because a terminal has to keep reporting while the
 * driver is looking at a map, at nothing, or at another app entirely — and
 * because Android will otherwise stop a backgrounded app from touching location
 * within minutes. There is no way to build a vehicle tracker without one.
 *
 * The permanent notification is not a technicality to be minimised. It is the
 * privacy notice: the one surface a person in the cab reliably sees, saying
 * plainly that this tablet is reporting position for a named vehicle, for as
 * long as it is doing so. It names the vehicle deliberately — a terminal that
 * has been moved between trucks and not re-paired is a real failure, and this is
 * where it becomes visible to somebody who can act on it.
 *
 * Three loops run here, at three cadences, because they answer three different
 * questions:
 *
 *   * **Telemetry** at the server-configured interval — where is the vehicle.
 *   * **Heartbeat** every 30 s — is the terminal alive, and how is it doing.
 *     Separate from telemetry because a parked truck is silent and perfectly
 *     healthy, and conflating the two would report every stationary vehicle as
 *     a fault.
 *   * **Upload** whenever there is something buffered — which is a different
 *     schedule from producing, because the whole point of the buffer is that
 *     they come apart in a tunnel.
 */
class TerminalService : Service() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var loops: MutableList<Job> = mutableListOf()

    private val app: SaarthiTerminalApp by lazy { SaarthiTerminalApp.from(this) }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(NOTIFICATION_ID, buildNotification())

        if (loops.isEmpty()) startLoops()

        // START_STICKY: a terminal killed for memory must come back on its own.
        // A tablet that stopped reporting overnight because Android reclaimed it
        // is a journey nobody can account for afterwards.
        return START_STICKY
    }

    private fun startLoops() {
        val repository = app.repository

        // --- Bring-up -------------------------------------------------------
        loops += serviceScope.launch {
            repository.ensureEnrolled()
            repository.refresh()
            app.telemetry.start()
            app.realtime.start()
        }

        // --- Produce --------------------------------------------------------
        loops += serviceScope.launch {
            while (isActive) {
                val snapshot = app.telemetry.snapshot.value
                if (snapshot.hasPosition) repository.enqueueFrame(snapshot)
                updateNotification()
                delay(app.telemetry.intervalMs)
            }
        }

        // --- Upload ---------------------------------------------------------
        //
        // Deliberately slower than production. Batching several frames into one
        // request is dramatically cheaper on a mobile connection than one
        // request per fix, and the frames are safe on disk in the meantime.
        loops += serviceScope.launch {
            while (isActive) {
                delay(UPLOAD_INTERVAL_MS)
                if (app.outbox.pendingCount.value > 0) {
                    repository.flushOutbox()
                }
            }
        }

        // --- Heartbeat ------------------------------------------------------
        loops += serviceScope.launch {
            while (isActive) {
                repository.sendHeartbeat()
                app.realtime.ping()
                delay(HEARTBEAT_INTERVAL_MS)
            }
        }

        // --- State ----------------------------------------------------------
        //
        // A slow poll behind the socket. The socket is what makes an approval
        // arrive in a second; this is what makes it arrive at all when the
        // socket is down, which on a mobile network is often.
        loops += serviceScope.launch {
            while (isActive) {
                delay(STATE_POLL_INTERVAL_MS)
                repository.refresh()
            }
        }

        DebugLog.info("service", "Terminal service loops started")
    }

    override fun onDestroy() {
        loops.forEach { it.cancel() }
        loops.clear()
        serviceScope.launch { app.telemetry.stop() }
        app.realtime.stop()
        serviceScope.cancel()
        DebugLog.info("service", "Terminal service stopped")
        super.onDestroy()
    }

    // -----------------------------------------------------------------------
    // Notification
    // -----------------------------------------------------------------------

    private fun buildNotification(): Notification {
        val registration = app.identity.pairedRegistration

        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE,
        )

        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, TerminalService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, SaarthiTerminalApp.SERVICE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(getString(R.string.service_title))
            .setContentText(
                if (registration != null) {
                    getString(R.string.service_text_paired, registration)
                } else {
                    getString(R.string.service_text_unpaired)
                },
            )
            .setContentIntent(open)
            // Offered even in kiosk deployments. A person must always be able to
            // stop a device from reporting their location, and hiding the control
            // because a fleet would rather they could not is not a decision this
            // app makes.
            .addAction(0, getString(R.string.service_action_stop), stop)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotification() {
        runCatching {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE)
                as android.app.NotificationManager
            manager.notify(NOTIFICATION_ID, buildNotification())
        }
    }

    companion object {
        const val ACTION_STOP = "com.saarthi.terminal.STOP"
        private const val NOTIFICATION_ID = 4201

        /** Matches `DEVICE_HEARTBEAT_INTERVAL_SECONDS` in `packages/shared`. */
        private const val HEARTBEAT_INTERVAL_MS = 30_000L
        private const val UPLOAD_INTERVAL_MS = 20_000L
        private const val STATE_POLL_INTERVAL_MS = 30_000L

        fun start(context: Context) {
            val intent = Intent(context, TerminalService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, TerminalService::class.java))
        }
    }
}
