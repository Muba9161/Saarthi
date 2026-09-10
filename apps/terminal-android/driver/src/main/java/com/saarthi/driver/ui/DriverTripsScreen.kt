package com.saarthi.driver.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.sp
import com.saarthi.core.network.DriverTripDto
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.CautionAmber
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.CircleAction
import com.saarthi.driver.ui.design.FieldLabel
import com.saarthi.driver.ui.design.FleetCard
import com.saarthi.driver.ui.design.FleetEnter
import com.saarthi.driver.ui.design.FleetRule
import com.saarthi.driver.ui.design.FleetScreen
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.LiveGreen
import com.saarthi.driver.ui.design.SectionHeader
import com.saarthi.driver.ui.design.Slate
import com.saarthi.driver.ui.design.StatusPill
import com.saarthi.driver.ui.design.TrackingCode

/**
 * What this driver has actually run.
 *
 * The question drivers ask most and the one Saarthi could not answer: there was
 * no driver-scoped trip endpoint at all, which is why the dashboard showed no
 * history rather than an invented one.
 *
 * One rule runs through the whole screen: **a planned figure is never shown as
 * a driven one.** A trip still under way has a planned distance and no actual
 * one, and labelling the plan "planned" is the difference between a record a
 * driver can settle a payment against and a number they will be argued out of.
 */
@Composable
fun DriverTripsScreen(
    cockpit: TerminalViewModel,
    onBack: () -> Unit,
) {
    val trips by cockpit.trips.collectAsState()

    LaunchedEffect(Unit) { cockpit.loadTrips() }

    FleetScreen {
        Spacer(Modifier.height(FleetSpace.snug))

        FleetEnter(index = 0) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(FleetSpace.snug),
            ) {
                CircleAction(
                    icon = Icons.AutoMirrored.Rounded.ArrowBack,
                    contentDescription = "Back",
                    onClick = onBack,
                )
                Column(Modifier.weight(1f)) {
                    Text(
                        "Your trips",
                        style = MaterialTheme.typography.titleLarge,
                        color = Chalk,
                    )
                    Text(
                        "The last few weeks of your work, as your fleet recorded it.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                    )
                }
            }
        }

        Spacer(Modifier.height(FleetSpace.base))

        if (trips.isEmpty()) {
            FleetEnter(index = 1) {
                FleetCard(Modifier.fillMaxWidth()) {
                    SectionHeader("No trips yet")
                    Spacer(Modifier.height(FleetSpace.tight))
                    Text(
                        "Trips appear here once you have started and finished one with " +
                            "Saarthi. Anything driven before you began using the app will " +
                            "not be here - Saarthi will not invent a record it does not have.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Ash,
                    )
                }
            }
            return@FleetScreen
        }

        val driven = trips.mapNotNull { trip ->
            trip.distanceKm.takeIf { !trip.distanceIsPlanned }
        }
        if (driven.isNotEmpty()) {
            FleetEnter(index = 1) {
                Column {
                    FleetCard(Modifier.fillMaxWidth()) {
                        FieldLabel("Distance driven, recorded")
                        Spacer(Modifier.height(FleetSpace.hair))
                        Row(verticalAlignment = Alignment.Bottom) {
                            Text(
                                "%,.0f".format(driven.sum()),
                                style = MaterialTheme.typography.headlineMedium,
                                color = Chalk,
                            )
                            Text(
                                " km",
                                style = MaterialTheme.typography.labelSmall,
                                color = Slate,
                            )
                        }
                        Spacer(Modifier.height(FleetSpace.tight))
                        Text(
                            // Says exactly what the total is of, so it cannot be
                            // mistaken for "everything you have ever driven".
                            "Across ${driven.size} finished trip(s) that Saarthi measured. " +
                                "Trips still under way are not counted.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Slate,
                        )
                    }
                    Spacer(Modifier.height(FleetSpace.snug))
                }
            }
        }

        trips.forEachIndexed { index, trip ->
            FleetEnter(index = (index + 2).coerceAtMost(6)) {
                Column {
                    TripRow(trip)
                    Spacer(Modifier.height(FleetSpace.tight))
                }
            }
        }

        Spacer(Modifier.height(FleetSpace.wide))
    }
}

@Composable
private fun TripRow(trip: DriverTripDto) {
    val finished = trip.completedAt != null

    FleetCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                trip.registrationNumber?.let { TrackingCode(it, size = 18.sp) }
                trip.reference?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                        maxLines = 1,
                    )
                }
            }
            StatusPill(
                label = trip.status.humanised(),
                tint = if (finished) LiveGreen else CautionAmber,
                live = !finished,
            )
        }

        Spacer(Modifier.height(FleetSpace.snug))
        FleetRule()
        Spacer(Modifier.height(FleetSpace.snug))

        trip.fromLabel?.let {
            FieldLabel("From")
            Text(it, style = MaterialTheme.typography.bodyMedium, color = Ash, maxLines = 2)
            Spacer(Modifier.height(FleetSpace.tight))
        }
        trip.toLabel?.let {
            FieldLabel("To")
            Text(it, style = MaterialTheme.typography.bodyMedium, color = Ash, maxLines = 2)
            Spacer(Modifier.height(FleetSpace.tight))
        }

        Row(horizontalArrangement = Arrangement.spacedBy(FleetSpace.roomy)) {
            Column {
                FieldLabel(if (trip.distanceIsPlanned) "Distance, planned" else "Distance")
                Text(
                    trip.distanceKm?.let { "%,.0f km".format(it) } ?: "-",
                    style = MaterialTheme.typography.titleSmall,
                    color = if (trip.distanceKm == null) Slate else Chalk,
                )
            }
            Column {
                FieldLabel("Started")
                Text(
                    trip.startedAt?.let { shortDate(it) } ?: "-",
                    style = MaterialTheme.typography.titleSmall,
                    color = if (trip.startedAt == null) Slate else Chalk,
                )
            }
        }

        if (trip.distanceIsPlanned) {
            Spacer(Modifier.height(FleetSpace.tight))
            Text(
                // Stated, not implied by a label a driver may not read.
                "This trip is not finished, so the distance is the plan rather than " +
                    "what has been driven.",
                style = MaterialTheme.typography.bodySmall,
                color = CautionAmber,
            )
        }
    }
}

/**
 * `2026-09-09T06:43:31.875Z` as `9 Sep`.
 *
 * Parsed by hand rather than with a formatter: the string is always the server's
 * ISO 8601, and pulling `java.time` plus a locale into a row that renders forty
 * times is a cost with nothing to show for it.
 */
private fun shortDate(iso: String): String {
    val date = iso.substringBefore('T')
    val parts = date.split('-')
    if (parts.size != 3) return date
    val month = MONTHS.getOrNull(parts[1].toIntOrNull()?.minus(1) ?: -1) ?: return date
    return "${parts[2].trimStart('0')} $month"
}

private val MONTHS = listOf(
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)

private fun String.humanised(): String =
    lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }

