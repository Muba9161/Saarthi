package com.saarthi.terminal.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.LocalGasStation
import androidx.compose.material.icons.rounded.LocalHospital
import androidx.compose.material.icons.rounded.LocalParking
import androidx.compose.material.icons.rounded.LocalPolice
import androidx.compose.material.icons.rounded.Navigation
import androidx.compose.material.icons.rounded.Restaurant
import androidx.compose.material.icons.rounded.Scale
import androidx.compose.material.icons.rounded.Send
import androidx.compose.material.icons.rounded.TireRepair
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.saarthi.terminal.domain.AssistantState
import com.saarthi.terminal.network.IssueDto
import com.saarthi.terminal.network.NearbyPlaceDto
import com.saarthi.terminal.telemetry.Metric
import com.saarthi.terminal.ui.AiBlob
import com.saarthi.terminal.ui.Gutter
import com.saarthi.terminal.ui.PrimaryAction
import com.saarthi.terminal.ui.Readout
import com.saarthi.terminal.ui.SaarthiWarning
import com.saarthi.terminal.ui.SectionLabel
import com.saarthi.terminal.ui.SolidCard
import com.saarthi.terminal.ui.StatusTone
import com.saarthi.terminal.ui.TerminalViewModel

/**
 * The screens that sit over the cockpit.
 *
 * Overlays rather than routes, deliberately: the map keeps running underneath,
 * every one of them closes with a single large control, and there is no back
 * stack a driver can get lost in. A dismissal is one tap from anywhere on the
 * sheet's header, which is the gesture somebody makes when the lights change.
 *
 * All three are reachable only when the vehicle is stationary — the cockpit does
 * not offer them while moving (section 23) — with one exception: the assistant,
 * because talking is the interaction that *is* safe at speed.
 */

