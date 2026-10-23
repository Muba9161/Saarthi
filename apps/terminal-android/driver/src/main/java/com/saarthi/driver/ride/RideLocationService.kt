package com.saarthi.driver.ride

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.saarthi.core.SaarthiApp
import com.saarthi.core.ui.Language
import com.saarthi.core.util.DebugLog
import com.saarthi.core.util.DeviceEnvironment
import com.saarthi.driver.R
import com.saarthi.driver.SaarthiDriverApp
import com.saarthi.driver.network.DriverApi
import com.saarthi.driver.network.RideSharesApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * A rider's phone, sharing where it is with family while they ride along.
 *
 * Deliberately not `TerminalService`. That service belongs to a phone paired to
 * a vehicle as its terminal — a driver's — and a rider is never that: they are
 * a person sharing their own whereabouts. So this reports to the share, with
 * the share's own key, and nothing else.
 *
 * A foreground service of the `location` type, started only from the Sharing
 * screen while the app is in front, because that is the one moment Android
 * lets it begin — the app holds no background location permission, and should
 * not. The notification is the privacy notice: it says plainly that family can
 * see this phone's position.
 *
 * Fixes are taken every few seconds and sent in batches, which is far cheaper
 * on a mobile connection and stays well inside the server's rate limit.
 */
class RideLocationService : Service() {

    /** Main-thread scope: fixes arrive on the main looper, so the batch needs no lock. */
    private val scope = MainScope()

    private val shares by lazy { RideSharesApi((application as SaarthiDriverApp).driverApi) }
    private val locations by lazy { LocationServices.getFusedLocationProviderClient(this) }

    /** The share being reported for. A start for a different share switches to it. */
    private var shareId: String? = null

    /** The share's own reporting key, so uploads carry on after the sign-in lapses. */
    private var reportingKey: String? = null

    /** Fixes taken and not yet accepted, oldest first, never more than one upload's worth. */
    private val pending = ArrayList<RideSharesApi.Point>()

    private var listening = false
    private var uploading: Job? = null

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            result.locations.mapNotNullTo(pending) { fix ->
                RideSharePolicy.pointOf(
                    latitude = fix.latitude,
                    longitude = fix.longitude,
                    speedMps = if (fix.hasSpeed()) fix.speed else null,
                    bearingDegrees = if (fix.hasBearing()) fix.bearing else null,
                    accuracyMetres = if (fix.hasAccuracy()) fix.accuracy else null,
                    atMillis = fix.time,
                )
            }
            // Out of signal for a while: the newest fixes are the ones worth sending.
            val overflow = pending.size - RideSharePolicy.MAX_POINTS
            if (overflow > 0) pending.subList(0, overflow).clear()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val share = intent?.getStringExtra(EXTRA_SHARE_ID)
        val key = intent?.getStringExtra(EXTRA_KEY)

