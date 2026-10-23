package com.saarthi.driver.ui.start

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.google.android.gms.location.LocationServices

/**
 * The last known position, if the phone has one, and nothing if it does not.
 *
 * Deliberately not a fresh fix. Asking for one costs seconds a driver spends
 * looking at a spinner in a yard, and the request is just as valid without a
 * position — the server treats it as optional.
 */
@SuppressLint("MissingPermission")
internal fun withLastPosition(
    context: Context,
    send: (latitude: Double?, longitude: Double?) -> Unit,
) {
    runCatching {
        LocationServices.getFusedLocationProviderClient(context).lastLocation
            .addOnSuccessListener { location -> send(location?.latitude, location?.longitude) }
            .addOnFailureListener { send(null, null) }
    }.onFailure { send(null, null) }
}

/** Whether a permission is held, and a way to ask for it. */
internal class PermissionAccess(val granted: Boolean, val request: () -> Unit)

/** The camera permission — see [rememberPermissionAccess]. */
@Composable
internal fun rememberCameraAccess(): PermissionAccess = rememberPermissionAccess(Manifest.permission.CAMERA)

/**
 * Location, either precision — the approximate grant is a real answer too, as
 * the terminal service already treats it.
 */
@Composable
internal fun rememberLocationAccess(): PermissionAccess = rememberPermissionAccess(
    Manifest.permission.ACCESS_FINE_LOCATION,
    Manifest.permission.ACCESS_COARSE_LOCATION,
)

/**
 * A permission, re-read whenever the screen resumes; held when any of
 * [permissions] is granted.
 *
 * Re-read rather than decided once, so a driver who grants it in the system
 * dialog — or in Settings, after refusing — finds it working the moment they
 * come back, without having to leave the screen.
 */
@Composable
private fun rememberPermissionAccess(vararg permissions: String): PermissionAccess {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var granted by remember { mutableStateOf(anyGranted(context, permissions)) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        granted = result.values.any { it } || anyGranted(context, permissions)
    }
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) granted = anyGranted(context, permissions)
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    return PermissionAccess(granted) { launcher.launch(arrayOf(*permissions)) }
}

private fun anyGranted(context: Context, permissions: Array<out String>): Boolean =
    permissions.any { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }
