package com.saarthi.terminal.ui.screens

import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material.icons.rounded.DirectionsCar
import androidx.compose.material.icons.rounded.LocalGasStation
import androidx.compose.material.icons.rounded.Logout
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.Sos
import androidx.compose.material.icons.rounded.Storefront
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.saarthi.terminal.domain.AssistantState
import com.saarthi.terminal.domain.TerminalState
import com.saarthi.terminal.telemetry.Metric
import androidx.compose.foundation.Image
import com.saarthi.terminal.ui.AiBlob
import com.saarthi.terminal.ui.ConnectionBanner
import com.saarthi.terminal.ui.GlassCard
import com.saarthi.terminal.ui.Gutter
import com.saarthi.terminal.ui.LivePulse
import com.saarthi.terminal.ui.Readout
import com.saarthi.terminal.ui.SaarthiDanger
import com.saarthi.terminal.ui.SaarthiSuccess
import com.saarthi.terminal.ui.SaarthiWarning
import com.saarthi.terminal.ui.LocalDarkCockpit
import com.saarthi.terminal.ui.SolidCard
import com.saarthi.terminal.ui.StatusTone
import com.saarthi.terminal.ui.TerminalMap
import com.saarthi.terminal.ui.TerminalViewModel
import com.saarthi.terminal.ui.TouchTarget
import com.saarthi.terminal.voice.VoiceAssistant

/**
 * The cockpit (specification sections 22, 23 and 56).
 *
 * Map-first, with a strip of numbers under it and a small set of destinations.
 * The layout does one thing that matters more than anything else on it: **it
 * changes when the vehicle starts moving.**
 *
 * Stationary, the driver gets everything — services, the vehicle's own screens,
 * maintenance, documents, sign-off. Moving, most of that disappears and what is
 * left is speed, the map, warnings, SOS and the assistant. That is not a
 * simplification for its own sake; it is section 23's rule that the interface
 * must not encourage complex interaction while driving, and the honest way to
 * honour it is to take the complex interactions away rather than to hope nobody
 * uses them.
 *
 * SOS and the assistant are the two things that survive every layout, because
 * they are the two things somebody might need in the second they most cannot
 * navigate a menu.
 *
 * **It also changes with the screen.** `expanded` was accepted here and then
 * ignored, so a 6-inch phone got a 10-inch dash layout: four large readouts
 * side by side in a row that cannot wrap, squeezed until the speed had no room
 * to render and the labels folded under each other. On a compact width the
 * instruments become a two-by-two grid and the tertiary ones move to the
 * Vehicle sheet, where there is room to read them.
 */
@Composable
fun CockpitScreen(
    viewModel: TerminalViewModel,
    expanded: Boolean,
    onOpenAdmin: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val assistant by viewModel.assistant.collectAsState()
    val sosArmed by viewModel.sosArmed.collectAsState()
    val sosReference by viewModel.sosReference.collectAsState()
    val selfie by viewModel.selfie.collectAsState()

    var sheet by remember { mutableStateOf<CockpitSheet?>(null) }

    /*
     * Whether the camera is still tracking the vehicle.
     *
     * A driver looking ahead down the route drags the map; the next GPS fix used
     * to yank it straight back, which made looking ahead impossible. Panning now
     * stops the tracking and raises the recentre control, and only the driver
     * turns it back on.
     */
    var followVehicle by remember { mutableStateOf(true) }

    val moving = state.moving
    val darkCockpit = LocalDarkCockpit.current
    // Chrome sits on the map, not on a surface, so it picks its own ink. Over a
    // light basemap under a light scrim, white text is invisible.
    val chromeInk = if (darkCockpit) Color.White else Color(0xFF0B1020)
    val telemetry = state.telemetry
    val context = LocalContext.current
    val route by viewModel.route.collectAsState()

    /*
     * The next instruction, recomputed as the vehicle moves.
     *
     * Derived on the device from a route it already holds, so a driver keeps
     * being told where to turn inside a tunnel. `telemetry.at` is the dependency
     * rather than the position itself: it changes on every fix, including one
     * that lands on the same coordinates.
     */
    val nextTurn = remember(route, telemetry.at) { viewModel.nextManeuver() }

    /*
     * Voice.
     *
     * Created here rather than in the application object because it holds a
     * microphone: it exists for exactly as long as the cockpit is on screen, and
     * a driver who signs off gets the recogniser released with the screen rather
     * than left running for the rest of the shift.
     *
     * `onWake` only changes the blob. The utterance itself goes to the view
     * model, which classifies an emergency locally before anything is sent.
     */
    val voice = remember {
        VoiceAssistant(
            context = context,
            onWake = { viewModel.setAssistantState(AssistantState.LISTENING) },
            onUtterance = { heard -> viewModel.ask(heard, spoken = true) },
        )
    }
    val voiceAmplitude by voice.amplitude.collectAsState()

    DisposableEffect(viewModel.settings.wakeWordEnabled) {
        // Off unless the fleet turned it on. Continuous listening costs battery
        // and, more to the point, is a microphone left on in a space where people
        // have private conversations.
        if (viewModel.settings.wakeWordEnabled) voice.start()
        onDispose { voice.stop() }
    }

    // Read the answer aloud when the question was asked aloud. A driver who
    // spoke to the terminal is a driver who cannot look at it.
    LaunchedEffect(assistant.answer) {
        val answer = assistant.answer
        if (answer != null && assistant.state == AssistantState.SPEAKING) {
            voice.speak(answer)
        }
    }

    Box(Modifier.fillMaxSize()) {
        // --- Map ------------------------------------------------------------
        TerminalMap(
            position = telemetry.position,
            headingDegrees = telemetry.value(Metric.HEADING),
            driving = moving,
            routeGeometry = route?.geometry?.map { it.latitude to it.longitude } ?: emptyList(),
            destination = route?.destination?.let { it.latitude to it.longitude },
            followVehicle = followVehicle,
            onUserPannedMap = { followVehicle = false },
            modifier = Modifier.fillMaxSize(),
        )

        /*
         * A scrim under the top and bottom chrome so the header stays readable
         * over a bright basemap. Cheaper and far more reliable than a blur, and
         * it does not fail on a low-end tablet.
         *
         * It follows the theme. A black scrim under dark text — which is what a
         * light cockpit uses — hid the registration number behind the very thing
         * meant to reveal it.
         */
        val scrim = if (darkCockpit) Color.Black else Color.White
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0f to scrim.copy(alpha = if (darkCockpit) 0.55f else 0.82f),
                        0.22f to Color.Transparent,
                        0.62f to Color.Transparent,
                        1f to scrim.copy(alpha = if (darkCockpit) 0.75f else 0.55f),
                    ),
                ),
        )

        Column(
            Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .padding(Gutter),
        ) {
            // --- Header -----------------------------------------------------
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        state.registration ?: "SAARTHI",
                        style = MaterialTheme.typography.titleLarge,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        color = chromeInk,
                    )
                    Spacer(Modifier.width(10.dp))
                    LivePulse(
                        active = !state.offline,
                        tone = if (state.offline) StatusTone.WARN else StatusTone.GOOD,
                    )
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    state.server?.health?.batteryPercent?.let { battery ->
                        Text(
                            "$battery%",
                            style = MaterialTheme.typography.titleMedium,
                            color = if (battery <= 15) SaarthiWarning else chromeInk,
                        )
                        Spacer(Modifier.width(12.dp))
                    }

                    /*
                     * The arrival photo.
                     *
                     * The driver photographed themselves to be let onto this
                     * vehicle and the terminal then never showed it, so nobody
                     * walking up to the cab could see who the tablet believes is
                     * driving — which is the entire point of having taken it.
                     *
                     * Rendered from bytes the terminal fetched with its own
                     * credential. The session's `selfieUrl` points at the media
                     * endpoint, which authenticates a person, not a device: the
                     * tablet knew that URL and was refused at it every time.
                     *
                     * Absent is a normal state — an older session, a photo still
                     * uploading — and it falls back to the name alone rather
                     * than to a placeholder that looks like a fault.
                     */
                    selfie?.let { bitmap ->
                        Image(
                            bitmap = bitmap.asImageBitmap(),
                            contentDescription =
                                "Arrival photo of ${state.driverName ?: "the driver"}",
                            contentScale = ContentScale.Crop,
                            modifier = Modifier
                                .size(34.dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.surfaceVariant),
                        )
                        Spacer(Modifier.width(8.dp))
                    }

                    Text(
                        state.driverName ?: "",
                        style = MaterialTheme.typography.bodyMedium,
                        color = chromeInk.copy(alpha = 0.85f),
                    )
                    if (!moving) {
                        IconButton(onClick = onOpenAdmin) {
                            Icon(
                                Icons.Rounded.Build,
                                contentDescription = "Terminal diagnostics",
                                tint = chromeInk.copy(alpha = 0.8f),
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(10.dp))

            ConnectionBanner(offline = state.offline, pendingUploads = state.pendingUploads)

            // --- Next turn --------------------------------------------------
            //
            // Directly under the header, the largest thing on the screen after
            // the speed. Section 22 puts the next instruction on the map, and a
            // driver glancing up needs to read it in the time a glance takes.
            route?.let { current ->
                Spacer(Modifier.height(10.dp))
                NavigationBanner(
                    route = current,
                    next = nextTurn,
                    onCancel = { viewModel.clearRoute() },
                )
            }

            Spacer(Modifier.weight(1f))

            /*
             * Back to the vehicle.
             *
             * Shown only once the driver has panned away, because a control that
             * is always there is a control that is always in the way — and while
             * the camera is following, it would do nothing.
             */
            AnimatedVisibility(visible = !followVehicle) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Surface(
                        onClick = { followVehicle = true },
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.surface,
                        shadowElevation = 8.dp,
                        modifier = Modifier.size(TouchTarget),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                Icons.Rounded.MyLocation,
                                contentDescription = "Centre the map on this vehicle",
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
            }

            // --- Emergency confirmation ------------------------------------
            AnimatedVisibility(visible = sosArmed) {
                SosConfirmation(
                    onConfirm = { viewModel.triggerSos() },
                    onCancel = { viewModel.cancelSos() },
                )
            }

            sosReference?.let { reference ->
                Surface(
                    color = SaarthiDanger.copy(alpha = 0.9f),
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(Gutter)) {
                        Text(
                            "Emergency raised · $reference",
                            style = MaterialTheme.typography.titleMedium,
                            color = Color.White,
                        )
                        Text(
                            "Your fleet and nearby responders have been alerted. Stay where you are if it is safe.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color.White.copy(alpha = 0.9f),
                        )
                    }
                }
                Spacer(Modifier.height(Gutter))
            }

            // --- Assistant answer -------------------------------------------
            assistant.answer?.let { answer ->
                Surface(
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
                    shape = RoundedCornerShape(18.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { viewModel.dismissAssistant() },
                ) {
                    Column(Modifier.padding(Gutter)) {
                        assistant.transcript?.let {
                            Text(
                                "“$it”",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(Modifier.height(6.dp))
                        }
                        Text(answer, style = MaterialTheme.typography.titleMedium)
                        // Caveats are shown, not summarised away. A tool that had
                        // to cap or skip something said so, and the driver is the
                        // person who needs to know.
                        assistant.caveats.forEach { caveat ->
                            Spacer(Modifier.height(6.dp))
                            Text(
                                caveat,
                                style = MaterialTheme.typography.bodyMedium,
                                color = SaarthiWarning,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(Gutter))
            }

            // --- Instruments ------------------------------------------------
            Instruments(
                telemetry = telemetry,
                fallbackOdometerKm = state.server?.vehicle?.odometerKm,
                expanded = expanded,
            )

            Spacer(Modifier.height(Gutter))

            // --- Actions ----------------------------------------------------
            //
            // The layout's one real decision. Moving, this collapses to SOS and
            // the assistant; stationary, the driver gets everywhere they might
            // need to go.
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!moving) {
                    CockpitAction(
                        icon = Icons.Rounded.Storefront,
                        label = "Services",
                        modifier = Modifier.weight(1f),
                        onClick = { sheet = CockpitSheet.SERVICES },
                    )
                    CockpitAction(
                        icon = Icons.Rounded.DirectionsCar,
                        label = "Vehicle",
                        modifier = Modifier.weight(1f),
                        onClick = { sheet = CockpitSheet.VEHICLE },
                    )
                    CockpitAction(
                        icon = Icons.Rounded.Logout,
                        label = if (state.state == TerminalState.TRIP_ACTIVE) {
                            "End trip"
                        } else {
                            "Sign off"
                        },
                        modifier = Modifier.weight(1f),
                        onClick = {
                            if (state.state == TerminalState.TRIP_ACTIVE) {
                                viewModel.completeTrip()
                            } else {
                                viewModel.endSession()
                            }
                        },
                    )
                } else {
                    // Moving: one affordance, and it is fuel. A driver at speed
                    // asking for anything else should be asking out loud.
                    CockpitAction(
                        icon = Icons.Rounded.LocalGasStation,
                        label = "Fuel nearby",
                        modifier = Modifier.weight(1f),
                        onClick = {
                            viewModel.findServices("FUEL")
                            sheet = CockpitSheet.SERVICES
                        },
                    )
                }

                SosButton(
                    armed = sosArmed,
                    onClick = { if (sosArmed) viewModel.triggerSos() else viewModel.armSos() },
                )

                AiBlob(
                    state = assistant.state,
                    size = TouchTarget,
                    amplitude = voiceAmplitude,
                    onClick = {
                        // Tapping starts listening directly when voice is
                        // available; otherwise it opens the sheet, which has a
                        // text field. A terminal with no microphone permission
                        // must still be able to ask a question.
                        if (voice.available) {
                            voice.listenNow()
                            viewModel.setAssistantState(AssistantState.LISTENING)
                        } else {
                            sheet = CockpitSheet.ASSISTANT
                        }
                    },
                )
            }

            if (state.state == TerminalState.READY && !moving) {
                Spacer(Modifier.height(12.dp))
                Surface(
                    color = SaarthiSuccess.copy(alpha = if (darkCockpit) 0.16f else 0.22f),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { viewModel.startTrip() },
                ) {
                    Text(
                        "Safety check complete — tap to start your trip",
                        Modifier.padding(14.dp),
                        style = MaterialTheme.typography.titleMedium,
                        color = SaarthiSuccess,
                    )
                }
            }
        }

        // --- Sheets -----------------------------------------------------------
        when (sheet) {
            CockpitSheet.SERVICES -> ServicesSheet(viewModel) { sheet = null }
            CockpitSheet.VEHICLE -> VehicleSheet(viewModel) { sheet = null }
            CockpitSheet.ASSISTANT -> AssistantSheet(viewModel) { sheet = null }
            null -> Unit
        }
    }
}

internal enum class CockpitSheet { SERVICES, VEHICLE, ASSISTANT }

/**
 * The instrument panel, laid out for the screen it is on.
 *
 * On a dash-sized display all four readings sit in one row, which is what a
 * driver glancing down wants: one horizontal sweep, no scanning.
 *
 * On a phone that same row has roughly 90dp per reading. The speed alone needs
 * more than that at the size it has to be, so the row squeezed every child until
 * the numbers had no room and the labels wrapped underneath each other — which
 * is exactly what a driver was shown. Compact width therefore gets speed on its
 * own line at full size, with fuel and coolant beneath it, and the odometer
 * moves to the Vehicle sheet: it is a number nobody reads while driving, and
 * dropping it is better than shrinking the three that matter.
 *
 * Glass rather than a solid card. These readings sit over the map, and the
 * frosted panel keeps the road visible underneath while holding contrast for
 * the figures on top.
 */
@Composable
private fun Instruments(
    telemetry: com.saarthi.terminal.telemetry.TelemetrySnapshot,
    fallbackOdometerKm: Double?,
    expanded: Boolean,
) {
    val speed = telemetry.value(Metric.SPEED)?.let { it.toInt().toString() }
    val fuel = telemetry.value(Metric.FUEL_LEVEL)?.let { it.toInt().toString() }
    val coolant = telemetry.value(Metric.COOLANT_TEMPERATURE)?.let { it.toInt().toString() }
    val odometer = (telemetry.value(Metric.ODOMETER) ?: fallbackOdometerKm)
        ?.let { "%,d".format(it.toLong()) }

    GlassCard(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = if (expanded) Gutter else 12.dp,
    ) {
        if (expanded) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Readout(
                    label = "Speed",
                    value = speed,
                    unit = "km/h",
                    large = true,
                    simulated = telemetry.isSimulated(Metric.SPEED),
                )
                Readout(
                    label = "Fuel",
                    value = fuel,
                    unit = "%",
                    tone = fuelTone(telemetry.value(Metric.FUEL_LEVEL)),
                    simulated = telemetry.isSimulated(Metric.FUEL_LEVEL),
                )
                Readout(
                    label = "Coolant",
                    value = coolant,
                    unit = "°C",
                    tone = coolantTone(telemetry.value(Metric.COOLANT_TEMPERATURE)),
                    simulated = telemetry.isSimulated(Metric.COOLANT_TEMPERATURE),
                )
                Readout(
                    label = "Odometer",
                    value = odometer,
                    unit = "km",
                    simulated = telemetry.isSimulated(Metric.ODOMETER),
                )
            }
            return@GlassCard
        }

        Readout(
            label = "Speed",
            value = speed,
            unit = "km/h",
            large = true,
            simulated = telemetry.isSimulated(Metric.SPEED),
        )

        Spacer(Modifier.height(12.dp))

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Readout(
                label = "Fuel",
                value = fuel,
                unit = "%",
                tone = fuelTone(telemetry.value(Metric.FUEL_LEVEL)),
                simulated = telemetry.isSimulated(Metric.FUEL_LEVEL),
                modifier = Modifier.weight(1f),
            )
            Readout(
                label = "Coolant",
                value = coolant,
                unit = "°C",
                tone = coolantTone(telemetry.value(Metric.COOLANT_TEMPERATURE)),
                simulated = telemetry.isSimulated(Metric.COOLANT_TEMPERATURE),
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun CockpitAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(
        modifier = modifier
            .height(TouchTarget)
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(8.dp))
            Text(label, style = MaterialTheme.typography.labelLarge, maxLines = 1)
        }
    }
}