@Composable
private fun Sheet(
    title: String,
    onClose: () -> Unit,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.55f))
            // Tapping the scrim closes. A driver reaching past a panel to get
            // back to the map should not have to find a button.
            .clickable(onClick = onClose),
    ) {
        Surface(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .fillMaxHeight(0.88f)
                // Consumes the click so a tap inside the sheet does not dismiss it.
                .clickable(enabled = false) {},
            shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
            color = MaterialTheme.colorScheme.background,
        ) {
            Column(
                Modifier
                    .fillMaxSize()
                    .systemBarsPadding()
                    .padding(Gutter),
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(title, style = MaterialTheme.typography.headlineSmall)
                    IconButton(onClick = onClose) {
                        Icon(Icons.Rounded.Close, contentDescription = "Close")
                    }
                }
                Spacer(Modifier.height(12.dp))
                content()
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Services (specification sections 28 and 29)
// ---------------------------------------------------------------------------

private data class ServiceChip(val key: String, val label: String, val icon: ImageVector)

private val SERVICE_CHIPS = listOf(
    ServiceChip("FUEL", "Fuel", Icons.Rounded.LocalGasStation),
    ServiceChip("MECHANIC", "Mechanic", Icons.Rounded.Build),
    ServiceChip("TYRE", "Tyres", Icons.Rounded.TireRepair),
    ServiceChip("PARKING", "Parking", Icons.Rounded.LocalParking),
    ServiceChip("FOOD", "Food & rest", Icons.Rounded.Restaurant),
    ServiceChip("HOSPITAL", "Hospital", Icons.Rounded.LocalHospital),
    ServiceChip("POLICE", "Police", Icons.Rounded.LocalPolice),
    ServiceChip("WEIGHBRIDGE", "Weighbridge", Icons.Rounded.Scale),
)

@Composable
fun ServicesSheet(viewModel: TerminalViewModel, onClose: () -> Unit) {
    val places by viewModel.places.collectAsState()
    val busy by viewModel.busy.collectAsState()
    val error by viewModel.lastError.collectAsState()
    val roadDistances by viewModel.roadDistances.collectAsState()
    val routingNote by viewModel.routingNote.collectAsState()
    var selected by remember { mutableStateOf("FUEL") }

    LaunchedEffect(selected) { viewModel.findServices(selected) }

    Sheet("Nearby services", onClose) {
        Row(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SERVICE_CHIPS.forEach { chip ->
                Surface(
                    modifier = Modifier
                        .height(48.dp)
                        .clickable { selected = chip.key },
                    shape = RoundedCornerShape(999.dp),
                    color = if (selected == chip.key) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.surfaceVariant
                    },
                ) {
                    Row(
                        Modifier.padding(horizontal = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            chip.icon,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                            tint = if (selected == chip.key) {
                                MaterialTheme.colorScheme.onPrimary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            chip.label,
                            style = MaterialTheme.typography.labelLarge,
                            color = if (selected == chip.key) {
                                MaterialTheme.colorScheme.onPrimary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(Gutter))

        /*
         * Said once, at the top.
         *
         * When routing is unavailable every row already reads "3.2 km direct",
         * but a driver scanning a list does not stop to parse a suffix — the
         * banner is what makes them read the numbers correctly.
         */
        if (!roadDistances) {
            Surface(
                color = SaarthiWarning.copy(alpha = 0.14f),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    routingNote
                        ?: "Showing direct distances. The real drive is longer, sometimes much longer.",
                    Modifier.padding(14.dp),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Spacer(Modifier.height(Gutter))
        }

        /*
         * Why the last tap did nothing.
         *
         * Choosing a destination can fail for reasons the driver can act on —
         * routing not configured on this Saarthi instance, no position fix yet,
         * no drivable road to a place the map happily shows. All of them used to
         * land in the log and nowhere else: the row was tapped, the sheet stayed
         * open, and nothing on screen changed. A driver reads that as a broken
         * button, taps it again, and gets the same silence.
         */
        error?.let { message ->
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    message,
                    Modifier.padding(14.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
            }
            Spacer(Modifier.height(Gutter))
        }

        if (busy && places.isEmpty()) {
            Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Sheet
        }

        if (places.isEmpty()) {
            Text(
                "Nothing found nearby. Saarthi needs a recent position for this vehicle to search around it.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            return@Sheet
        }

        LazyColumn(
            state = rememberLazyListState(),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(places, key = { it.id }) { place ->
                PlaceRow(place) {
                    viewModel.navigateTo(place) { routed -> if (routed) onClose() }
                }
            }

            item {
                Spacer(Modifier.height(8.dp))
                // Required by the ODbL wherever OpenStreetMap data is shown, and
                // the same credit the web app carries.
                Text(
                    "Places from OpenStreetMap contributors. Details may be out of date — call ahead if you are relying on one.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/**
 * One place, with the distance the driver will actually cover.
 *
 * The wording carries the distinction rather than hiding it. A road distance is
 * "3.2 km · 7 min"; a straight-line one is "3.2 km direct" with no time, because
 * there is no honest driving time to attach to a crow-flies measurement. A
 * driver on a quarter tank acts on this number, and the gap between the two
 * kinds can be a factor of three around a river or a motorway.
 */
@Composable
private fun PlaceRow(place: NearbyPlaceDto, onNavigate: () -> Unit) {
    SolidCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(place.name, style = MaterialTheme.typography.titleMedium)
                Text(
                    listOfNotNull(
                        place.address,
                        if (place.open24Hours) "Open 24 h" else place.openingHours,
                    ).joinToString(" · ").ifBlank { place.category.humanise() },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (place.distance.isRoad) {
                    // Shown only when it differs meaningfully. Repeating an almost
                    // identical figure is noise; a 900 m straight line against a
                    // 6 km drive tells the driver they are the wrong side of
                    // something.
                    val detour = place.distance.km - place.straightLineKm
                    if (detour > 0.5) {
                        Text(
                            "%.1f km direct".format(place.straightLineKm),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            Column(
                horizontalAlignment = Alignment.End,
                modifier = Modifier.padding(end = 12.dp),
            ) {
                Text(
                    if (place.distance.isRoad) {
                        "%.1f km".format(place.distance.km)
                    } else {
                        "%.1f km direct".format(place.distance.km)
                    },
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    place.distance.durationMinutes?.let { "$it min · ${place.direction}" }
                        ?: place.direction,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Surface(
                modifier = Modifier
                    .size(52.dp)
                    .clickable(onClick = onNavigate),
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.primary,
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Rounded.Navigation,
                        contentDescription = "Navigate to ${place.name}",
                        tint = MaterialTheme.colorScheme.onPrimary,
                        modifier = Modifier.size(24.dp),
                    )
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Vehicle (specification sections 24, 25, 26 and 27)
// ---------------------------------------------------------------------------

@Composable
fun VehicleSheet(viewModel: TerminalViewModel, onClose: () -> Unit) {
    val state by viewModel.uiState.collectAsState()
    val issues by viewModel.issues.collectAsState()
    val busy by viewModel.busy.collectAsState()

    var reporting by remember { mutableStateOf(false) }
    var category by remember { mutableStateOf("ENGINE") }
    var description by remember { mutableStateOf("") }

    LaunchedEffect(Unit) { viewModel.loadIssues() }

    val vehicle = state.server?.vehicle
    val driver = state.server?.session?.driver
    val telemetry = state.telemetry

    Sheet(vehicle?.registrationNumber ?: "Vehicle", onClose) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Gutter),
        ) {
            // --- Live data ---------------------------------------------------
            SolidCard(Modifier.fillMaxWidth()) {
                SectionLabel("Live vehicle data")
                Spacer(Modifier.height(12.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Readout(
                        "Engine",
                        telemetry.value(Metric.RPM)?.toInt()?.toString(),
                        unit = "rpm",
                        simulated = telemetry.isSimulated(Metric.RPM),
                    )
                    Readout(
                        "Battery",
                        telemetry.value(Metric.BATTERY_VOLTAGE)?.let { "%.1f".format(it) },
                        unit = "V",
                        simulated = telemetry.isSimulated(Metric.BATTERY_VOLTAGE),
                    )
                    Readout(
                        "Load",
                        telemetry.value(Metric.ENGINE_LOAD)?.toInt()?.toString(),
                        unit = "%",
                        simulated = telemetry.isSimulated(Metric.ENGINE_LOAD),
                    )
                }

                if (telemetry.diagnostics.isNotEmpty()) {
                    Spacer(Modifier.height(Gutter))
                    SectionLabel("Trouble codes")
                    telemetry.diagnostics.forEach { code ->
                        Row(Modifier.padding(top = 6.dp)) {
                            Text(
                                code.code,
                                fontFamily = FontFamily.Monospace,
                                style = MaterialTheme.typography.titleMedium,
                                color = SaarthiWarning,
                            )
                            Spacer(Modifier.width(10.dp))
                            Text(
                                code.description ?: "No description",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            // --- Passport ----------------------------------------------------
            SolidCard(Modifier.fillMaxWidth()) {
                SectionLabel("Vehicle passport")
                Spacer(Modifier.height(12.dp))
                PassportRow("Registration", vehicle?.registrationNumber)
                PassportRow("Type", vehicle?.vehicleType?.humanise())
                PassportRow(
                    "Make & model",
                    listOfNotNull(vehicle?.manufacturer, vehicle?.model)
                        .joinToString(" ").ifBlank { null },
                )
                PassportRow("Year", vehicle?.year?.toString())
                PassportRow("Fuel", vehicle?.fuelType?.humanise())
                PassportRow("Capacity", vehicle?.capacityTons?.let { "$it t" })
                PassportRow("Odometer", vehicle?.odometerKm?.let { "%,d km".format(it.toLong()) })
                PassportRow("Fleet", vehicle?.organizationName)
            }

            // --- Driver ------------------------------------------------------
            SolidCard(Modifier.fillMaxWidth()) {
                SectionLabel("You")
                Spacer(Modifier.height(12.dp))
                PassportRow("Name", driver?.name)
                PassportRow("Licence class", driver?.licenseClass)
                PassportRow("Licence", driver?.licenseValidity?.humanise())
                PassportRow("Profile", driver?.verificationStatus?.humanise())
                PassportRow("Trips", driver?.totalTrips?.toString())
                // Deliberately not the licence number, the address or the date of
                // birth. Section 25: the driver sees their own authorised
                // information, and a screen bolted inside a cab is not where any
                // of those belong.
            }

            // --- Issues ------------------------------------------------------
            SolidCard(Modifier.fillMaxWidth()) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    SectionLabel("Reported problems")
                    Text(
                        if (reporting) "Cancel" else "Report a problem",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.clickable { reporting = !reporting },
                    )
                }

                if (reporting) {
                    Spacer(Modifier.height(12.dp))
                    Row(
                        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        listOf(
                            "ENGINE", "TYRE", "BRAKE", "ELECTRICAL", "ACCIDENT", "BODY", "OTHER",
                        ).forEach { option ->
                            Surface(
                                modifier = Modifier
                                    .height(44.dp)
                                    .clickable { category = option },
                                shape = RoundedCornerShape(999.dp),
                                color = if (category == option) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.surfaceVariant
                                },
                            ) {
                                Box(
                                    Modifier.padding(horizontal = 14.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        option.humanise(),
                                        style = MaterialTheme.typography.labelLarge,
                                        color = if (category == option) {
                                            MaterialTheme.colorScheme.onPrimary
                                        } else {
                                            MaterialTheme.colorScheme.onSurfaceVariant
                                        },
                                    )
                                }
                            }
                        }
                    }

                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = description,
                        onValueChange = { description = it },
                        label = { Text("What is wrong?") },
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 3,
                    )
                    Spacer(Modifier.height(12.dp))
                    PrimaryAction(
                        label = if (busy) "Sending…" else "Send to your fleet",
                        enabled = !busy && description.trim().length >= 3,
                        tone = StatusTone.WARN,
                        onClick = {
                            viewModel.reportIssue(category, description.trim()) { ok ->
                                if (ok) {
                                    description = ""
                                    reporting = false
                                }
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                Spacer(Modifier.height(12.dp))

                if (issues.isEmpty()) {
                    Text(
                        "Nothing reported for this vehicle.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    issues.take(5).forEach { issue -> IssueRow(issue) }
                }
            }

            Spacer(Modifier.height(Gutter))
        }
    }
}

@Composable
private fun IssueRow(issue: IssueDto) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Column(Modifier.weight(1f)) {
            Text(
                "${issue.category.humanise()} · ${issue.status.humanise()}",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(issue.description, style = MaterialTheme.typography.bodyMedium, maxLines = 2)
        }
    }
}

@Composable
private fun PassportRow(label: String, value: String?) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 5.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(value ?: "—", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
    }
}

// ---------------------------------------------------------------------------
// Assistant (specification sections 30, 34 and 35)
// ---------------------------------------------------------------------------

@Composable
fun AssistantSheet(viewModel: TerminalViewModel, onClose: () -> Unit) {
    val assistant by viewModel.assistant.collectAsState()
    var typed by remember { mutableStateOf("") }

    Sheet("Saarthi", onClose) {
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            AiBlob(state = assistant.state, size = 120.dp)
            Spacer(Modifier.height(16.dp))

            Text(
                when (assistant.state) {
                    AssistantState.IDLE -> "Say “Hey Saarthi”, or type below."
                    AssistantState.LISTENING -> "Listening…"
                    AssistantState.THINKING -> "Working on it…"
                    AssistantState.SPEAKING -> "Here is what I found."
                    AssistantState.ERROR -> "I could not answer that."
                },
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Spacer(Modifier.height(Gutter))

        assistant.transcript?.let {
            Text(
                "“$it”",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(8.dp))
        }

        assistant.answer?.let { answer ->
            SolidCard(Modifier.fillMaxWidth()) {
                Text(answer, style = MaterialTheme.typography.titleMedium)

                assistant.caveats.forEach { caveat ->
                    Spacer(Modifier.height(8.dp))
                    Text(caveat, style = MaterialTheme.typography.bodyMedium, color = SaarthiWarning)
                }

                if (assistant.sources.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    // Provenance, shown rather than implied. A driver deciding
                    // whether to trust "your fitness certificate expires in six
                    // days" deserves to see that it came from a records lookup
                    // and not from a model's impression.
                    Text(
                        "From: ${assistant.sources.joinToString(", ") { it.replace('_', ' ') }}",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        Spacer(Modifier.weight(1f))

        SectionLabel("Try asking")
        Spacer(Modifier.height(8.dp))
        listOf(
            "Is my vehicle okay?",
            "What is my current fuel level?",
            "When is my next service?",
            "Find truck parking near me",
        ).forEach { suggestion ->
            Text(
                "“$suggestion”",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { viewModel.ask(suggestion, spoken = false) }
                    .padding(vertical = 10.dp),
            )
        }

        Spacer(Modifier.height(Gutter))

        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = typed,
                onValueChange = { typed = it },
                label = { Text("Ask Saarthi") },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
            Spacer(Modifier.width(10.dp))
            IconButton(
                onClick = {
                    if (typed.isNotBlank()) {
                        viewModel.ask(typed.trim(), spoken = false)
                        typed = ""
                    }
                },
                modifier = Modifier.size(56.dp),
            ) {
                Icon(Icons.Rounded.Send, contentDescription = "Send")
            }
        }
    }
}
