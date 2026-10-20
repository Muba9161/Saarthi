package com.saarthi.owner.drive

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.saarthi.owner.OwnerActivity
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.DeviceLocation
import com.saarthi.owner.network.DrivingApi
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.ui.common.Words
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * The phone reporting where the vehicle is while its owner drives a trip — the
 * only part of this app that works with the screen off, and only then.
 *
 * Started from the Drive screen, so the location asked for is "while using the
 * app" and never "all the time"; the "Driving" notification is what keeps it
 * allowed, and says plainly that it is running, with a way to stop it. It
 * stops by itself once none of the driver's trips is under way.
 *
 * Fixes go to the same `/tracking/locations` every tracker and the cab app
 * feed, marked as a real device's, so the trip's road, its colours, the
 * arrival at a stop and the odometer all come out as they do for any driver.
 * The platform's own location service, as for the one-tap "use my location":
 * no Google Play services library for one feature.
 */
class DrivingService : Service(), LocationListener {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val held = ArrayDeque<DrivingApi.Fix>()
    private var vehicleId: String? = null
    private var listening = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            // The driver's own choice: the Drive screen offers to resume rather than starting it again.
            _pausedByDriver.value = true
            stopSelf()
            return START_NOT_STICKY
        }
        val vehicle = intent?.getStringExtra(EXTRA_VEHICLE)
        val driver = intent?.getStringExtra(EXTRA_DRIVER)
        val plate = intent?.getStringExtra(EXTRA_PLATE).orEmpty()
        if (vehicle == null || driver == null || !DeviceLocation.allowed(this)) {
            stopSelf()
            return START_NOT_STICKY
        }

        ensureChannel(this)
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            notification(plate),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0,
        )
        if (vehicleId != vehicle) {
            vehicleId = vehicle
            listen()
            follow(driver)
        }
        _running.value = true
        // Rebuilt after the system stops it, with the vehicle and driver it was started for.
        return START_REDELIVER_INTENT
    }

    @SuppressLint("MissingPermission") // Checked in onStartCommand before it gets here.
    private fun listen() {
        if (listening) return
        val manager = getSystemService(LocationManager::class.java) ?: return
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }
        providers.forEach { provider -> manager.requestLocationUpdates(provider, FIX_MS, 0f, this, Looper.getMainLooper()) }
        listening = providers.isNotEmpty()
    }

    /** Send what is held every little while; stop once no trip of this driver's is under way. */
    private fun follow(driverId: String) {
        val api = (application as OwnerApp).driving
        scope.launch {
            var sinceCheck = 0L
            while (isActive) {
                delay(UPLOAD_MS)
                flush(api)
                sinceCheck += UPLOAD_MS
                if (sinceCheck >= CHECK_MS) {
                    sinceCheck = 0
                    val driving = try {
                        api.myTrips(driverId).any { it.actualStartAt != null && !it.closed }
                    } catch (signedOut: OwnerApi.Failure.SignedOut) {
                        false
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        // Out of signal: keep recording, and ask again next time.
                        true
                    }
                    if (!driving) {
                        flush(api)
                        stopSelf()
                    }
                }
            }
        }
    }

    private suspend fun flush(api: DrivingApi) {
        val batch = synchronized(held) { held.take(MAX_BATCH).also { repeat(it.size) { held.removeFirst() } } }
        if (batch.isEmpty()) return
        try {
            api.report(batch)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // Kept for the next try, oldest first; past the cap the oldest go, as the road already drawn has them.
            synchronized(held) {
                batch.asReversed().forEach { held.addFirst(it) }
                while (held.size > MAX_HELD) held.removeFirst()
            }
        }
    }

    override fun onLocationChanged(location: Location) {
        val vehicle = vehicleId ?: return
        val fix = DrivingApi.Fix(
            truckId = vehicle,
            latitude = location.latitude,
            longitude = location.longitude,
            speedKph = if (location.hasSpeed()) (location.speed * MS_TO_KPH).toDouble().coerceIn(0.0, MAX_KPH) else 0.0,
            heading = if (location.hasBearing()) location.bearing.toDouble().coerceIn(0.0, 360.0) else 0.0,
            accuracy = if (location.hasAccuracy()) location.accuracy.toDouble().coerceAtMost(MAX_ACCURACY) else null,
            altitude = if (location.hasAltitude()) location.altitude.coerceIn(MIN_ALTITUDE, MAX_ALTITUDE) else null,
            timestamp = Instant.ofEpochMilli(location.time).toString(),
        )
        synchronized(held) {
            held.addLast(fix)
            while (held.size > MAX_HELD) held.removeFirst()
        }
    }

    // Older platforms call these; nothing to do when a provider comes or goes.
    @Deprecated("Deprecated in the platform")
    override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) = Unit
    override fun onProviderEnabled(provider: String) = Unit
    override fun onProviderDisabled(provider: String) = Unit

    override fun onDestroy() {
        getSystemService(LocationManager::class.java)?.removeUpdates(this)
        listening = false
        // A last send of what is held, without keeping the service alive for it.
        val api = (application as OwnerApp).driving
        CoroutineScope(Dispatchers.IO).launch { runCatching { flush(api) } }
        scope.cancel()
        _running.value = false
        super.onDestroy()
    }

    private fun notification(plate: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, OwnerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 1,
            Intent(this, DrivingService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle(if (plate.isBlank()) Words.get(R.string.net_driving_title) else Words.get(R.string.net_driving_title_plate, plate))
            .setContentText(Words.get(R.string.net_driving_text))
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(open)
            .addAction(0, Words.get(R.string.net_driving_stop), stop)
            .build()
    }

    companion object {
        const val CHANNEL = "driving"
        private const val NOTIFICATION_ID = 4301
        private const val ACTION_STOP = "com.saarthi.owner.drive.STOP"
        private const val EXTRA_VEHICLE = "vehicle"
        private const val EXTRA_DRIVER = "driver"
        private const val EXTRA_PLATE = "plate"

        /** A fix every five seconds while driving, as Humsafar's default. */
        private const val FIX_MS = 5_000L
        private const val UPLOAD_MS = 20_000L
        private const val CHECK_MS = 60_000L
        private const val MAX_BATCH = 200
        /** About three hours of fixes held through a long stretch without signal. */
        private const val MAX_HELD = 2_000
        private const val MS_TO_KPH = 3.6f
        private const val MAX_KPH = 200.0
        private const val MAX_ACCURACY = 10_000.0
        private const val MIN_ALTITUDE = -500.0
        private const val MAX_ALTITUDE = 10_000.0

        private val _running = MutableStateFlow(false)

        /** Whether this phone is recording a trip right now. */
        val running: StateFlow<Boolean> = _running.asStateFlow()

        private val _pausedByDriver = MutableStateFlow(false)

        /** Stopped from the notification by the driver, until they start it again. */
        val pausedByDriver: StateFlow<Boolean> = _pausedByDriver.asStateFlow()

        fun start(context: Context, vehicleId: String, driverId: String, plate: String) {
            _pausedByDriver.value = false
            val intent = Intent(context, DrivingService::class.java)
                .putExtra(EXTRA_VEHICLE, vehicleId)
                .putExtra(EXTRA_DRIVER, driverId)
                .putExtra(EXTRA_PLATE, plate)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, DrivingService::class.java))
        }

        private fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            if (manager.getNotificationChannel(CHANNEL) != null) return
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, Words.get(R.string.net_driving_channel), NotificationManager.IMPORTANCE_LOW).apply {
                    description = Words.get(R.string.net_driving_channel_about)
                },
            )
        }
    }
}
