package com.saarthi.terminal.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
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
import androidx.compose.material.icons.rounded.UTurnLeft
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
    next: TerminalViewModel.NextManeuverUi?,
    onCancel: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
        tonalElevation = 4.dp,
    ) {
        Column(Modifier.padding(Gutter)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(64.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        maneuverIcon(next?.maneuver, next?.modifier),
                        contentDescription = next?.instruction ?: "Navigating",
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(52.dp),
                    )
                }

                Spacer(Modifier.width(14.dp))

                Column(Modifier.weight(1f)) {
                    Text(
                        next?.let { formatDistance(it.distanceMetres) } ?: "On route",
                        style = MaterialTheme.typography.displaySmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        next?.roadName ?: route.destination.name,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
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

            next?.instruction?.let { instruction ->
                Spacer(Modifier.size(6.dp))
                Text(
                    instruction,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 2,
                )
            }

            Spacer(Modifier.size(10.dp))

            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "${route.destination.name} · %.1f km".format(route.distanceKm),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Text(
                    "${route.durationMinutes} min · arrive ${formatEta(route.etaAt)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (route.summary.isNotBlank()) {
                Text(
                    "via ${route.summary}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
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

/** Local wall-clock time. The server sent an instant; the driver reads a clock. */
private fun formatEta(iso: String): String = runCatching {
    DateTimeFormatter.ofPattern("HH:mm")
        .withZone(ZoneId.systemDefault())
        .format(Instant.parse(iso))
}.getOrDefault("—")
