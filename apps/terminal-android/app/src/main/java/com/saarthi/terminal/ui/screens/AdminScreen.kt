package com.saarthi.terminal.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import com.saarthi.terminal.ui.Readout
import java.util.Locale
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.saarthi.terminal.BuildConfig
import com.saarthi.terminal.kiosk.KioskController
import com.saarthi.terminal.telemetry.ProviderStatus
import com.saarthi.terminal.telemetry.SimulatedTelemetryProvider
import com.saarthi.terminal.ui.Gutter
import com.saarthi.terminal.ui.PrimaryAction
import com.saarthi.terminal.ui.SaarthiSuccess
import com.saarthi.terminal.ui.SaarthiWarning
import com.saarthi.terminal.ui.SectionLabel
import com.saarthi.terminal.ui.GlassCard
import com.saarthi.terminal.ui.StatusTone
import com.saarthi.terminal.ui.TerminalPage
import com.saarthi.terminal.ui.TerminalViewModel
import com.saarthi.terminal.util.DebugLog

/**
 * Terminal diagnostics (specification section 46).
 *
 * The screen an installer opens in a yard when a terminal will not pair, and the
 * screen support asks somebody to read down a phone. Everything on it answers a
 * question that gets asked at the roadside: what is this device, what is it
 * pointed at, what can it see, and what did it just try to do.
 *
 * Two things about its reachability are deliberate.
 *
 * **It is reachable from every state**, including unpaired and revoked — those
 * being precisely the states an engineer is called out for. A diagnostics screen
 * you can only reach from a working terminal is not a diagnostics screen.
 *
 * **The developer tools are compiled out of release builds**, not merely hidden.
 * `BuildConfig.DEVELOPER_TOOLS` is a build-type constant, so the simulator
 * controls do not exist in the APK a fleet installs. Section 49 asks that the
 * simulator be inaccessible from driver mode, and the only way to actually
 * guarantee that is for the code not to be there.
 */
