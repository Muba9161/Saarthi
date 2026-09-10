package com.saarthi.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.driver.network.DriverApi
import com.saarthi.driver.ui.design.AlertRed
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.CautionAmber
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.EmberBadge
import com.saarthi.driver.ui.design.EmberCard
import com.saarthi.driver.ui.design.EmberInk
import com.saarthi.driver.ui.design.FleetButton
import com.saarthi.driver.ui.design.FleetCard
import com.saarthi.driver.ui.design.FleetEnter
import com.saarthi.driver.ui.design.FleetOutlineButton
import com.saarthi.driver.ui.design.FleetRadius
import com.saarthi.driver.ui.design.FleetScreen
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.FieldLabel
import com.saarthi.driver.ui.design.LiveGreen
import com.saarthi.driver.ui.design.MapBackdrop
import com.saarthi.driver.ui.design.Obsidian
import com.saarthi.driver.ui.design.RouteStop
import com.saarthi.driver.ui.design.RouteTimeline
import com.saarthi.driver.ui.design.Slate
import com.saarthi.driver.ui.design.StatusPill
import com.saarthi.driver.ui.design.TrackingCode
import com.saarthi.driver.ui.design.TruckMarker

/**
 * Waiting for the fleet.
 *
 * The screen that has to be honest about what scanning did and did not do.
 * Scanning opened a request; it did not authorise anything, and a driver who
 * believes otherwise will climb in and drive. So the wording leads with the
 * vehicle and the word "waiting", and the progress rail underneath shows the
 * approval as an unfinished step rather than a completed one.
 *
 * The rail is the three stages of the request and nothing more. It is tempting
 * to draw a route here — the layout invites one — but there is no route yet, and
 * a map with a line on it would be the app inventing a trip that has not been
 * approved.
 *
 * Cancelling is offered because the commonest reason for being on this screen
 * too long is a driver who scanned the wrong truck, and the alternative — an
 * open request nobody can clear — blocks them from signing on to the right one.
 */
@Composable
fun AwaitingApprovalScreen(
    viewModel: DriverViewModel,
    assignment: DriverApi.AssignmentDto,
) {
    val registration = assignment.registrationNumber

    Box(Modifier.fillMaxSize().background(Obsidian)) {
        StageBackdrop(routeTint = CautionAmber)

        FleetScreen(horizontalPadding = 0.dp, ground = null) {
            Spacer(Modifier.height(200.dp))

            Column(Modifier.padding(horizontal = FleetSpace.roomy)) {
                /*
                 * The vehicle, as the screen's one loud object.
                 *
                 * Orange is spent here and nowhere else on this screen, because
                 * the single fact a driver needs to check before anything else
                 * is *which truck this request is for* — the commonest reason
                 * for being stuck on this screen is having scanned the wrong one.
                 */
                FleetEnter(index = 0) {
                    if (registration != null) {
                        EmberCard(Modifier.fillMaxWidth()) {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                FieldLabel("Vehicle", tint = EmberInk)
                                EmberBadge("Awaiting approval")
                            }
                            Spacer(Modifier.height(FleetSpace.tight))
                            TrackingCode(registration, tint = Color.White, size = 30.sp)
                        }
                    } else {
                        Column(Modifier.fillMaxWidth()) {
                            StatusPill("Waiting for approval", tint = CautionAmber, live = true)
                            Spacer(Modifier.height(FleetSpace.snug))
                            Text(
                                "Your request has been sent",
                                style = MaterialTheme.typography.headlineSmall,
                                color = Chalk,
                            )
                        }
                    }
                }

                Spacer(Modifier.height(FleetSpace.snug))

                FleetEnter(index = 1) {
                    Text(
                        "Your fleet is reviewing it. Keep the app open - it will move " +
                            "on by itself as soon as somebody decides.",
                        style = MaterialTheme.typography.bodyLarge,
                        color = Ash,
                    )
                }

                Spacer(Modifier.height(FleetSpace.section))

                FleetEnter(index = 2) {
                    FleetCard(Modifier.fillMaxWidth()) {
                        RouteTimeline(
                            stops = listOf(
                                RouteStop(
                                    label = "Requested",
                                    place = registration?.let { "You scanned $it" }
                                        ?: "Request sent",
                                    detail = "Sent from your phone, with your position",
                                    tint = LiveGreen,
                                ),
                                RouteStop(
                                    label = "Fleet approval",
                                    place = "Waiting for your fleet",
                                    detail = "Somebody in the office checks your photo",
                                    tint = CautionAmber,
                                ),
                                RouteStop(
                                    label = "Trip starts",
                                    place = "Saarthi opens the cockpit",
                                    tint = Slate,
                                ),
                            ),
                        )
                    }
                }

                Spacer(Modifier.height(FleetSpace.section))

                FleetEnter(index = 3) {
                    FleetOutlineButton(
                        label = "Cancel this request",
                        icon = Icons.Rounded.Block,
                        tint = Ash,
                        onClick = viewModel::cancel,
                    )
                }

                Spacer(Modifier.height(FleetSpace.wide))
            }
        }
    }
}

