package com.saarthi.terminal

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi
import androidx.compose.material3.windowsizeclass.calculateWindowSizeClass
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.terminal.kiosk.KioskController
import com.saarthi.terminal.service.TerminalService
import com.saarthi.terminal.ui.SaarthiTerminalTheme
import com.saarthi.terminal.ui.TerminalRoot
import com.saarthi.terminal.ui.TerminalViewModel
import com.saarthi.terminal.util.DebugLog
import com.saarthi.terminal.util.DeviceEnvironment

/**
 * The terminal's only activity.
 *
 * Single-activity by design. A terminal is one continuous surface that changes
 * what it shows as the vehicle's state changes; modelling that as a back stack
 * of activities would mean a driver could press Back out of the cockpit into a
 * pairing screen, which is not a thing that should be possible.
 *
 * Three behaviours here exist because of where this screen lives rather than
 * because of Compose:
 *
 *  * **The screen is kept on.** A terminal that sleeps mid-journey is a map the
 *    driver has to wake to read, at exactly the moment they should not be
 *    touching it. Handled with a window flag rather than a wake lock, so the
 *    display dims normally when the app is not in front.
 *
 *  * **Permissions are asked for in one pass, and a refusal is not fatal.** A
 *    terminal without location still shows the vehicle QR and still lets a
 *    driver sign on; it simply cannot report a position, and it says so. An app
 *    that refuses to start without every permission is one an installer works
 *    around by granting them blindly.
 *
 *  * **Kiosk is entered only when this app owns the device.** On an ordinary
 *    tablet the call is a no-op and the app behaves like any other application.
 */
class MainActivity : ComponentActivity() {

    private lateinit var kiosk: KioskController

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        val location = granted[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            granted[Manifest.permission.ACCESS_COARSE_LOCATION] == true

        DebugLog.info(
            "permissions",
            "location=$location camera=${granted[Manifest.permission.CAMERA]} " +
                "mic=${granted[Manifest.permission.RECORD_AUDIO]}",
        )

        // The service is started once location is available, and not before: a
        // location foreground service without the permission is a service that
        // reports nothing behind a notification claiming otherwise.
        if (location) TerminalService.start(this)
    }

    @OptIn(ExperimentalMaterial3WindowSizeClassApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // A terminal is looked at, not interacted with, for most of a journey.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        kiosk = KioskController(this)

        val app = SaarthiTerminalApp.from(this)

        if (app.settings.kioskEnabled && kiosk.isDeviceOwner) {
            kiosk.configure()
            kiosk.enter(this)
        }

        requestPermissions()

        setContent {
            val viewModel: TerminalViewModel = viewModel()
            var reducedMotion by remember { mutableStateOf(app.settings.reducedMotion) }
            // The driver's own choice, not the tablet's. See the note in Theme.kt
            // about why this is no longer read from the system setting.
            var darkTheme by remember { mutableStateOf(app.settings.darkTheme) }
            val windowSize = calculateWindowSizeClass(this)

            SaarthiTerminalTheme(darkTheme = darkTheme, reducedMotion = reducedMotion) {
                TerminalRoot(
                    viewModel = viewModel,
                    windowSize = windowSize,
                    kiosk = kiosk,
                    onReducedMotionChanged = {
                        reducedMotion = it
                        viewModel.setReducedMotion(it)
                    },
                    onDarkThemeChanged = {
                        darkTheme = it
                        app.settings.darkTheme = it
                    },
                    onEnterKiosk = {
                        app.settings.kioskEnabled = true
                        kiosk.configure()
                        kiosk.enter(this)
                    },
                    onExitKiosk = {
                        app.settings.kioskEnabled = false
                        kiosk.exit(this)
                    },
                )
            }
        }
    }

    /**
     * Ask for everything at once, on first launch.
     *
     * One prompt sequence rather than three interruptions spread across the
     * first shift. The person granting them is an installer with the tablet in
     * their hands and a job to finish, not a driver mid-journey being asked why
     * the app wants a microphone.
     *
     * Notifications are included on Android 13+ because the foreground-service
     * notification *is* the privacy notice: an app that cannot post it is an app
     * tracking somebody with no visible indication.
     */
    private fun requestPermissions() {
        val wanted = buildList {
            add(Manifest.permission.ACCESS_FINE_LOCATION)
            add(Manifest.permission.ACCESS_COARSE_LOCATION)
            add(Manifest.permission.CAMERA)
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                add(Manifest.permission.BLUETOOTH_CONNECT)
                add(Manifest.permission.BLUETOOTH_SCAN)
            }
        }

        val missing = wanted.filterNot { DeviceEnvironment.hasPermission(this, it) }

        if (missing.isEmpty()) {
            TerminalService.start(this)
            return
        }
        permissionLauncher.launch(missing.toTypedArray())
    }

    override fun onResume() {
        super.onResume()
        // The state is re-fetched on resume rather than trusted from before the
        // pause. A terminal that was asleep for eight hours may have had its
        // driver revoked, and section 47 is explicit that a restart must not
        // leave a stale authorisation looking active.
        SaarthiTerminalApp.from(this).realtime.start()
    }
}
