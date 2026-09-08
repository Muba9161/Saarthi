package com.saarthi.driver

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi
import androidx.compose.material3.windowsizeclass.calculateWindowSizeClass
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.core.service.TerminalService
import com.saarthi.core.ui.SaarthiTerminalTheme
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.core.util.DebugLog
import com.saarthi.driver.ui.DriverRoot
import com.saarthi.driver.ui.DriverViewModel

/**
 * The driver app's only activity.
 *
 * Single-activity for the same reason the terminal is: this is one continuous
 * surface that changes as the shift does, and a back stack would let a driver
 * press Back out of an approved session into the scanner — which would mean
 * nothing to the fleet that approved them.
 *
 * Two differences from the tablet, both because this is somebody's own phone.
 * There is no kiosk: an app a driver installed must never be able to take over
 * their handset. And the screen is only kept awake once they are actually signed
 * on to a vehicle, because holding a personal phone awake on a sign-in screen is
 * just draining someone's battery.
 *
 * A `FragmentActivity` rather than a `ComponentActivity`, for one reason:
 * `BiometricPrompt` is implemented as a fragment so its dialog survives
 * rotation and process death mid-authentication, and it needs a host with a
 * fragment manager. Nothing here uses fragments directly, and the terminal app
 * is untouched.
 */
class DriverActivity : FragmentActivity() {

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        val location = granted[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            granted[Manifest.permission.ACCESS_COARSE_LOCATION] == true

        DebugLog.info(
            "permissions",
            "location=$location camera=${granted[Manifest.permission.CAMERA]}",
        )

        // Started only once location is available. A location foreground service
        // without the permission is a service reporting nothing behind a
        // notification that claims otherwise.
        if (location) TerminalService.start(this)
    }

    @OptIn(ExperimentalMaterial3WindowSizeClassApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Held on while driving, because a map a driver has to wake to read is a
        // map they read at the worst possible moment. Released by the system as
        // soon as the app is not in front.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val app = application as SaarthiDriverApp
        requestPermissions()

        setContent {
            val driver: DriverViewModel = viewModel()
            val cockpit: TerminalViewModel = viewModel()
            var reducedMotion by remember { mutableStateOf(app.settings.reducedMotion) }
            var darkTheme by remember { mutableStateOf(app.settings.darkTheme) }
            val windowSize = calculateWindowSizeClass(this)

            SaarthiTerminalTheme(darkTheme = darkTheme, reducedMotion = reducedMotion) {
                DriverRoot(
                    driver = driver,
                    cockpit = cockpit,
                    windowSize = windowSize,
                    onDarkThemeChanged = {
                        darkTheme = it
                        app.settings.darkTheme = it
                    },
                )
            }
        }
    }

    /**
     * Ask for everything at once, on first launch.
     *
     * One sequence rather than three interruptions spread across the first
     * shift. Notifications are included from Android 13 because the reporting
     * notice is the app's privacy disclosure, and a driver who never sees it has
     * not been told what their phone is doing.
     */
    private fun requestPermissions() {
        val wanted = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.CAMERA,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            wanted += Manifest.permission.POST_NOTIFICATIONS
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            wanted += Manifest.permission.BLUETOOTH_CONNECT
            wanted += Manifest.permission.BLUETOOTH_SCAN
        }
        permissionLauncher.launch(wanted.toTypedArray())
    }
}
