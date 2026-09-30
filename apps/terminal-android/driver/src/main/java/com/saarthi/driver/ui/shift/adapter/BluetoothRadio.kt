package com.saarthi.driver.ui.shift.adapter

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.saarthi.core.telemetry.BluetoothObdTelemetryProvider

/** Whether this phone can reach an adapter at all, and a way to ask for what is missing. */
internal class BluetoothRadio(
    val present: Boolean,
    val granted: Boolean,
    val enabled: Boolean,
    /** The driver said no to the permission dialog, or Android no longer shows it. */
    val refused: Boolean,
    val request: () -> Unit,
)

/**
 * The phone's Bluetooth, re-read whenever it can have changed.
 *
 * On resume, for a driver coming back from Settings, and on the radio's own
 * broadcast, for the quick-settings toggle — which changes Bluetooth without
 * the app ever leaving the screen.
 */
@Composable
internal fun rememberBluetoothRadio(obd: BluetoothObdTelemetryProvider): BluetoothRadio {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var granted by remember { mutableStateOf(obd.hasBluetoothPermission()) }
    var enabled by remember { mutableStateOf(context.bluetoothEnabled()) }
    var refused by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        granted = ok
        refused = !ok
    }
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                granted = obd.hasBluetoothPermission()
                enabled = context.bluetoothEnabled()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    DisposableEffect(context) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(receiverContext: Context, intent: Intent) {
                enabled = context.bluetoothEnabled()
            }
        }
        ContextCompat.registerReceiver(
            context,
            receiver,
            IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        onDispose { context.unregisterReceiver(receiver) }
    }
    return BluetoothRadio(
        present = context.bluetoothAdapter() != null,
        granted = granted,
        enabled = enabled,
        refused = refused,
        // Only Android 12 and later ask at run time; below it the grant came with the install.
        request = {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) launcher.launch(Manifest.permission.BLUETOOTH_CONNECT)
        },
    )
}

private fun Context.bluetoothAdapter(): BluetoothAdapter? =
    if (packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH)) {
        (getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
    } else {
        null
    }

/** Reading whether the radio is on needs no permission, so it is honest even before one is granted. */
private fun Context.bluetoothEnabled(): Boolean = bluetoothAdapter()?.isEnabled == true

internal fun Context.openBluetoothSettings() {
    runCatching { startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) }
}

internal fun Context.openAppSettings() {
    runCatching {
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
    }
}