/**
 * The fleet said no.
 *
 * The reason is shown when there is one, because "rejected" on its own sends a
 * driver to telephone an office that has already written down why. A driver can
 * scan again — the commonest rejection is the wrong vehicle, which the next scan
 * fixes without anybody's involvement, and that is why the primary action here
 * is "scan a different vehicle" rather than anything that sounds like an appeal.
 */
@Composable
fun AssignmentRejectedScreen(
    viewModel: DriverViewModel,
    assignment: DriverApi.AssignmentDto,
) {
    val registration = assignment.registrationNumber
    val reason = assignment.rejectionReason?.takeIf { it.isNotBlank() }

    Box(Modifier.fillMaxSize().background(Obsidian)) {
        StageBackdrop(routeTint = AlertRed, marker = false)

        FleetScreen(horizontalPadding = 0.dp, ground = null) {
            Spacer(Modifier.height(200.dp))

            Column(Modifier.padding(horizontal = FleetSpace.roomy)) {
                FleetEnter(index = 0) {
                    Column(Modifier.fillMaxWidth()) {
                        StatusPill("Not approved", tint = AlertRed)
                        Spacer(Modifier.height(FleetSpace.snug))
                        Text(
                            registration?.let { "Your request for" } ?: "Your request was declined",
                            style = MaterialTheme.typography.bodyLarge,
                            color = Ash,
                        )
                        if (registration != null) {
                            Spacer(Modifier.height(FleetSpace.hair))
                            TrackingCode(registration, size = 30.sp)
                            Spacer(Modifier.height(FleetSpace.hair))
                            Text(
                                "was declined.",
                                style = MaterialTheme.typography.bodyLarge,
                                color = Ash,
                            )
                        }
                    }
                }

                Spacer(Modifier.height(FleetSpace.section))

                FleetEnter(index = 1) {
                    FleetCard(Modifier.fillMaxWidth()) {
                        FieldLabel("Reason given")
                        Spacer(Modifier.height(FleetSpace.tight))
                        Text(
                            reason ?: "Your fleet did not leave a reason. The commonest " +
                                "one is a vehicle that has been given to somebody else " +
                                "this morning.",
                            style = MaterialTheme.typography.bodyLarge,
                            color = if (reason != null) Chalk else Ash,
                        )
                    }
                }

                Spacer(Modifier.height(FleetSpace.section))

                FleetEnter(index = 2) {
                    FleetButton(
                        label = "Scan a different vehicle",
                        onClick = viewModel::cancel,
                    )
                }

                Spacer(Modifier.height(FleetSpace.wide))
            }
        }
    }
}

/**
 * The lit panel these two screens sit under.
 *
 * A drawn basemap with the vehicle on it, fading into the page so the content
 * below has somewhere to start. It is scenery, and it is marked as such to
 * screen readers by the components inside it — nothing here carries information
 * that is not also written in words underneath.
 */
@Composable
private fun StageBackdrop(
    routeTint: Color,
    marker: Boolean = true,
) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(250.dp)
            .clip(
                RoundedCornerShape(
                    bottomStart = FleetRadius.hero,
                    bottomEnd = FleetRadius.hero,
                ),
            ),
    ) {
        MapBackdrop(Modifier.fillMaxSize(), routeTint = routeTint)

        if (marker) {
            Row(
                Modifier.fillMaxSize(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TruckMarker(size = 76.dp)
            }
        }

        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0.45f to Color.Transparent,
                        1f to Obsidian,
                    ),
                ),
        )
    }
}
