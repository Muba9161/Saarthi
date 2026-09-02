package com.saarthi.terminal.util

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import kotlin.math.hypot
import kotlin.math.roundToInt

/**
 * What this tablet can actually do, right now.
 *
 * Everything here is *measured*, never assumed. The distinction the heartbeat
 * depends on — and that section 29 of the device contract asks for — is between
 * "the hardware is not there", "the user refused the permission" and "it is
 * working", because a dashboard that conflates them sends an engineer out to
 * look at a tablet whose installer simply tapped Deny.
 */
object DeviceEnvironment {

    /** The values the Saarthi heartbeat accepts for a subsystem. */
    object Subsystem {
        const val OK = "OK"
        const val DEGRADED = "DEGRADED"
        const val PERMISSION_DENIED = "PERMISSION_DENIED"
        const val UNAVAILABLE = "UNAVAILABLE"
        const val UNKNOWN = "UNKNOWN"
    }

    object Network {
        const val WIFI = "WIFI"
        const val CELLULAR = "CELLULAR"
        const val ETHERNET = "ETHERNET"
        const val OFFLINE = "OFFLINE"
        const val UNKNOWN = "UNKNOWN"
    }

    fun deviceModel(): String = "${Build.MANUFACTURER} ${Build.MODEL}".trim()

    fun osVersion(): String = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"

    fun hasPermission(context: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    /**
     * Whether this unit has a camera at all.
     *
     * Distinct from holding the permission, and the pairing screen needs both:
     * "no camera fitted" is a fact the installer must work around with a typed
     * code, while "permission not granted" is one tap away from being fixed.
     * Reporting them with the same sentence sent people looking for a hardware
     * fault on a tablet that was only waiting to be asked.
     */
    fun hasCameraHardware(context: Context): Boolean =
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)

    fun hasLocationPermission(context: Context): Boolean =
        hasPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ||
            hasPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)

    /**
     * GPS state, told apart properly.
     *
     * `DEGRADED` when only coarse location was granted: the terminal will still
     * report a position, it will simply be a worse one, and a fleet watching a
     * marker drift across a car park deserves to know that is why.
     */
    fun gpsStatus(context: Context): String {
        val packageManager = context.packageManager
        if (!packageManager.hasSystemFeature(PackageManager.FEATURE_LOCATION)) {
            return Subsystem.UNAVAILABLE
        }
        if (hasPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)) {
            return if (locationServicesEnabled(context)) Subsystem.OK else Subsystem.DEGRADED
        }
        if (hasPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)) {
            return Subsystem.DEGRADED
        }
        return Subsystem.PERMISSION_DENIED
    }

    private fun locationServicesEnabled(context: Context): Boolean = runCatching {
        Settings.Secure.getInt(
            context.contentResolver,
            Settings.Secure.LOCATION_MODE,
        ) != Settings.Secure.LOCATION_MODE_OFF
    }.getOrDefault(true)

    fun cameraStatus(context: Context): String {
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            return Subsystem.UNAVAILABLE
        }
        return if (hasPermission(context, Manifest.permission.CAMERA)) {
            Subsystem.OK
        } else {
            Subsystem.PERMISSION_DENIED
        }
    }

    fun microphoneStatus(context: Context): String =
        if (hasPermission(context, Manifest.permission.RECORD_AUDIO)) {
            Subsystem.OK
        } else {
            Subsystem.PERMISSION_DENIED
        }

    fun networkType(context: Context): String {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE)
            as? ConnectivityManager ?: return Network.UNKNOWN
        val network = manager.activeNetwork ?: return Network.OFFLINE
        val capabilities = manager.getNetworkCapabilities(network) ?: return Network.OFFLINE

        // "Connected to a network" and "that network reaches the internet" are
        // different things, and a truck yard's captive-portal wifi is exactly
        // the case where they differ.
        if (!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
            return Network.OFFLINE
        }

        return when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> Network.WIFI
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> Network.CELLULAR
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> Network.ETHERNET
            else -> Network.UNKNOWN
        }
    }

    fun isOnline(context: Context): Boolean = networkType(context) != Network.OFFLINE

    data class Battery(val percent: Int?, val charging: Boolean?)

    /**
     * Battery, read from the sticky broadcast.
     *
     * A terminal is usually wired to the vehicle's power, so "charging" is the
     * normal state and its *absence* is the signal worth seeing — it means the
     * mount has come loose or the ignition feed has failed, and the tablet is on
     * borrowed time.
     */
    fun battery(context: Context): Battery {
        val intent: Intent? = context.registerReceiver(
            null as BroadcastReceiver?,
            IntentFilter(Intent.ACTION_BATTERY_CHANGED),
        )
        if (intent == null) return Battery(null, null)

        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        val percent = if (level >= 0 && scale > 0) (level * 100f / scale).roundToInt() else null

        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val charging = when (status) {
            BatteryManager.BATTERY_STATUS_CHARGING, BatteryManager.BATTERY_STATUS_FULL -> true
            BatteryManager.BATTERY_STATUS_DISCHARGING,
            BatteryManager.BATTERY_STATUS_NOT_CHARGING,
            -> false
            else -> null
        }

        return Battery(percent, charging)
    }

    /**
     * The display's diagonal in inches.
     *
     * Reported at pairing so a fleet can see what hardware is actually fitted —
     * "the terminal on UP32 AB 1234 is a 6-inch phone" is a useful thing for
     * somebody buying brackets to know.
     */
    fun screenInches(context: Context): Double? = runCatching {
        val metrics = context.resources.displayMetrics
        val widthInches = metrics.widthPixels / metrics.xdpi
        val heightInches = metrics.heightPixels / metrics.ydpi
        val diagonal = hypot(widthInches.toDouble(), heightInches.toDouble())
        (diagonal * 10).roundToInt() / 10.0
    }.getOrNull()
}
