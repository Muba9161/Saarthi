package com.saarthi.device.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.saarthi.device.SaarthiDeviceApp
import com.saarthi.device.util.DebugLog

/**
 * Bring tracking back after a reboot.
 *
 * A phone fitted permanently in a cab gets rebooted — by a flat battery, by an
 * update, by the driver. A tracker that stays off until somebody notices and
 * opens the app is a tracker with a silent gap in its history, and nobody finds
 * out until they go looking for a journey that is not there.
 *
 * Two conditions, both required. The device must be paired, because an unpaired
 * one has nothing to report to. And the operator must have asked for it: an app
 * that starts itself on every boot without being told to is a battery drain and
 * a surprise.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val repository = SaarthiDeviceApp.repository(context)
        val settings = repository.settings

        if (!repository.isEnrolled) return
        // `wasRunning` as well as `autoStart`: a device deliberately stopped
        // before the reboot should stay stopped.
        if (!settings.autoStart || !settings.wasRunning) return

        DebugLog.add("BOOT — RESUMING TRACKING")
        TelemetryService.start(context)
    }
}
