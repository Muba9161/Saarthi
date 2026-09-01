package com.saarthi.device

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

import com.saarthi.device.ui.CheckResult
import com.saarthi.device.ui.DebugScreen
import com.saarthi.device.ui.DeviceViewModel
import com.saarthi.device.ui.Health
import com.saarthi.device.ui.HomeScreen
import com.saarthi.device.ui.PairScreen
import com.saarthi.device.ui.Route
import com.saarthi.device.ui.SaarthiDeviceTheme
import com.saarthi.device.ui.SectionCard
import com.saarthi.device.ui.SettingsScreen
import com.saarthi.device.ui.StatusBad
import com.saarthi.device.ui.TelemetryScreen
import com.saarthi.device.ui.TestCenterScreen
import com.saarthi.device.ui.VideoScreen
import com.saarthi.device.ui.WelcomeScreen
import com.saarthi.device.ui.healthOf
import com.saarthi.device.util.DebugLog
import com.saarthi.device.util.DeviceEnvironment
import kotlinx.coroutines.delay

/**
 * The single activity.
 *
 * Navigation is a small sealed hierarchy rather than string routes with
 * arguments, because there are eight screens and none of them take a parameter
 * — the state they render all lives in one view model. A navigation graph
 * built out of strings would be more machinery than the app has destinations.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            SaarthiDeviceTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    DeviceApp()
                }
            }
        }
    }
}

@Composable
private fun DeviceApp(viewModel: DeviceViewModel = viewModel()) {
    val navController = rememberNavController()
    val context = androidx.compose.ui.platform.LocalContext.current

    val state by viewModel.state.collectAsState()
    val busy by viewModel.busy.collectAsState()
    val message by viewModel.message.collectAsState()
    val running by viewModel.serviceRunning.collectAsState()
    val debugLines by DebugLog.lines.collectAsState()

    val snackbar = remember { SnackbarHostState() }
    var confirmingSos by remember { mutableStateOf(false) }
    var sosCountdown by remember { mutableStateOf(0) }
    var checks by remember { mutableStateOf<List<Pair<String, List<CheckResult>>>>(emptyList()) }

    /**
     * Permission requests, asked together at the point they are first needed.
     *
     * Notifications is in the list because without it the foreground service's
     * notification is silently suppressed on Android 13 and later — and that
     * notification is the app's privacy disclosure, not decoration.
     */
    val permissions = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { viewModel.refresh() }

    LaunchedEffect(Unit) {
        val wanted = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            wanted += Manifest.permission.POST_NOTIFICATIONS
        }
        permissions.launch(wanted.toTypedArray())
        viewModel.refresh()
    }

    // A visible position on the home screen without a second location listener:
    // the state is refreshed on a slow tick, which is enough for a status
    // display and costs nothing in battery.
    LaunchedEffect(running) {
        while (true) {
            viewModel.refresh()
            delay(if (running) 10_000L else 30_000L)
        }
    }

    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            viewModel.clearMessage()
        }
    }

    LaunchedEffect(confirmingSos) {
        if (!confirmingSos) return@LaunchedEffect
        // A countdown rather than a second button. Section 27 asks for an
        // accidental-activation safeguard, and a few seconds with a visible
        // Cancel is the one that costs a real emergency the least.
        sosCountdown = 5
        while (sosCountdown > 0 && confirmingSos) {
            delay(1_000)
            sosCountdown -= 1
        }
        if (confirmingSos) {
            confirmingSos = false
            viewModel.raiseSos("BREAKDOWN", null) { }
        }
    }

    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (confirmingSos) {
                SosConfirmation(
                    secondsRemaining = sosCountdown,
                    onCancel = { confirmingSos = false },
                    onSendNow = {
                        confirmingSos = false
                        viewModel.raiseSos("BREAKDOWN", null) { }
                    },
                )
            }

            NavHost(
                navController = navController,
                startDestination = if (viewModel.isEnrolled) Route.Home.path else Route.Welcome.path,
            ) {
                composable(Route.Welcome.path) {
                    WelcomeScreen(
                        busy = busy,
                        /*
                         * Straight to the scanner, without enrolling first.
                         *
                         * Enrolment needs an address to enrol *at*, and on first
                         * launch the app does not have one — the pairing QR is
                         * what carries it. Calling the API here would send the
                         * very first request to the build-time default, which is
                         * the emulator's host alias and unreachable from a real
                         * phone.
                         *
                         * So pairing does both, in the only order that can work:
                         * read the address from the code, then enrol against it.
                         */
                        onConnect = { navController.navigate(Route.Pair.path) },
                    )
                }

                composable(Route.Home.path) {
                    HomeScreen(
                        state = state,
                        running = running,
                        gpsStatus = DeviceEnvironment.gpsStatus(context),
                        cameraStatus = DeviceEnvironment.cameraStatus(context),
                        networkType = DeviceEnvironment.networkType(context),
                        onStart = viewModel::startTracking,
                        onStop = viewModel::stopTracking,
                        onPair = { navController.navigate(Route.Pair.path) },
                        onOpen = { navController.navigate(it.path) },
                        onSos = { confirmingSos = true },
                    )
                }

                composable(Route.Pair.path) {
                    PairScreen(
                        busy = busy,
                        onScanned = { raw ->
                            viewModel.onQrScanned(raw) {
                                // Navigate rather than pop. Reached from Welcome
                                // on a first launch, Home is not on the back
                                // stack to pop back to — and clearing Welcome
                                // stops Back returning to a screen that no
                                // longer applies.
                                navController.navigate(Route.Home.path) {
                                    popUpTo(Route.Welcome.path) { inclusive = true }
                                    launchSingleTop = true
                                }
                            }
                        },
                        onCancel = { navController.popBackStack() },
                    )
                }

                composable(Route.Telemetry.path) {
                    TelemetryScreen(
                        currentMode = viewModel.settings.simulationMode,
                        allowedByServer = viewModel.settings.simulationAllowedByServer,
                        onModeChange = viewModel::setSimulationMode,
                    )
                }

                composable(Route.TestCenter.path) {
                    TestCenterScreen(
                        checks = checks,
                        busy = busy,
                        onRun = { checks = runChecks(context, state, running) },
                        onSendTestSos = { confirmingSos = true },
                    )
                }

                composable(Route.Camera.path) {
                    val publisher by viewModel.publisher.collectAsState()
                    VideoScreen(
                        publisherState = publisher,
                        videoEnabled = viewModel.settings.videoEnabled,
                        channel = viewModel.settings.cameraChannel,
                        busy = busy,
                        onChannelChange = viewModel::setCameraChannel,
                        onStart = viewModel::startPublishing,
                        onStop = viewModel::stopPublishing,
                        onPreviewOnly = { },
                    )
                }

                composable(Route.Settings.path) {
                    SettingsScreen(
                        state = state,
                        reportingInterval = viewModel.settings.reportingIntervalSeconds,
                        autoStart = viewModel.settings.autoStart,
                        apiBaseUrl = viewModel.apiBaseUrl,
                        onIntervalChange = viewModel::setReportingInterval,
                        onAutoStartChange = { viewModel.settings.autoStart = it },
                        onUnpair = viewModel::unpair,
                        onReset = {
                            viewModel.resetDevice()
                            navController.navigate(Route.Welcome.path) {
                                popUpTo(0) { inclusive = true }
                            }
                        },
                        onOpenDebug = { navController.navigate(Route.Debug.path) },
                    )
                }

                composable(Route.Debug.path) {
                    DebugScreen(lines = debugLines, onClear = DebugLog::clear)
                }
            }
        }
    }
}

