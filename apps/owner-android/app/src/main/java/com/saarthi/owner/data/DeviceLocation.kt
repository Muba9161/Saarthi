package com.saarthi.owner.data

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.saarthi.owner.R
import com.saarthi.owner.ui.common.Words
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * Where this phone is right now: one fix, asked for only when the person taps
 * "use my current location". Nothing is tracked, kept or sent to Saarthi.
 *
 * The platform's own location service rather than Google Play services, so a
 * single tap does not bring in a library.
 */
object DeviceLocation {

    /** Why there is no fix, in words the person can act on. */
    class Unavailable(message: String) : Exception(message)

    val PERMISSIONS = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

    /** Precise or approximate — either is enough to name the street. */
    fun allowed(context: Context): Boolean = PERMISSIONS.any { granted(context, it) }

    @SuppressLint("MissingPermission") // Only called once [allowed] is true.
    suspend fun current(context: Context): Location {
        val manager = context.getSystemService(LocationManager::class.java)
        if (manager == null || !LocationManagerCompat.isLocationEnabled(manager)) {
            throw Unavailable(Words.get(R.string.net_location_off))
        }
        val provider = provider(context, manager)
            ?: throw Unavailable(Words.get(R.string.net_location_off))

        val fresh = withTimeoutOrNull(FIX_TIMEOUT_MS) {
            suspendCancellableCoroutine { waiting ->
                val signal = CancellationSignal()
                waiting.invokeOnCancellation { signal.cancel() }
                LocationManagerCompat.getCurrentLocation(manager, provider, signal, ContextCompat.getMainExecutor(context)) { fix ->
                    waiting.resume(fix)
                }
            }
        }
        // Indoors a new fix can take too long; a few minutes' old one still names the right street.
        return fresh ?: lastKnown(manager)
            ?: throw Unavailable(Words.get(R.string.net_location_not_found))
    }

    /** The phone's blended source where it has one; otherwise whatever answers fastest. */
    private fun provider(context: Context, manager: LocationManager): String? = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            LocationManagerCompat.hasProvider(manager, LocationManager.FUSED_PROVIDER) -> LocationManager.FUSED_PROVIDER
        manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
        granted(context, Manifest.permission.ACCESS_FINE_LOCATION) &&
            manager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
        else -> null
    }

    @SuppressLint("MissingPermission")
    private fun lastKnown(manager: LocationManager): Location? =
        manager.getProviders(true)
            .mapNotNull { runCatching { manager.getLastKnownLocation(it) }.getOrNull() }
            .filter { SystemClock.elapsedRealtimeNanos() - it.elapsedRealtimeNanos <= STALE_AFTER_NANOS }
            .minByOrNull { it.accuracy }

    private fun granted(context: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private const val FIX_TIMEOUT_MS = 15_000L
    private const val STALE_AFTER_NANOS = 5 * 60 * 1_000_000_000L
}
