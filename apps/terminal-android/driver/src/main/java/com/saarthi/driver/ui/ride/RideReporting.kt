package com.saarthi.driver.ui.ride

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.saarthi.driver.ride.RideLocationService
import com.saarthi.driver.ui.DriverViewModel.Stage
import com.saarthi.driver.ui.start.rememberLocationAccess

/**
 * The rider's phone shares its position while — and only while — their ride is
 * shared with family.
 *
 * Started from here, with the app in front, because that is the only time
 * Android lets a location service begin: the app has no background location
 * permission and does not want one. Started again each time the rider comes
 * back to the app, which is harmless when it is already running and revives it
 * if the system stopped it; and started the moment a refused location
 * permission is granted.
 *
 * Stopped once the app has settled anywhere that is not a share — sharing
 * stopped, ran out of time, signed out. Not while it is still finding out
 * (launching, or behind Quick Login), which would interrupt a share for the
 * length of a splash screen. The service also stops itself when the server
 * says the share is over.
 */
@Composable
internal fun RideReporting(stage: Stage) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val location = rememberLocationAccess()

    // Only the id and the key — a poll that refreshes the share restarts nothing.
    val share = (stage as? Stage.Sharing)?.share
    val shareId = share?.id
    val key = share?.reportingToken
    val settledElsewhere = shareId == null && stage !is Stage.Restoring && stage !is Stage.Locked

    LaunchedEffect(shareId, key, location.granted, settledElsewhere) {
        when {
            shareId != null && key != null && location.granted ->
                lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                    RideLocationService.start(context, shareId, key)
                }

            settledElsewhere -> RideLocationService.stop(context)
        }
    }
}
