package com.saarthi.terminal.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Autorenew
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.FlagCircle
import androidx.compose.material.icons.rounded.Merge
import androidx.compose.material.icons.rounded.Navigation
import androidx.compose.material.icons.rounded.RoundaboutLeft
import androidx.compose.material.icons.rounded.Straight
import androidx.compose.material.icons.rounded.TurnLeft
import androidx.compose.material.icons.rounded.TurnRight
import androidx.compose.material.icons.rounded.TurnSlightLeft
import androidx.compose.material.icons.rounded.TurnSlightRight
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.UTurnLeft
import androidx.compose.material.icons.rounded.VolumeOff
import androidx.compose.material.icons.rounded.WrongLocation
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.saarthi.terminal.network.RouteDto
import com.saarthi.terminal.ui.Gutter
import com.saarthi.terminal.ui.PrimaryAction
import com.saarthi.terminal.ui.SaarthiSuccess
import com.saarthi.terminal.ui.SaarthiWarning
import com.saarthi.terminal.ui.StatusTone
import com.saarthi.terminal.ui.TouchTarget
import com.saarthi.terminal.ui.TerminalViewModel
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * The next turn (specification sections 22 and 44).
 *
 * The largest thing on the cockpit after the speed, and it earns that: a driver
 * glancing up from the road has about a second, and everything here is sized to
 * be read inside it. The turn arrow is enormous, the distance is next to it, and
 * the road name is underneath — in that order, because that is the order the
 * question is asked in.
 *
 * The manoeuvre is drawn as an *icon*, not as a word. "Turn left" in 15sp type
 * is something a driver has to read; a left arrow is something they see. The
 * instruction text is still there, underneath, for the cases a glyph cannot
 * carry — a named exit, a fork with three ways out.
 *
 * The distance and the ETA are the two figures that need honesty rather than
 * precision. Distance rounds to something a person can act on — "400 m", not
 * "just now" or "412 m" — and the arrival time comes from the server, because a
 * cheap tablet that has been powered off for a week has a clock that is wrong.
 */
