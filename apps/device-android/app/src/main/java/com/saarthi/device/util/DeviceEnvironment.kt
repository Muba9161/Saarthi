package com.saarthi.device.util

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.telephony.SignalStrength
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * What the phone can say about itself.
 *
 * Every reader here answers `UNKNOWN` rather than guessing, and that is the
 * whole design. The dashboard has to be able to tell "the user denied the
 * camera permission" from "this device has no camera" from "we have not asked
 * yet" — conflating them sends an engineer to look at a phone whose owner
 * simply tapped Deny, and there is no way to recover the distinction later if
 * it is thrown away here.
 */
object DeviceEnvironment {

    /** Matches `DeviceSubsystemStatus` in the shared contract. */
    object Status {
        const val OK = "OK"
        const val DEGRADED = "DEGRADED"
        const val PERMISSION_DENIED = "PERMISSION_DENIED"
        const val UNAVAILABLE = "UNAVAILABLE"
        const val UNKNOWN = "UNKNOWN"
    }

    /** Matches `DeviceNetworkType`. */
    object Network {
        const val WIFI = "WIFI"
        const val CELLULAR = "CELLULAR"
        const val ETHERNET = "ETHERNET"
        const val OFFLINE = "OFFLINE"
        const val UNKNOWN = "UNKNOWN"
    }

    data class Battery(val percent: Int?, val charging: Boolean?)

    /**
     * Battery level and charging state.
     *
     * A sticky broadcast, so it costs nothing to read and needs no receiver
     * registered for the life of the app. Returns nulls rather than zero when
     * the platform declines to answer — "0%" would read as a phone about to die.
     */
    fun battery(context: Context): Battery {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            ?: return Battery(null, null)

        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        val percent = if (level >= 0 && scale > 0) (level * 100) / scale else null

        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val charging = when (status) {
            BatteryManager.BATTERY_STATUS_CHARGING, BatteryManager.BATTERY_STATUS_FULL -> true
            BatteryManager.BATTERY_STATUS_DISCHARGING, BatteryManager.BATTERY_STATUS_NOT_CHARGING -> false
            else -> null
        }

        return Battery(percent, charging)
    }

    /**
     * What the phone is connected through.
     *
     * `OFFLINE` is reported only when there is genuinely no validated network,
     * not merely when the last request failed — those are different facts, and a
     * dispatcher seeing "offline" should be able to trust it.
     */
    fun networkType(context: Context): String {
        val manager = context.getSystemService(ConnectivityManager::class.java)
            ?: return Network.UNKNOWN
        val network = manager.activeNetwork ?: return Network.OFFLINE
        val capabilities = manager.getNetworkCapabilities(network) ?: return Network.OFFLINE

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

    /**
     * Cellular signal strength in dBm.
     *
     * Requires the location permission on Android 10 and later, which the app
     * holds anyway when it is tracking. Null when unavailable rather than a
     * sentinel — there is no dBm value that safely means "did not read".
     */
    fun signalStrengthDbm(context: Context): Int? {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return null
        }

        return runCatching {
            val telephony = context.getSystemService(TelephonyManager::class.java) ?: return null
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val strength: SignalStrength = telephony.signalStrength ?: return null
                strength.cellSignalStrengths.firstOrNull()?.dbm
            } else {
                null
            }
        }.getOrNull()?.takeIf { it in -150..0 }
    }

    /**
     * Whether location is actually usable.
     *
     * Two separate failures with the same symptom: the user refused the
     * permission, or they granted it and left GPS switched off. Reported
     * distinctly, because the fix is different in each case.
     */
    fun gpsStatus(context: Context): String {
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

        if (!fine && !coarse) return Status.PERMISSION_DENIED

        val manager = context.getSystemService(LocationManager::class.java)
            ?: return Status.UNAVAILABLE

        val enabled = runCatching {
            manager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        }.getOrDefault(false)

        return when {
            !enabled -> Status.UNAVAILABLE
            // Approximate location only. Perfectly legitimate — Android 12 lets
            // the user choose it — but a fleet watching a map should know the
            // positions are coarse rather than wonder why the truck jumps.
            !fine -> Status.DEGRADED
            else -> Status.OK
        }
    }

    fun cameraStatus(context: Context): String {
        val hasHardware = context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        if (!hasHardware) return Status.UNAVAILABLE

        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        return if (granted) Status.OK else Status.PERMISSION_DENIED
    }
}

/**
 * ISO-8601 in UTC.
 *
 * UTC rather than local time because the backend compares device timestamps
 * against server time to detect a skewed clock, and a phone in IST sending local
 * time would look five and a half hours into the future and have every reading
 * refused.
 */
private val isoFormatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.UK).apply {
    timeZone = TimeZone.getTimeZone("UTC")
}

fun isoNow(): String = isoFormatter.format(Date())

fun isoOf(millis: Long): String = isoFormatter.format(Date(millis))
