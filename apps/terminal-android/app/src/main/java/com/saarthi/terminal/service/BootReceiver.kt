package com.saarthi.terminal.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.saarthi.terminal.SaarthiTerminalApp
import com.saarthi.terminal.util.DebugLog
import com.saarthi.terminal.util.DeviceEnvironment

/**
 * Resume after a reboot.
 *
 * A terminal is bolted into a vehicle and shares its ignition. It reboots
 * whenever the truck does, and a tracker that has to be started by hand after
 * every cold start is not a tracker — the gap would be the first ten minutes of
 * every journey, which is the part with the most manoeuvring in it.
 *
 * Two things it deliberately does *not* do.
 *
 * It does not start when the terminal has no credentials or no vehicle. A
 * foreground service whose notification says "not connected to a vehicle" is a
 * permanent notification about nothing, and it would appear on any tablet that
 * happens to have the app installed.
 *
 * It does not resurrect a driver session. The service starts, the terminal
 * fetches its state from the server, and if the driver signed off yesterday it
 * shows the vehicle QR and waits — section 47 is explicit that an app restart
 * must not leave an expired or revoked driver looking active.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_LOCKED_BOOT_COMPLETED
        ) {
            return
        }

        val app = SaarthiTerminalApp.from(context)

        if (!app.identity.hasCredentials || app.identity.pairedVehicleId == null) {
            DebugLog.info("boot", "Not paired to a vehicle; leaving the service stopped")
            return
        }

        if (!DeviceEnvironment.hasLocationPermission(context)) {
            // Starting a location foreground service without the permission is a
            // service that runs and reports nothing, and a notification that
            // claims otherwise. The driver is prompted when they next open the
            // app, which is the only place a prompt can actually be answered.
            DebugLog.warn("boot", "Location permission missing; not starting after boot")
            return
        }

        DebugLog.info("boot", "Resuming after boot for ${app.identity.pairedRegistration}")
        TerminalService.start(context)
    }
}
