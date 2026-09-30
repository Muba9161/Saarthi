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

/** Whether the camera may be used, and a way to ask. */
internal class CameraAccess(val granted: Boolean, val request: () -> Unit)

/**
 * The camera permission, re-read whenever the screen resumes.
 *
 * Re-read rather than decided once, so a driver who grants it in the system
 * dialog — or in Settings, after refusing — finds the camera working the
 * moment they come back, without having to leave the screen.
 */
@Composable
internal fun rememberCameraAccess(): CameraAccess {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var granted by remember { mutableStateOf(cameraGranted(context)) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        granted = it
    }
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) granted = cameraGranted(context)
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    return CameraAccess(granted) { launcher.launch(Manifest.permission.CAMERA) }
}

private fun cameraGranted(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
        PackageManager.PERMISSION_GRANTED
