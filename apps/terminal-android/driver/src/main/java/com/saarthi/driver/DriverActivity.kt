package com.saarthi.driver

import android.Manifest
import android.os.Build
import android.content.Context
import android.os.Bundle
import java.net.URL
import java.net.HttpURLConnection
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import com.saarthi.driver.data.SharedDestination
import androidx.lifecycle.lifecycleScope
import android.content.Intent
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
import com.saarthi.core.ui.Language
import com.saarthi.driver.ui.design.FleetTheme
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

    /**
     * Resolve resources in the driver's chosen language.
     *
     * Here rather than anywhere later because this runs before a single view or
     * resource is touched — which is the only point at which a configuration
     * override takes effect for the whole activity. See [Language] for why the
     * per-app locale API was not used.
     */
    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(Language.wrap(newBase))
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

        // A share may be what launched us.
        receiveSharedLocation(intent)

        setContent {
            val driver: DriverViewModel = viewModel()
            val cockpit: TerminalViewModel = viewModel()
            var reducedMotion by remember { mutableStateOf(app.settings.reducedMotion) }
            var darkTheme by remember { mutableStateOf(app.settings.darkTheme) }
            val windowSize = calculateWindowSizeClass(this)

            FleetTheme(darkTheme = darkTheme, reducedMotion = reducedMotion) {
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
     * A share arriving while the app is already open.
     *
     * The activity is `singleTask`, so Android delivers the second and every
     * subsequent share here rather than building another copy of the app. A
     * driver who is sent two pins in a row must get the second one.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        receiveSharedLocation(intent)
    }

    /**
     * Turn whatever another app sent into a destination.
     *
     * Three shapes reach this, and a driver should not have to know which they
     * were given: a `geo:` URI, a Maps link, or a forwarded message with a link
     * or a coordinate pair somewhere inside it.
     *
     * Google's own share sheet produces a short link by default, and those carry
     * no coordinates at all until they have been followed — so that one case
     * needs the network, and it is the reason any of this is asynchronous.
     */
    private fun receiveSharedLocation(intent: Intent?) {
        val app = application as SaarthiDriverApp
        val raw = when (intent?.action) {
            Intent.ACTION_VIEW -> intent.dataString
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            else -> null
        } ?: return

        SharedDestination.parse(raw)?.let { destination ->
            app.sharedDestinations.offer(destination)
            return
        }

        val link = SharedDestination.firstUrl(raw) ?: raw
        if (!SharedDestination.isShortLink(link)) {
            DebugLog.debug(TAG, "Nothing routable in the shared text")
            return
        }

        lifecycleScope.launch {
            val expanded = withContext(Dispatchers.IO) { follow(link) }
            val destination = SharedDestination.parse(expanded)
            if (destination == null) {
                DebugLog.warn(TAG, "Could not resolve a shared short link")
            } else {
                app.sharedDestinations.offer(destination)
            }
        }
    }

    /**
     * Follow a short link far enough to read the coordinates out of it.
     *
     * Redirects are not followed automatically: the `Location` header is the
     * whole point, and the long URL it names is often enough on its own, so
     * chasing it by hand avoids downloading a Maps page to throw away. A short
     * chain is allowed because Google sometimes uses more than one hop.
     *
     * Deliberately quiet on failure. A driver who shared a link into Saarthi and
     * got nothing will try the other app; a driver shown a crash will not use
     * this one again.
     */
    private fun follow(url: String): String? {
        var current = url
        repeat(MAX_REDIRECTS) {
            val connection = runCatching {
                (URL(current).openConnection() as HttpURLConnection).apply {
                    instanceFollowRedirects = false
                    connectTimeout = LINK_TIMEOUT_MS
                    readTimeout = LINK_TIMEOUT_MS
                    requestMethod = "GET"
                    // Some shorteners answer a bare client with an interstitial
                    // rather than a redirect.
                    setRequestProperty("User-Agent", "Mozilla/5.0 (Android) Saarthi")
                }
            }.getOrNull() ?: return null

            val next = try {
                val code = connection.responseCode
                if (code in 300..399) connection.getHeaderField("Location") else null
            } catch (error: Exception) {
                DebugLog.debug(TAG, "Short link would not resolve: ${error.javaClass.simpleName}")
                null
            } finally {
                connection.disconnect()
            }

            if (next == null) return current
            current = next
            // The expanded URL is usually enough; stop as soon as it parses.
            if (SharedDestination.parse(current) != null) return current
        }
        return current
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

/** Enough hops for Google's chain, few enough to fail fast on a loop. */
private const val MAX_REDIRECTS = 5

private const val LINK_TIMEOUT_MS = 8_000

private const val TAG = "share"
