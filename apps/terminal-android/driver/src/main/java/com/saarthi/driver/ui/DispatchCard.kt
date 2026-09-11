package com.saarthi.driver.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Navigation
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.CautionAmber
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.FieldLabel
import com.saarthi.driver.ui.design.FleetButton
import com.saarthi.driver.ui.design.FleetCard
import com.saarthi.driver.ui.design.FleetRule
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.LiveGreen
import com.saarthi.driver.ui.design.StatusPill
import com.saarthi.driver.ui.design.TrackingCode

/**
 * The job the fleet gave this vehicle.
 *
 * The gap this closes was the plainest one in the app: a dispatcher assigned a
 * trip from the web, Saarthi wrote it against the vehicle, and the driver
 * holding the phone was told where to go by telephone — because nothing on the
 * vehicle ever asked. The trip then sat at ASSIGNED and nought per cent for the rest of its
 * life, since the cockpit's own Start button moved the driver's *session* and
 * never the fleet's trip.
 *
 * Three rules shape what is on the card, and each of them is a thing that was
 * got wrong somewhere else first:
 *
 *  * **Where, before how far.** A driver glancing at a phone in a cradle is
 *    answering "where am I taking this?" — so the destination is the largest
 *    thing here and the reference is small print above it.
 *  * **Navigating is offered, never taken.** Pressing the button draws the
 *    route and stops. The same two steps a searched place takes, for the same
 *    reason: a screen that seized the map and started talking because a
 *    controller clicked Save in an office is a screen a driver fights.
 *  * **Planned distance says so.** The figure on a trip that has not moved is
 *    the dispatcher's plan, and a plan shown as a measurement is a number a
 *    driver will later be argued out of.
 *
 * Starting and ending the trip stay where they already are — the slide controls
 * at the foot of the cockpit — rather than being duplicated here. One control
 * for one act; see [DriverCockpitScreen].
 */
@Composable
fun DispatchCard(
    cockpit: TerminalViewModel,
    modifier: Modifier = Modifier,
) {
    val trip by cockpit.dispatch.collectAsState()
    val navigation by cockpit.navigation.collectAsState()
    val busy by cockpit.busy.collectAsState()

    val job = trip ?: return

    /*
     * Why the route could not be worked out, when it could not.
     *
     * Held here rather than left to a log line. The failure a driver actually
     * hits is "Saarthi does not know where this vehicle is yet" — a phone that
     * has not got a satellite fix — and that is a thing they can do something
     * about by driving out of a shed, which they will only do if told.
     */
    var problem by remember { mutableStateOf<String?>(null) }

    FleetCard(modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                FieldLabel("Your trip")
                Spacer(Modifier.height(FleetSpace.tight))
                TrackingCode(job.reference.ifBlank { "TRIP" }, size = 18.sp)
            }
            StatusPill(
                label = job.status.humanisedStatus(),
                tint = if (job.underway) LiveGreen else CautionAmber,
                live = job.underway,
            )
        }

        Spacer(Modifier.height(FleetSpace.snug))
        FleetRule()
        Spacer(Modifier.height(FleetSpace.snug))

        FieldLabel("Going to")
        Spacer(Modifier.height(FleetSpace.tight))
        Text(
            job.destinationAddress.ifBlank { "Your fleet has not named the destination." },
            style = MaterialTheme.typography.titleMedium,
            color = Chalk,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )

        if (job.originAddress.isNotBlank()) {
            Spacer(Modifier.height(FleetSpace.snug))
            FieldLabel("From")
            Spacer(Modifier.height(FleetSpace.tight))
            Text(
                job.originAddress,
                style = MaterialTheme.typography.bodyMedium,
                color = Ash,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }

        // Bound once. A nullable property on a class from another module does
        // not smart-cast, and reading it twice would be two reads of the same
        // number with a branch in between.
        val planned = job.plannedDistanceKm

        Spacer(Modifier.height(FleetSpace.snug))
        Row(horizontalArrangement = Arrangement.spacedBy(FleetSpace.roomy)) {
            Column {
                // The plan and the measurement are different numbers, and a trip
                // that has not moved only has the first of them.
                FieldLabel(if (job.underway) "Distance" else "Distance, planned")
                Text(
                    (if (job.underway) job.actualDistanceKm else planned)
                        ?.let { "%,.0f km".format(it) } ?: "-",
                    style = MaterialTheme.typography.titleSmall,
                    color = Chalk,
                )
            }
            if (job.underway && planned != null) {
                Column {
                    FieldLabel("Of")
                    Text(
                        "%,.0f km".format(planned),
                        style = MaterialTheme.typography.titleSmall,
                        color = Ash,
                    )
                }
            }
            job.stops.size.takeIf { it > 2 }?.let { stops ->
                Column {
                    FieldLabel("Stops")
                    Text(
                        "$stops",
                        style = MaterialTheme.typography.titleSmall,
                        color = Chalk,
                    )
                }
            }
        }

        job.notes?.takeIf { it.isNotBlank() }?.let { note ->
            Spacer(Modifier.height(FleetSpace.snug))
            FieldLabel("From your fleet")
            Spacer(Modifier.height(FleetSpace.tight))
            Text(
                note,
                style = MaterialTheme.typography.bodyMedium,
                color = Ash,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
            )
        }

        /*
         * Said plainly rather than hidden.
         *
         * A dispatch belongs to the vehicle, so a driver who took one over
         * mid-shift is shown the job — but they are entitled to know the
         * paperwork names somebody else before they set off on it.
         */
        if (!job.assignedToSignedInDriver) {
            Spacer(Modifier.height(FleetSpace.snug))
            Text(
                "Your fleet assigned this trip to another driver. " +
                    "Check with them before you set off.",
                style = MaterialTheme.typography.bodySmall,
                color = CautionAmber,
            )
        }

        problem?.let { message ->
            Spacer(Modifier.height(FleetSpace.snug))
            Text(
                message,
                style = MaterialTheme.typography.bodySmall,
                color = CautionAmber,
            )
        }

        // A route already on the map is the driver's answer to this button.
        // Offering it again would redraw the line they are looking at.
        if (!navigation.active) {
            Spacer(Modifier.height(FleetSpace.base))
            FleetButton(
                label = "Show me the way",
                icon = Icons.Rounded.Navigation,
                busy = busy,
                busyLabel = "Working out the route…",
                onClick = {
                    problem = null
                    cockpit.navigateToDispatch { worked ->
                        if (!worked) {
                            problem = "Saarthi could not work out a route yet. " +
                                "It needs to know where this vehicle is, so move " +
                                "somewhere with a clear view of the sky and try again."
                        }
                    }
                },
            )
        }
    }
}

private fun String.humanisedStatus(): String =
    lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