@Composable
fun NavigationBanner(
    route: RouteDto,
    navigation: TerminalViewModel.NavigationUi,
    /** Whether spoken turn instructions are silenced. */
    guidanceMuted: Boolean,
    onToggleGuidance: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val next = navigation.step

    /*
     * Three states, and each replaces the turn rather than sitting beside it.
     *
     * A driver has about a second. Adding a "rerouting" chip next to an
     * instruction that is now known to be wrong would leave the wrong
     * instruction as the biggest thing on the screen — so while a new route is
     * being fetched the banner says so and shows nothing else, and on arrival it
     * says that instead.
     */
    val tone = when {
        navigation.arrived -> SaarthiSuccess
        navigation.rerouting || navigation.rerouteFailed -> SaarthiWarning
        else -> MaterialTheme.colorScheme.primary
    }

    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.95f),
        shadowElevation = 10.dp,
    ) {
        Column(Modifier.padding(Gutter)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(64.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        when {
                            navigation.arrived -> Icons.Rounded.FlagCircle
                            navigation.rerouting -> Icons.Rounded.Autorenew
                            navigation.rerouteFailed -> Icons.Rounded.WrongLocation
                            else -> maneuverIcon(next?.maneuver, next?.modifier)
                        },
                        contentDescription = when {
                            navigation.arrived -> "Arrived"
                            navigation.rerouting -> "Finding a new route"
                            else -> next?.instruction ?: "Navigating"
                        },
                        tint = tone,
                        modifier = Modifier.size(52.dp),
                    )
                }

                Spacer(Modifier.width(14.dp))

                Column(Modifier.weight(1f)) {
                    Text(
                        when {
                            navigation.arrived -> "Arrived"
                            navigation.rerouting -> "New route"
                            navigation.rerouteFailed -> "Off route"
                            next != null -> formatDistance(navigation.stepMetres)
                            else -> "On route"
                        },
                        style = MaterialTheme.typography.displaySmall,
                        fontWeight = FontWeight.SemiBold,
                        color = if (navigation.arrived) SaarthiSuccess else Color.Unspecified,
                        maxLines = 1,
                    )
                    Text(
                        when {
                            navigation.arrived -> route.destination.name
                            navigation.rerouting -> "Working out the way from here"
                            navigation.rerouteFailed -> "Saarthi cannot find a road from here"
                            else -> next?.name ?: route.destination.name
                        },
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }

                /*
                 * Silence, within reach.
                 *
                 * On the banner rather than buried in the admin screen, because
                 * the moment a driver wants the talking to stop is a moment they
                 * are driving — a second person asleep in the cab, a phone call,
                 * a road they know by heart. A mute that takes a PIN and three
                 * taps is a mute nobody uses; they turn the volume down instead
                 * and lose the emergency announcements with it.
                 */
                IconButton(onClick = onToggleGuidance) {
                    Icon(
                        if (guidanceMuted) Icons.Rounded.VolumeOff else Icons.AutoMirrored.Rounded.VolumeUp,
                        contentDescription = if (guidanceMuted) {
                            "Turn spoken directions on"
                        } else {
                            "Mute spoken directions"
                        },
                        tint = if (guidanceMuted) {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        } else {
                            MaterialTheme.colorScheme.primary
                        },
                    )
                }

                IconButton(onClick = onCancel) {
                    Icon(
                        Icons.Rounded.Close,
                        contentDescription = "Stop navigating",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            /*
             * The instruction, and only when it is still true.
             *
             * Hidden while re-routing: the step belongs to a route the vehicle
             * has left, and a driver reading "turn left onto NH 48" from a road
             * that no longer meets it is worse off than one reading nothing.
             */
            if (!navigation.rerouting && !navigation.arrived) {
                next?.instruction?.let { instruction ->
                    Spacer(Modifier.size(6.dp))
                    Text(
                        instruction,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 2,
                    )
                }
            }

            if (navigation.rerouteFailed) {
                Spacer(Modifier.size(6.dp))
                Text(
                    "Carry on and Saarthi will pick the route back up, or stop navigating.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                )
            }

            if (route.summary.isNotBlank() && !navigation.arrived) {
                Spacer(Modifier.size(6.dp))
                Text(
                    "via ${route.summary}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
        }
    }
}

/**
 * How far, how long, and when you arrive.
 *
 * Split out of the turn card and moved to the foot of the map, which is where a
 * driver already looks for it — every in-car navigator built in the last decade
 * puts the turn at the top and the journey at the bottom, and a terminal that
 * stacks both in one block makes the driver read a paragraph to find a number.
 *
 * The figures count *down* now. They used to be the route's own totals, fixed at
 * the moment it was fetched, so a driver forty minutes into an hour's journey
 * was still being told it was an hour — and the arrival time, computed once by
 * the server, quietly slid into the past. What is shown is what is left.
 *
 * It also carries the way out. Stopping navigation was an icon inside a dense
 * card; here it is a target of its own, at the edge, where a thumb can reach it
 * without crossing the instruction.
 */
@Composable
fun TripSummaryBar(
    route: RouteDto,
    navigation: TerminalViewModel.NavigationUi,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    /*
     * Fall back to the route's own totals until the first fix lands.
     *
     * `remainingMetres` is zero for the moment between the route arriving and
     * the vehicle being projected onto it, and "0.0 km" on a journey that has
     * not started reads as a fault.
     */
    val started = navigation.remainingMetres > 0 || navigation.arrived
    val remainingKm =
        if (started) navigation.remainingMetres / 1_000.0 else route.distanceKm
    val remainingMinutes =
        if (started) navigation.remainingMinutes else route.durationMinutes

    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.95f),
        shadowElevation = 8.dp,
    ) {
        Row(
            Modifier.padding(start = 6.dp, end = 16.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onCancel) {
                Icon(
                    Icons.Rounded.Close,
                    contentDescription = "Stop navigating",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (navigation.arrived) {
                Text(
                    "Arrived",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = SaarthiSuccess,
                )
                Text(
                    "  ·  ${route.destination.name}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            } else {
                Text(
                    "$remainingMinutes min",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = SaarthiSuccess,
                )
                Text(
                    "  ·  %.1f km  ·  %s".format(remainingKm, arrivalClock(remainingMinutes)),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
        }
    }
}

/**
 * When the vehicle gets there, from the minutes still to run.
 *
 * Computed here rather than taken from the route's `etaAt`, which the server
 * stamped once when the route was fetched and which is therefore wrong by
 * however long the journey has taken so far. The tablet's *clock* is still not
 * trusted for anything absolute — a cheap device that has been off for a week
 * has a wrong one — but it is perfectly good for adding minutes to now, and a
 * driver reads an arrival time as "how much longer" in any case.
 */
private fun arrivalClock(minutesRemaining: Int): String = runCatching {
    DateTimeFormatter.ofPattern("HH:mm")
        .withZone(ZoneId.systemDefault())
        .format(Instant.now().plusSeconds(minutesRemaining * 60L))
}.getOrDefault("—")

/**
 * The route, before the driver commits to it.
 *
 * Choosing a petrol pump from a list is a question — "how far is that?" — and
 * this is the answer. Tapping a row used to be the answer *and* the decision:
 * the camera took over, the terminal started talking, and a trip was opened
 * against the vehicle. On a 7-inch screen in a moving cab that made a mis-tap
 * expensive, and it took a choice away from the person whose journey it is.
 *
 * Everything needed for the decision and nothing else: where, how far, how long,
 * and which roads. Start is the large control because it is the one being asked
 * for; dismissing is deliberately smaller and beside it, because a driver who
 * meant Start and hit Cancel has lost a routing request and their place in the
 * list.
 */
@Composable
fun RoutePreviewCard(
    route: RouteDto,
    onStart: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
        shadowElevation = 12.dp,
    ) {
        Column(Modifier.padding(Gutter)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Rounded.FlagCircle,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(28.dp),
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    route.destination.name,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    modifier = Modifier.weight(1f),
                )
            }

            Spacer(Modifier.size(10.dp))

            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    "${route.durationMinutes} min",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = SaarthiSuccess,
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    "%.1f km · arrive %s".format(
                        route.distanceKm,
                        arrivalClock(route.durationMinutes),
                    ),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 4.dp),
                    maxLines = 1,
                )
            }

            if (route.summary.isNotBlank()) {
                Spacer(Modifier.size(4.dp))
                Text(
                    "via ${route.summary}",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }

            Spacer(Modifier.size(14.dp))

            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PrimaryAction(
                    label = "Start",
                    icon = Icons.Rounded.Navigation,
                    onClick = onStart,
                    tone = StatusTone.GOOD,
                    modifier = Modifier.weight(1f),
                )
                Surface(
                    modifier = Modifier
                        .sizeIn(minHeight = TouchTarget, minWidth = TouchTarget)
                        .clip(RoundedCornerShape(16.dp))
                        .clickable(onClick = onDismiss),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Box(Modifier.padding(horizontal = 20.dp), contentAlignment = Alignment.Center) {
                        Text(
                            "Cancel",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

/**
 * A glyph for a manoeuvre.
 *
 * Falls back to a straight arrow rather than to nothing. A router occasionally
 * produces a manoeuvre this mapping has never seen, and a blank square where the
 * turn arrow should be is worse than an arrow that says "carry on" beside an
 * instruction that says otherwise.
 */
private fun maneuverIcon(maneuver: String?, modifier: String?): ImageVector = when {
    maneuver == "arrive" -> Icons.Rounded.FlagCircle
    maneuver == "depart" -> Icons.Rounded.Navigation
    maneuver == "roundabout" || maneuver == "exit roundabout" -> Icons.Rounded.RoundaboutLeft
    maneuver == "fork" && modifier?.contains("left") == true -> Icons.Rounded.Merge
    maneuver == "fork" -> Icons.Rounded.Merge
    modifier == "uturn" -> Icons.Rounded.UTurnLeft
    modifier == "left" || modifier == "sharp left" -> Icons.Rounded.TurnLeft
    modifier == "right" || modifier == "sharp right" -> Icons.Rounded.TurnRight
    modifier == "slight left" -> Icons.Rounded.TurnSlightLeft
    modifier == "slight right" -> Icons.Rounded.TurnSlightRight
    else -> Icons.Rounded.Straight
}

/**
 * A distance a driver can act on.
 *
 * Rounded to the precision the decision needs: under 50 m the answer is "now",
 * and telling somebody the turn is in 37 metres is asking them to do arithmetic
 * at the moment they should be turning.
 */
private fun formatDistance(metres: Int): String = when {
    metres < 50 -> "Now"
    metres < 1_000 -> "${(metres / 50) * 50} m"
    metres < 10_000 -> "%.1f km".format(metres / 1000.0)
    else -> "${metres / 1000} km"
}

