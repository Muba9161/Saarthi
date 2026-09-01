package com.saarthi.device.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.saarthi.device.BuildConfig
import com.saarthi.device.data.DeviceRepository
import com.saarthi.device.domain.TelemetrySimulator
import com.saarthi.device.util.DebugLog
import com.saarthi.device.util.DeviceEnvironment

/**
 * The screens.
 *
 * Written for a phone on a windscreen mount in daylight, which drives most of
 * the layout decisions: large targets, high contrast, one column, and no
 * information that needs a second glance to interpret. The home screen answers
 * one question — is this thing working — and everything else is a tap away.
 */

// ---------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------

@Composable
fun WelcomeScreen(
    busy: Boolean,
    onConnect: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "SAARTHI DEVICE",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(16.dp))
        Text(
            "Turn your phone into a Saarthi vehicle test device.",
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(32.dp))

        // Said before anything is asked for, not buried in a settings screen
        // afterwards. Section 46 asks that the person be told plainly what this
        // app does with their location, and the moment to tell them is before
        // they agree to it.
        Text(
            "While this device is running, your location is shared with Saarthi " +
                "for the vehicle it is paired to. A notification stays visible for " +
                "as long as that is happening.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )

        Spacer(Modifier.height(32.dp))
        Button(onClick = onConnect, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            if (busy) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.size(8.dp))
            }
            Text("Connect Device")
        }
    }
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