        /*
         * Refuse to start rather than crash.
         *
         * Android 14 throws from `startForeground` for a location service when
         * the app holds no location permission, and a throw here takes the
         * whole app down. The caller checks first; this covers a permission
         * withdrawn in Settings in between.
         */
        val inFront = share != null && key != null && DeviceEnvironment.hasLocationPermission(this) && runCatching {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            )
        }.onFailure { DebugLog.warn(TAG, "Could not start sharing the ride: ${it.message}") }.isSuccess

        if (share == null || key == null || !inFront) {
            stopSelf()
            return START_NOT_STICKY
        }

        reportingKey = key
        follow(share)
        // Redelivered after the system reclaims the process, so the share comes back with it.
        return START_REDELIVER_INTENT
    }

    /** Report for this share, starting the fixes and the uploads the first time. */
    private fun follow(share: String) {
        if (share == shareId) return
        shareId = share
        pending.clear()
        listen()
        uploading?.cancel()
        uploading = scope.launch {
            while (isActive) {
                delay(UPLOAD_EVERY_MS)
                upload(share)
            }
        }
        DebugLog.info(TAG, "Sharing the phone's position with family")
    }

    @SuppressLint("MissingPermission") // Checked in onStartCommand, and SecurityException is caught.
    private fun listen() {
        if (listening) return
        val fine = DeviceEnvironment.hasPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
        val request = LocationRequest.Builder(
            if (fine) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            SAMPLE_EVERY_MS,
        )
            // Never faster than asked, however eagerly another app is asking.
            .setMinUpdateIntervalMillis(SAMPLE_EVERY_MS)
            .setWaitForAccurateLocation(false)
            .build()
        try {
            locations.requestLocationUpdates(request, callback, Looper.getMainLooper())
            listening = true
        } catch (error: SecurityException) {
            // Revoked between the check and the call — nothing left to share.
            DebugLog.warn(TAG, "Location refused: ${error.message}")
            stopSelf()
        }
    }

    /** Send what has been gathered, and act on the answer. */
    private suspend fun upload(share: String) {
        val key = reportingKey ?: return
        if (pending.isEmpty()) return
        val batch = pending.toList()
        val refusal = try {
            shares.report(share, key, batch)
            null
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: DriverApi.Failure) {
            RideSharePolicy.afterRefusal(statusOf(failure))
        } catch (failure: Exception) {
            // An answer this build cannot read. Sending the same fixes again
            // would only get the same answer.
            DebugLog.warn(TAG, "Unexpected answer to the fixes: ${failure.message}")
            RideSharePolicy.Refusal.DISCARD
        }

        when (refusal) {
            // Fixes taken during the upload stay for the next one.
            null, RideSharePolicy.Refusal.DISCARD -> pending.removeAll(batch.toSet())
            RideSharePolicy.Refusal.RETRY -> Unit
            RideSharePolicy.Refusal.STOP -> {
                DebugLog.info(TAG, "The share is no longer on; stopping")
                stopSelf()
            }
        }
    }

    private fun statusOf(failure: DriverApi.Failure): Int? = when (failure) {
        is DriverApi.Failure.Refused -> failure.status
        is DriverApi.Failure.Offline -> null
        DriverApi.Failure.SignedOut -> 401
    }

    /** "Sharing your ride · Family can follow you live". */
    private fun notification(): Notification {
        val app = SaarthiApp.from(this)
        // The in-app language, not the phone's: see `Language.wrap`.
        val words = Language.wrap(this)
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, app.mainActivity).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, SaarthiApp.SERVICE_CHANNEL_ID)
            .setSmallIcon(app.notificationIcon)
            .setContentTitle(words.getString(R.string.share_notice_title))
            .setContentText(words.getString(R.string.share_notice_text))
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    override fun onDestroy() {
        if (listening) locations.removeLocationUpdates(callback)
        listening = false
        scope.cancel()
        DebugLog.info(TAG, "Stopped sharing the phone's position")
        super.onDestroy()
    }

    companion object {
        private const val TAG = "RideLocationService"

        private const val EXTRA_SHARE_ID = "com.saarthi.driver.ride.SHARE_ID"
        private const val EXTRA_KEY = "com.saarthi.driver.ride.KEY"

        /** Beside the terminal service's 4201, never on top of it. */
        private const val NOTIFICATION_ID = 4202

        /** A fix every five seconds — enough to draw the rider moving on family's map. */
        private const val SAMPLE_EVERY_MS = 5_000L

        /** Three or four fixes a batch, about four requests a minute — the server allows thirty. */
        private const val UPLOAD_EVERY_MS = 15_000L

        /**
         * Start, or move on to, sharing for this share, with its reporting key.
         *
         * Only from the foreground, and only with a location permission — a
         * location service started without one is a crash on Android 14, and a
         * rider who refused location is still sharing, just without a position.
         */
        fun start(context: Context, shareId: String, reportingKey: String) {
            if (!DeviceEnvironment.hasLocationPermission(context)) return
            val intent = Intent(context, RideLocationService::class.java)
                .putExtra(EXTRA_SHARE_ID, shareId)
                .putExtra(EXTRA_KEY, reportingKey)
            runCatching { ContextCompat.startForegroundService(context, intent) }
                .onFailure { DebugLog.warn(TAG, "Could not start sharing the ride: ${it.message}") }
        }

        /** Stop sharing. Harmless when it was not running. */
        fun stop(context: Context) {
            context.stopService(Intent(context, RideLocationService::class.java))
        }
    }
}