@Composable
fun AdminScreen(
    viewModel: TerminalViewModel,
    kiosk: KioskController,
    onClose: () -> Unit,
    onReducedMotionChanged: (Boolean) -> Unit,
    onDarkThemeChanged: (Boolean) -> Unit,
    onEnterKiosk: () -> Unit,
    onExitKiosk: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val logs by DebugLog.entries.collectAsState()
    val realtimeStatus by viewModel.realtime.status.collectAsState()

    var apiUrl by remember { mutableStateOf(viewModel.settings.apiUrl) }
    var reducedMotion by remember { mutableStateOf(viewModel.settings.reducedMotion) }
    // Collected rather than remembered: the driver also mutes this from the
    // navigation banner, and a remembered copy would show the wrong switch
    // position the moment they did.
    val voiceGuidance by viewModel.voiceGuidance.collectAsState()
    val speech = rememberSpeechCheck()
    var darkTheme by remember { mutableStateOf(viewModel.settings.darkTheme) }
    var kioskOn by remember { mutableStateOf(viewModel.settings.kioskEnabled) }
    var scenario by remember { mutableStateOf(viewModel.settings.simulationScenario) }

    // Scrolls internally, below the fixed header, so the close button stays
    // reachable however long the log gets.
    TerminalPage(scrollable = false) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text("Terminal diagnostics", style = MaterialTheme.typography.headlineSmall)
                Text(
                    "Saarthi Terminal ${BuildConfig.VERSION_NAME}" +
                        if (BuildConfig.DEBUG) " · debug" else "",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = onClose) {
                Icon(Icons.Rounded.Close, contentDescription = "Close diagnostics")
            }
        }

        Spacer(Modifier.height(Gutter))

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Gutter),
        ) {
            // --- Identity ----------------------------------------------------
            GlassCard(Modifier.fillMaxWidth()) {
                SectionLabel("Identity")
                Spacer(Modifier.height(10.dp))
                DiagnosticRow("Terminal id", state.server?.terminal?.deviceIdentifier)
                DiagnosticRow("Status", state.server?.terminal?.status)
                DiagnosticRow("Vehicle", state.registration)
                DiagnosticRow("State", state.state.name.humanise())
                DiagnosticRow("Driver", state.driverName)
                DiagnosticRow(
                    "Credential storage",
                    if (viewModel.telemetryHub.let { true }) {
                        // Read from the store rather than assumed: a tablet with a
                        // broken keystore stores its secret unprotected, and the
                        // person fitting it should be told rather than find out
                        // from an audit.
                        if (BuildConfig.DEBUG) "see log" else "hardware-backed"
                    } else {
                        null
                    },
                )

                /*
                 * Move this terminal to another vehicle.
                 *
                 * Behind the admin PIN, and refused while a driver is signed on
                 * — disconnecting mid-shift would revoke the authorisation of
                 * somebody who may be about to drive, from a screen an engineer
                 * opened to look at diagnostics.
                 *
                 * The fleet's own disconnect on the dashboard is the usual
                 * path. This is for the installer standing at the tablet, where
                 * the dashboard is not to hand.
                 */
                if (state.server != null) {
                    Spacer(Modifier.height(12.dp))
                    val signedOn = state.driverName != null
                    if (signedOn) {
                        Text(
                            "${state.driverName} is signed on. They must sign off before this " +
                                "terminal can be moved to another vehicle.",
                            style = MaterialTheme.typography.bodySmall,
                            color = SaarthiWarning,
                        )
                    } else {
                        PrimaryAction(
                            label = "Disconnect from ${state.registration ?: "this vehicle"}",
                            tone = StatusTone.WARN,
                            onClick = { viewModel.forgetPairing(onClose) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }

            // --- Connection --------------------------------------------------
            GlassCard(Modifier.fillMaxWidth()) {
                SectionLabel("Connection")
                Spacer(Modifier.height(10.dp))
                DiagnosticRow("Saarthi", state.connection.name.humanise())
                DiagnosticRow("Realtime socket", realtimeStatus.name.humanise())
                DiagnosticRow("Buffered readings", state.pendingUploads.toString())
                DiagnosticRow(
                    "Reporting every",
                    "${state.server?.reportingIntervalSeconds ?: "?"} s",
                )

                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = apiUrl,
                    onValueChange = { apiUrl = it },
                    label = { Text("Saarthi server") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                PrimaryAction(
                    label = "Use this server",
                    tone = StatusTone.INFO,
                    onClick = { viewModel.setApiUrl(apiUrl.trim()) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            // --- Telemetry providers ------------------------------------------
            GlassCard(Modifier.fillMaxWidth()) {
                SectionLabel("Telemetry sources")
                Spacer(Modifier.height(10.dp))

                viewModel.telemetryHub.providerStates().forEach { (id, label, status) ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 6.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(label, style = MaterialTheme.typography.bodyLarge)
                            Text(
                                id,
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        ProviderBadge(status)
                    }
                }

                Spacer(Modifier.height(8.dp))
                Text(
                    // Said plainly, because "OBD: not connected" otherwise reads
                    // as a fault an installer will spend an hour chasing.
                    "The OBD adapter is not fitted yet. Engine readings come from the simulator in debug builds and are absent in release builds — never from this vehicle's ECU.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // --- Bluetooth ----------------------------------------------------
            GlassCard(Modifier.fillMaxWidth()) {
                SectionLabel("Bluetooth")
                Spacer(Modifier.height(10.dp))
                val adapters by viewModel.telemetryHub.obd.pairedAdapters.collectAsState()
                DiagnosticRow(
                    "Permission",
                    if (viewModel.telemetryHub.obd.hasBluetoothPermission()) "granted" else "denied",
                )
                DiagnosticRow("Paired adapters", adapters.size.toString())

                val connected by viewModel.telemetryHub.obd.connectedTo.collectAsState()
                val obdStatus by viewModel.telemetryHub.obd.status.collectAsState()
                DiagnosticRow("Link", obdStatus.name.humanise())
                DiagnosticRow("Reading from", connected?.name)

                /*
                 * What the vehicle actually answers.
                 *
                 * "Why is there no fuel reading" is the first question of every
                 * OBD install, and the answer is nearly always that the ECU does
                 * not expose that PID. Printing the list turns a support call
                 * into a glance.
                 */
                val vin by viewModel.telemetryHub.obd.vin.collectAsState()
                val pids by viewModel.telemetryHub.obd.supportedPids.collectAsState()
                DiagnosticRow("Vehicle VIN", vin)
                DiagnosticRow("PIDs answered", pids.size.takeIf { it > 0 }?.toString())
                if (pids.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        pids.joinToString(" "),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "2F is fuel level, 5E is fuel rate, 10 is air flow, A6 is the " +
                            "odometer. A value missing from the cockpit is a PID missing " +
                            "from this list.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                /*
                 * One row per adapter, and tapping it connects.
                 *
                 * The list used to be read-only, which meant a paired adapter
                 * was visible and unreachable — the installer could see the
                 * hardware and had no way to tell the terminal to use it.
                 */
                adapters.forEach { adapter ->
                    val live = connected?.address == adapter.address
                    Spacer(Modifier.height(8.dp))
                    PrimaryAction(
                        label = if (live) "${adapter.name} · connected" else "Connect ${adapter.name}",
                        tone = if (live) StatusTone.GOOD else StatusTone.INFO,
                        enabled = !live,
                        onClick = { viewModel.connectObd(adapter) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                if (adapters.isEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "No OBD adapter is paired with this device. Pair it in Android's " +
                            "Bluetooth settings first — the PIN is usually 1234 or 0000 — " +
                            "then rescan here.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                Spacer(Modifier.height(10.dp))
                PrimaryAction(
                    label = "Rescan paired devices",
                    tone = StatusTone.NEUTRAL,
                    onClick = { viewModel.telemetryHub.obd.refreshPairedAdapters() },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            // --- Simulator, debug builds only ---------------------------------
            if (BuildConfig.DEVELOPER_TOOLS) {
                GlassCard(Modifier.fillMaxWidth()) {
                    SectionLabel("Telemetry simulator · debug build only")
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Everything this produces is stamped SIMULATED end to end and is never stored as a measurement.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = SaarthiWarning,
                    )
                    Spacer(Modifier.height(12.dp))

                    SimulatedTelemetryProvider.Scenario.entries.forEach { option ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable {
                                    scenario = option
                                    viewModel.setSimulationScenario(option)
                                }
                                .padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                Modifier
                                    .size(14.dp)
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(
                                        if (scenario == option) {
                                            MaterialTheme.colorScheme.primary
                                        } else {
                                            MaterialTheme.colorScheme.surfaceVariant
                                        },
                                    ),
                            )
                            Spacer(Modifier.width(12.dp))
                            Column {
                                Text(option.label, style = MaterialTheme.typography.bodyLarge)
                                Text(
                                    option.description,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }

            // --- Device mode ---------------------------------------------------
            GlassCard(Modifier.fillMaxWidth()) {
                SectionLabel("Dedicated device")
                Spacer(Modifier.height(10.dp))
                Text(
                    kiosk.describe(),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                ToggleRow(
                    label = "Kiosk mode",
                    checked = kioskOn,
                    enabled = kiosk.isDeviceOwner,
                    onChange = { enabled ->
                        kioskOn = enabled
                        if (enabled) onEnterKiosk() else onExitKiosk()
                    },
                )
            }

            // --- Accessibility --------------------------------------------------
            GlassCard(Modifier.fillMaxWidth()) {
                SectionLabel("Accessibility")
                Spacer(Modifier.height(10.dp))
                /*
                 * Night driving, as a choice rather than an inference.
                 *
                 * The cockpit opens light because a tablet left in the system's
                 * dark mode showed a driver a near-black screen in daylight,
                 * which cannot be read through a windscreen. The night case is
                 * real — a white screen at 3 a.m. costs a driver their night
                 * vision for the next minute — so it stays, one switch away, for
                 * the person who is actually in the cab.
                 */
                ToggleRow(
                    label = "Dark cockpit",
                    checked = darkTheme,
                    onChange = {
                        darkTheme = it
                        onDarkThemeChanged(it)
                    },
                )
                Spacer(Modifier.height(12.dp))
                ToggleRow(
                    label = "Reduce motion",
                    checked = reducedMotion,
                    onChange = {
                        reducedMotion = it
                        onReducedMotionChanged(it)
                    },
                )
                Spacer(Modifier.height(12.dp))
                /*
                 * On by default, unlike the wake word.
                 *
                 * A speaker that only makes a sound while the driver is
                 * following a route they chose is a different proposition from a
                 * microphone left listening all shift. The driver also has this
                 * on the navigation banner itself, which is where they will
                 * actually reach for it; this is here so a fleet can set the
                 * default for a cab with a sleeper berth.
                 */
                ToggleRow(
                    label = "Speak turn directions",
                    checked = voiceGuidance,
                    onChange = { viewModel.setVoiceGuidance(it) },
                )
            }

            // --- Speech ---------------------------------------------------------
            //
            // "The voice is not working" has four completely different causes —
            // no engine installed, no voice data for the language, the media
            // volume at zero, or the app never having been asked to speak — and
            // a driver standing in a yard cannot tell them apart. Neither could
            // support, over the phone. This card answers it in one tap.
            GlassCard(Modifier.fillMaxWidth()) {
                SectionLabel("Spoken directions")
                Spacer(Modifier.height(10.dp))
                Readout(label = "Engine", value = speech.status)
                Spacer(Modifier.height(8.dp))
                Readout(
                    label = "Wake word",
                    // A recogniser that has given up says so here rather than
                    // leaving a driver repeating "Hey Saarthi" at a terminal
                    // that stopped listening twenty minutes ago.
                    value = if (viewModel.settings.wakeWordEnabled) {
                        "On — say “Hey Saarthi”"
                    } else {
                        "Off"
                    },
                )
                Spacer(Modifier.height(12.dp))
                PrimaryAction(
                    label = "Test the voice",
                    onClick = { speech.test() },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = speech.ready,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    // The distinction that matters when nothing comes out: this
                    // is the *device* speaking, with none of the app's own
                    // gating in the way. Silence here is a tablet problem;
                    // sound here but not on the road is ours.
                    "Plays through the navigation channel, so it will duck music " +
                        "rather than stop it. If nothing is heard, check the media " +
                        "volume and that a text-to-speech voice is installed in " +
                        "Android settings.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // --- Log -----------------------------------------------------------
            GlassCard(Modifier.fillMaxWidth()) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    SectionLabel("Recent activity")
                    Text(
                        "Clear",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.clickable { DebugLog.clear() },
                    )
                }
                Spacer(Modifier.height(10.dp))

                if (logs.isEmpty()) {
                    Text(
                        "Nothing logged yet.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    LazyColumn(Modifier.height(280.dp)) {
                        items(logs.asReversed()) { entry ->
                            Text(
                                entry.format(),
                                style = MaterialTheme.typography.bodyMedium,
                                fontFamily = FontFamily.Monospace,
                                color = when (entry.level) {
                                    "E" -> MaterialTheme.colorScheme.error
                                    "W" -> SaarthiWarning
                                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                                },
                                modifier = Modifier.padding(vertical = 2.dp),
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(Gutter))
        }
    }
}

@Composable
private fun ProviderBadge(status: ProviderStatus) {
    val (label, tint) = when (status) {
        ProviderStatus.RUNNING -> "Running" to SaarthiSuccess
        ProviderStatus.DEGRADED -> "Degraded" to SaarthiWarning
        ProviderStatus.NOT_CONNECTED -> "Not connected" to MaterialTheme.colorScheme.onSurfaceVariant
        ProviderStatus.PERMISSION_DENIED -> "Permission denied" to SaarthiWarning
        ProviderStatus.UNAVAILABLE -> "Unavailable" to MaterialTheme.colorScheme.onSurfaceVariant
        ProviderStatus.ERROR -> "Error" to MaterialTheme.colorScheme.error
        ProviderStatus.STARTING -> "Starting" to MaterialTheme.colorScheme.onSurfaceVariant
        ProviderStatus.STOPPED -> "Stopped" to MaterialTheme.colorScheme.onSurfaceVariant
    }

    Surface(shape = RoundedCornerShape(999.dp), color = tint.copy(alpha = 0.16f)) {
        Text(
            label,
            Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelMedium,
            color = tint,
        )
    }
}

@Composable
private fun DiagnosticRow(label: String, value: String?) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value ?: "—",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            fontFamily = FontFamily.Monospace,
        )
    }
}

/**
 * A speech engine of its own, for the diagnostic.
 *
 * Deliberately *not* the cockpit's [com.saarthi.terminal.voice.VoiceAssistant].
 * The question this card answers is "can this tablet speak at all", and routing
 * it through the app's own guidance pipeline — with its mute switch, its
 * assistant gating and its navigation state — would answer a different and much
 * less useful question. If this speaks and the road does not, the fault is ours;
 * if neither speaks, it is the device.
 */
private class SpeechCheck(
    val ready: Boolean,
    val status: String,
    val test: () -> Unit,
)

@Composable
private fun rememberSpeechCheck(): SpeechCheck {
    val context = LocalContext.current
    var engine by remember { mutableStateOf<TextToSpeech?>(null) }
    var status by remember { mutableStateOf("Starting…") }
    var ready by remember { mutableStateOf(false) }

    DisposableEffect(Unit) {
        // Configured on the main thread after construction returns — the init
        // callback can fire synchronously from inside the constructor, before
        // the reference exists. See `VoiceAssistant.prepareSpeech`.
        val handler = Handler(Looper.getMainLooper())
        var created: TextToSpeech? = null
        created = TextToSpeech(context) { result ->
            handler.post {
                val tts = created
                if (result != TextToSpeech.SUCCESS || tts == null) {
                    status = "No text-to-speech engine on this device"
                    ready = false
                    return@post
                }
                tts.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                val indian = tts.setLanguage(Locale("en", "IN"))
                if (indian == TextToSpeech.LANG_MISSING_DATA ||
                    indian == TextToSpeech.LANG_NOT_SUPPORTED
                ) {
                    tts.language = Locale.UK
                }

                val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
                val volume = audio?.getStreamVolume(AudioManager.STREAM_MUSIC) ?: -1
                val max = audio?.getStreamMaxVolume(AudioManager.STREAM_MUSIC) ?: -1
                val voice = tts.voice?.locale?.toLanguageTag() ?: "default voice"

                engine = tts
                ready = true
                status = buildString {
                    append(voice)
                    if (volume >= 0) append(" · volume $volume/$max")
                    if (volume == 0) append(" · MUTED")
                }
            }
        }

        onDispose {
            created?.stop()
            created?.shutdown()
            engine = null
        }
    }

    return SpeechCheck(
        ready = ready,
        status = status,
        test = {
            engine?.speak(
                "Spoken directions are working. In four hundred metres, turn left.",
                TextToSpeech.QUEUE_FLUSH,
                null,
                "saarthi-speech-check",
            )
        },
    )
}

@Composable
private fun ToggleRow(
    label: String,
    checked: Boolean,
    enabled: Boolean = true,
    onChange: (Boolean) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = if (enabled) {
                MaterialTheme.colorScheme.onSurface
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}