@Composable
fun HomeScreen(
    state: DeviceRepository.DeviceState,
    running: Boolean,
    gpsStatus: String,
    cameraStatus: String,
    networkType: String,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onPair: () -> Unit,
    onOpen: (Route) -> Unit,
    onSos: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("SAARTHI DEVICE", style = MaterialTheme.typography.titleLarge)

        SectionCard(
            title = state.deviceIdentifier ?: "Not enrolled",
            subtitle = if (state.paired) {
                "Paired to ${state.vehicleRegistration}"
            } else {
                "Not paired to a vehicle"
            },
        ) {
            StatusRow(
                label = "Backend",
                value = if (state.lastError == null) "Connected" else state.lastError,
                health = if (state.lastError == null) Health.OK else Health.BAD,
            )
            StatusRow(
                label = "GPS",
                value = describeSubsystem(gpsStatus),
                health = healthOf(gpsStatus),
            )
            StatusRow(
                label = "Camera",
                value = describeSubsystem(cameraStatus),
                health = healthOf(cameraStatus),
            )
            StatusRow(
                label = "Network",
                value = if (networkType == DeviceEnvironment.Network.OFFLINE) {
                    "Offline"
                } else {
                    networkType.lowercase().replaceFirstChar { it.uppercase() }
                },
                health = if (networkType == DeviceEnvironment.Network.OFFLINE) Health.WARN else Health.OK,
            )
            StatusRow(
                label = "Last sync",
                value = state.lastSyncAt?.let { relativeTime(it) } ?: "Never",
                health = if (state.lastSyncAt == null) Health.IDLE else Health.OK,
            )

            if (state.bufferedEvents > 0) {
                // Framed as held, not as failed. A device buffering is a device
                // that kept the data through an outage instead of losing it.
                StatusRow(
                    label = "Buffered",
                    value = "${state.bufferedEvents} event(s) waiting to upload",
                    health = Health.WARN,
                )
            }
        }

        if (!state.paired) {
            Button(onClick = onPair, modifier = Modifier.fillMaxWidth()) {
                Text("Scan pairing code")
            }
        } else {
            Button(
                onClick = if (running) onStop else onStart,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (running) "Stop Device" else "Start Device")
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(onClick = { onOpen(Route.Camera) }, modifier = Modifier.weight(1f)) {
                Text("Camera")
            }
            OutlinedButton(onClick = { onOpen(Route.TestCenter) }, modifier = Modifier.weight(1f)) {
                Text("Test Center")
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(onClick = { onOpen(Route.Telemetry) }, modifier = Modifier.weight(1f)) {
                Text("Telemetry")
            }
            OutlinedButton(onClick = { onOpen(Route.Settings) }, modifier = Modifier.weight(1f)) {
                Text("Settings")
            }
        }

        Spacer(Modifier.height(8.dp))

        // Full width, red, and always in the same place whatever else is on the
        // screen. The confirmation that follows is what prevents an accidental
        // press; making the button itself hard to hit would be the wrong trade.
        Button(
            onClick = onSos,
            enabled = state.paired,
            colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                containerColor = StatusBad,
            ),
            modifier = Modifier.fillMaxWidth().height(64.dp),
        ) {
            Icon(Icons.Filled.Warning, contentDescription = null)
            Spacer(Modifier.size(8.dp))
            Text("SOS", style = MaterialTheme.typography.titleLarge)
        }

        if (!state.paired) {
            Text(
                "Pair this device to a vehicle before raising an emergency, so Saarthi knows who to alert.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Telemetry simulation
// ---------------------------------------------------------------------------

@Composable
fun TelemetryScreen(
    currentMode: TelemetrySimulator.Mode,
    allowedByServer: Boolean,
    onModeChange: (TelemetrySimulator.Mode) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Vehicle telemetry", style = MaterialTheme.typography.titleLarge)

        // Stated once, at the top, in full. Everything on this screen is
        // invented, and the person choosing a profile should understand that
        // before they pick one — not discover it from a badge later.
        Text(
            "A phone has no connection to the engine. Everything below is produced by a " +
                "simulator so the alert rules and AI tools can be tested before hardware " +
                "arrives. Saarthi records every one of these values as simulated, and shows " +
                "them that way on the dashboard.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (!BuildConfig.ALLOW_SIMULATION) {
            SectionCard(title = "Not available in this build") {
                Text(
                    "Simulated engine data is compiled out of release builds, so fabricated " +
                        "telemetry cannot reach a live fleet.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            return@Column
        }

        if (!allowedByServer) {
            SectionCard(title = "Switched off by Saarthi") {
                Text(
                    "This environment does not accept simulated engine data.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            return@Column
        }

        TelemetrySimulator.Mode.entries.forEach { mode ->
            SectionCard(title = mode.label, subtitle = mode.description) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    FilterChip(
                        selected = currentMode == mode,
                        onClick = { onModeChange(mode) },
                        label = { Text(if (currentMode == mode) "Running" else "Use this") },
                    )
                    if (mode != TelemetrySimulator.Mode.OFF) {
                        Spacer(Modifier.size(8.dp))
                        SimulatedBadge()
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Test Center
// ---------------------------------------------------------------------------

data class CheckResult(val label: String, val detail: String, val health: Health)

@Composable
fun TestCenterScreen(
    checks: List<Pair<String, List<CheckResult>>>,
    busy: Boolean,
    onRun: () -> Unit,
    onSendTestSos: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Device Test Center", style = MaterialTheme.typography.titleLarge)
        Text(
            "Everything this device needs in order to behave like fitted hardware, checked in one place.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Button(onClick = onRun, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            if (busy) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.size(8.dp))
            }
            Text("Run checks")
        }

        checks.forEach { (group, results) ->
            SectionCard(title = group) {
                results.forEach { check ->
                    StatusRow(label = check.label, value = check.detail, health = check.health)
                }
            }
        }

        SectionCard(
            title = "SOS",
            subtitle = "Raises a real incident against the paired vehicle, so the whole alert path is exercised.",
        ) {
            // Named a test but described honestly: it reaches real people. An
            // endpoint that only pretended to alert would prove nothing about
            // the thing being tested.
            OutlinedButton(onClick = onSendTestSos, modifier = Modifier.fillMaxWidth()) {
                Text("Send a test emergency")
            }
            Text(
                "Your fleet, and any nearby Saarthi vehicles Saarthi selects, will be alerted. " +
                    "Resolve it from the dashboard afterwards.",
                style = MaterialTheme.typography.bodySmall,
                color = StatusWarn,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

@Composable
fun SettingsScreen(
    state: DeviceRepository.DeviceState,
    reportingInterval: Int,
    autoStart: Boolean,
    apiBaseUrl: String,
    onIntervalChange: (Int) -> Unit,
    onAutoStartChange: (Boolean) -> Unit,
    onUnpair: () -> Unit,
    onReset: () -> Unit,
    onOpenDebug: () -> Unit,
) {
    var confirmingReset by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Settings", style = MaterialTheme.typography.titleLarge)

        SectionCard(title = "This device") {
            StatusRow("Device ID", state.deviceIdentifier ?: "—", Health.IDLE)
            StatusRow("Vehicle", state.vehicleRegistration ?: "Not paired", Health.IDLE)
            StatusRow("Backend", apiBaseUrl, Health.IDLE)
            StatusRow("Environment", state.config?.environment ?: "unknown", Health.IDLE)
            StatusRow("App version", BuildConfig.VERSION_NAME, Health.IDLE)
        }

        SectionCard(
            title = "Reporting interval",
            subtitle = "How often a position is sent. Saarthi can override this from the dashboard.",
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(1 to "Testing", 5 to "Normal", 15 to "Battery saver").forEach { (seconds, label) ->
                    FilterChip(
                        selected = reportingInterval == seconds,
                        onClick = { onIntervalChange(seconds) },
                        label = { Text("$label · ${seconds}s") },
                    )
                }
            }
            if (reportingInterval <= 1) {
                Text(
                    "One second is for watching a marker move on a desk. It will flatten a battery in a few hours.",
                    style = MaterialTheme.typography.bodySmall,
                    color = StatusWarn,
                )
            }
        }

        SectionCard(
            title = "Start after a reboot",
            subtitle = "For a phone fitted permanently in a cab, so a restart does not leave a gap in the vehicle's history.",
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(checked = autoStart, onCheckedChange = onAutoStartChange)
                Spacer(Modifier.size(12.dp))
                Text(if (autoStart) "On" else "Off")
            }
        }

        SectionCard(
            title = "Battery",
            subtitle = "Android will eventually stop a background app to save power. For a device that must keep reporting, exclude Saarthi Device from battery optimisation in the system settings.",
        ) {
            Text(
                "Settings → Apps → Saarthi Device → Battery → Unrestricted",
                style = MaterialTheme.typography.bodySmall,
                fontFamily = FontFamily.Monospace,
            )
        }

        if (DebugLog.enabled) {
            OutlinedButton(onClick = onOpenDebug, modifier = Modifier.fillMaxWidth()) {
                Text("Debug console")
            }
        }

        HorizontalDivider()

        if (state.paired) {
            OutlinedButton(onClick = onUnpair, modifier = Modifier.fillMaxWidth()) {
                Text("Unpair from ${state.vehicleRegistration}")
            }
        }

        if (confirmingReset) {
            SectionCard(title = "Reset this device?") {
                Text(
                    "The device identity, its credentials and anything still waiting to upload " +
                        "will be erased. Saarthi keeps the history this device already sent.",
                    style = MaterialTheme.typography.bodySmall,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { confirmingReset = false }) { Text("Cancel") }
                    Button(
                        onClick = {
                            confirmingReset = false
                            onReset()
                        },
                        colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                            containerColor = StatusBad,
                        ),
                    ) { Text("Reset") }
                }
            }
        } else {
            TextButton(onClick = { confirmingReset = true }) {
                Text("Reset this device", color = StatusBad)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Debug console
// ---------------------------------------------------------------------------

@Composable
fun DebugScreen(lines: List<String>, onClear: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Debug console", style = MaterialTheme.typography.titleLarge)
            TextButton(onClick = onClear) { Text("Clear") }
        }

        Text(
            "Tokens, secrets and credentials are stripped before anything reaches this log.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Box(modifier = Modifier.fillMaxWidth().weight(1f)) {
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                if (lines.isEmpty()) {
                    Text("Nothing logged yet.", style = MaterialTheme.typography.bodySmall)
                }
                lines.asReversed().forEach { line ->
                    Text(
                        line,
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fun healthOf(status: String): Health = when (status) {
    DeviceEnvironment.Status.OK -> Health.OK
    DeviceEnvironment.Status.DEGRADED -> Health.WARN
    DeviceEnvironment.Status.PERMISSION_DENIED -> Health.BAD
    DeviceEnvironment.Status.UNAVAILABLE -> Health.BAD
    else -> Health.IDLE
}

/**
 * Subsystem status in words a driver can act on.
 *
 * "Permission denied" tells somebody what to do; "BAD" does not. The three
 * failures are kept distinct because the fix differs for each.
 */
fun describeSubsystem(status: String): String = when (status) {
    DeviceEnvironment.Status.OK -> "Active"
    DeviceEnvironment.Status.DEGRADED -> "Approximate only"
    DeviceEnvironment.Status.PERMISSION_DENIED -> "Permission not granted"
    DeviceEnvironment.Status.UNAVAILABLE -> "Switched off or unavailable"
    else -> "Unknown"
}

fun relativeTime(millis: Long): String {
    val seconds = (System.currentTimeMillis() - millis) / 1000
    return when {
        seconds < 5 -> "just now"
        seconds < 60 -> "$seconds seconds ago"
        seconds < 3600 -> "${seconds / 60} min ago"
        else -> "${seconds / 3600} h ago"
    }
}
