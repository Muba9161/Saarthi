package com.saarthi.owner.ui.common

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.app.ActivityCompat
import com.saarthi.owner.R
import com.saarthi.owner.data.DeviceLocation
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.network.PlacesApi
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.RingSpinner
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import kotlinx.coroutines.launch

/**
 * "Use my current location": the phone's own point, named by the nearest
 * street or landmark, picked like any search result. Location is asked for
 * on the tap, never before.
 */
@Composable
fun CurrentLocationRow(places: PlacesApi, onPick: (PlacesApi.Place) -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var locating by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // Refused twice, Android stops asking: only the app's Settings page can allow it now.
    var blocked by remember { mutableStateOf(false) }

    fun locate() {
        locating = true
        error = null
        scope.launch {
            try {
                val here = DeviceLocation.current(context)
                val place = places.nearest(here.latitude, here.longitude)
                if (place == null) {
                    error = Words.get(R.string.ui_location_error_no_street)
                } else {
                    onPick(place)
                }
            } catch (failure: DeviceLocation.Unavailable) {
                error = failure.message
            } catch (failure: OwnerApi.Failure) {
                // The address lookup, not Saarthi, is what did not answer.
                error = Words.get(R.string.ui_location_error_lookup)
            } catch (failure: SecurityException) {
                // Location was taken away between the check and the fix.
                error = Words.get(R.string.ui_location_error_allow)
            }
            locating = false
        }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { answers ->
        if (answers.values.any { it }) {
            blocked = false
            locate()
            return@rememberLauncherForActivityResult
        }
        val activity = context.activity()
        blocked = activity != null &&
            DeviceLocation.PERMISSIONS.none { ActivityCompat.shouldShowRequestPermissionRationale(activity, it) }
        error = if (blocked) {
            Words.get(R.string.ui_location_error_blocked)
        } else {
            Words.get(R.string.ui_location_error_allow)
        }
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .card(radius = 20.dp)
                .pressable(enabled = !locating, scale = 0.99f, label = stringResource(R.string.ui_location_use_current)) {
                    if (DeviceLocation.allowed(context)) {
                        blocked = false
                        locate()
                    } else {
                        permission.launch(DeviceLocation.PERMISSIONS)
                    }
                }
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            IconWell("${Lucide.crosshair} ${Lucide.crosshairDot}", well = c.primarySoft, ink = c.primary, size = 36.dp, radius = 12.dp, iconSize = 18.dp)
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.ui_location_use_current), style = SType.rowTitle, color = c.fg)
                Text(
                    stringResource(if (locating) R.string.ui_location_finding else R.string.ui_location_fills_in),
                    style = SType.caption,
                    color = c.muted,
                )
            }
            if (locating) RingSpinner(track = c.track, head = c.primary, size = 20.dp, stroke = 2.5.dp)
        }
        error?.let { message ->
            NoticeCard(
                message,
                NoticeTone.WARNING,
                trailing = if (blocked) {
                    { LinkButton(stringResource(R.string.ui_location_settings), onClick = { context.openAppSettings() }, style = SType.smallStrong) }
                } else {
                    null
                },
            )
        }
    }
}

private tailrec fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}

/** This app's page in the phone's Settings, where a blocked permission is allowed again. */
private fun Context.openAppSettings() {
    startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}