/**
 * The emergency control (specification section 36).
 *
 * Always present, in every layout, at the same place on the screen — a driver
 * reaching for it in an emergency should not have to look for it.
 *
 * Two taps rather than one. A large red button on a screen mounted beside a gear
 * lever gets pressed by a coat sleeve, and a false emergency costs a responder a
 * journey and teaches a fleet to distrust the alarm. Arming is the first tap and
 * firing is a deliberate second one; the voice path skips this entirely, because
 * somebody who has said "Hey Saarthi, SOS" out loud has already been deliberate.
 */
@Composable
private fun SosButton(armed: Boolean, onClick: () -> Unit) {
    Surface(
        modifier = Modifier
            .size(TouchTarget)
            .clip(CircleShape)
            .clickable(onClick = onClick),
        shape = CircleShape,
        color = if (armed) SaarthiDanger else SaarthiDanger.copy(alpha = 0.85f),
        border = if (armed) {
            androidx.compose.foundation.BorderStroke(3.dp, Color.White)
        } else {
            null
        },
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                Icons.Rounded.Sos,
                contentDescription = if (armed) "Confirm emergency" else "Emergency",
                tint = Color.White,
                modifier = Modifier.size(30.dp),
            )
        }
    }
}

@Composable
private fun SosConfirmation(onConfirm: () -> Unit, onCancel: () -> Unit) {
    Surface(
        color = SaarthiDanger,
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(Gutter)) {
            Text(
                "Raise an emergency?",
                style = MaterialTheme.typography.titleLarge,
                color = Color.White,
            )
            Text(
                "Your fleet, nearby Saarthi vehicles and your truck association will be alerted with your location.",
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = 0.92f),
            )
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Surface(
                    modifier = Modifier
                        .weight(1f)
                        .height(TouchTarget)
                        .clickable(onClick = onCancel),
                    shape = RoundedCornerShape(12.dp),
                    color = Color.White.copy(alpha = 0.2f),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text("Cancel", color = Color.White, style = MaterialTheme.typography.titleMedium)
                    }
                }
                Surface(
                    modifier = Modifier
                        .weight(1f)
                        .height(TouchTarget)
                        .clickable(onClick = onConfirm),
                    shape = RoundedCornerShape(12.dp),
                    color = Color.White,
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            "Raise emergency",
                            color = SaarthiDanger,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }
    Spacer(Modifier.height(Gutter))
}

private fun fuelTone(value: Double?): StatusTone = when {
    value == null -> StatusTone.NEUTRAL
    value <= 8 -> StatusTone.CRITICAL
    value <= 20 -> StatusTone.WARN
    else -> StatusTone.NEUTRAL
}

private fun coolantTone(value: Double?): StatusTone = when {
    value == null -> StatusTone.NEUTRAL
    value >= 108 -> StatusTone.CRITICAL
    value >= 100 -> StatusTone.WARN
    else -> StatusTone.NEUTRAL
}