/**
 * The SOS safeguard.
 *
 * Shown above everything, with the countdown as the largest element and Cancel
 * as the easy target. Send now exists because somebody who meant it should not
 * have to wait five seconds.
 */
@Composable
private fun SosConfirmation(
    secondsRemaining: Int,
    onCancel: () -> Unit,
    onSendNow: () -> Unit,
) {
    SectionCard(
        title = "Raising an emergency in $secondsRemaining…",
        subtitle = "Saarthi will alert your fleet and any nearby Saarthi vehicles it selects.",
        modifier = Modifier.padding(16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TextButton(onClick = onCancel, modifier = Modifier.weight(1f)) {
                Text("Cancel")
            }
            Button(
                onClick = onSendNow,
                colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                    containerColor = StatusBad,
                ),
                modifier = Modifier.weight(1f),
            ) { Text("Send now") }
        }
    }
}

/**
 * The Test Center's checks.
 *
 * Read from the same sources the service reports from, so a green result here
 * means the thing the dashboard sees is genuinely working — not that a separate
 * code path happened to succeed.
 */
private fun runChecks(
    context: android.content.Context,
    state: com.saarthi.device.data.DeviceRepository.DeviceState,
    running: Boolean,
): List<Pair<String, List<CheckResult>>> {
    val gps = DeviceEnvironment.gpsStatus(context)
    val camera = DeviceEnvironment.cameraStatus(context)
    val network = DeviceEnvironment.networkType(context)
    val battery = DeviceEnvironment.battery(context)

    return listOf(
        "GPS" to listOf(
            CheckResult("Permission", com.saarthi.device.ui.describeSubsystem(gps), healthOf(gps)),
            CheckResult(
                "Reporting",
                if (running) "Service running" else "Service stopped",
                if (running) Health.OK else Health.IDLE,
            ),
        ),
        "Camera" to listOf(
            CheckResult("Permission", com.saarthi.device.ui.describeSubsystem(camera), healthOf(camera)),
            CheckResult(
                "Streaming",
                if (state.config?.videoEnabled == true) "Gateway available" else "No video gateway",
                if (state.config?.videoEnabled == true) Health.OK else Health.IDLE,
            ),
        ),
        "Backend" to listOf(
            CheckResult(
                "Authentication",
                if (state.deviceIdentifier != null) "Credentials held" else "Not enrolled",
                if (state.deviceIdentifier != null) Health.OK else Health.BAD,
            ),
            CheckResult(
                "Pairing",
                state.vehicleRegistration ?: "Not paired",
                if (state.paired) Health.OK else Health.WARN,
            ),
            CheckResult(
                "Last sync",
                state.lastSyncAt?.let { com.saarthi.device.ui.relativeTime(it) } ?: "Never",
                if (state.lastSyncAt == null) Health.IDLE else Health.OK,
            ),
        ),
        "Network" to listOf(
            CheckResult(
                "Connectivity",
                network,
                if (network == DeviceEnvironment.Network.OFFLINE) Health.BAD else Health.OK,
            ),
            CheckResult(
                "Buffer",
                "${state.bufferedEvents} event(s) waiting",
                if (state.bufferedEvents > 0) Health.WARN else Health.OK,
            ),
        ),
        "Battery" to listOf(
            CheckResult(
                "Level",
                battery.percent?.let { "$it%" } ?: "Not reported",
                when {
                    battery.percent == null -> Health.IDLE
                    battery.percent < 15 -> Health.BAD
                    battery.percent < 30 -> Health.WARN
                    else -> Health.OK
                },
            ),
            CheckResult(
                "Charging",
                when (battery.charging) {
                    true -> "Yes"
                    false -> "No"
                    null -> "Unknown"
                },
                Health.IDLE,
            ),
        ),
        "Telemetry" to listOf(
            CheckResult(
                "Simulation",
                if (state.config?.simulationAllowed == false) {
                    "Not accepted by this environment"
                } else {
                    "Available"
                },
                if (state.config?.simulationAllowed == false) Health.IDLE else Health.OK,
            ),
        ),
    )
}
