package com.saarthi.driver.ui.design

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The instruments, as a phone should draw them.
 *
 * The fitted terminal draws four round dials, and it is right to: it is bolted
 * where a driver's eye already goes for a rev counter, and a needle's angle is
 * read without being parsed. A phone in a cradle is not that. It is smaller,
 * further away and off to one side, so these are figures — large, aligned on a
 * grid, with the units small enough to stay out of the way — plus one thin bar
 * that carries the same "where in the range am I" that a needle did.
 *
 * Two rules run through all of it, and both come from the same place: a fleet
 * makes decisions on these numbers.
 *
 *  * **Nothing shows a value it does not have.** An absent reading is an em
 *    dash, never a zero. On a fuel gauge those look identical and mean opposite
 *    things, and the difference is somebody stranded.
 *  * **A simulated reading says so, on its face.** Not in a settings screen, not
 *    in a log — on the card, every time it is drawn.
 */

/**
 * One reading.
 *
 * @param value the formatted figure, or null when the vehicle has not reported
 *   one. Formatting belongs to the caller because the sensible number of
 *   decimals differs per metric.
 * @param fraction where the reading sits in its range, 0..1, for the bar. Null
 *   leaves the bar empty rather than resting it at the left, for the same reason
 *   the figure shows a dash.
 * @param simulated true when this came from the simulator rather than a vehicle.
 */
@Composable
fun FleetMetric(
    label: String,
    value: String?,
    unit: String,
    modifier: Modifier = Modifier,
    tint: Color = Chalk,
    fraction: Float? = null,
    simulated: Boolean = false,
) {
    val filled by animateFloatAsState(
        targetValue = (fraction ?: 0f).coerceIn(0f, 1f),
        animationSpec = FleetMotion.settle(),
        label = "metric-$label",
    )

    FleetCard(modifier, padding = FleetSpace.base, corner = FleetRadius.tile) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            FieldLabel(label)
            Spacer(Modifier.weight(1f))
            if (simulated) SimulatedMark()
        }

        Spacer(Modifier.height(FleetSpace.tight))

        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                // An em dash, not a zero. See the file note.
                value ?: "—",
                style = MaterialTheme.typography.headlineMedium,
                color = if (value == null) Slate else tint,
                maxLines = 1,
            )
            Spacer(Modifier.width(4.dp))
            Text(
                unit,
                style = MaterialTheme.typography.labelSmall,
                color = Slate,
                modifier = Modifier.padding(bottom = 3.dp),
                maxLines = 1,
            )
        }

        Spacer(Modifier.height(FleetSpace.snug))

        // The needle's job, flattened. Empty when there is nothing to show.
        Box(
            Modifier
                .fillMaxWidth()
                .height(4.dp)
                .clip(RoundedCornerShape(FleetRadius.pill))
                .background(OnyxDeep),
        ) {
            if (fraction != null) {
                Box(
                    Modifier
                        .fillMaxWidth(filled)
                        .height(4.dp)
                        .clip(RoundedCornerShape(FleetRadius.pill))
                        .background(tint),
                )
            }
        }
    }
}

/**
 * A smaller reading, for figures that do not move.
 *
 * Odometer and mileage change over a shift rather than over a second, so they
 * get no bar and no room — they are things a driver checks, not watches.
 */
@Composable
fun FleetReadout(
    label: String,
    value: String?,
    unit: String,
    modifier: Modifier = Modifier,
    simulated: Boolean = false,
) {
    FleetCard(modifier, padding = FleetSpace.base, corner = FleetRadius.tile) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            FieldLabel(label)
            Spacer(Modifier.weight(1f))
            if (simulated) SimulatedMark()
        }
        Spacer(Modifier.height(FleetSpace.hair))
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                value ?: "—",
                style = MaterialTheme.typography.titleLarge,
                color = if (value == null) Slate else Chalk,
                maxLines = 1,
            )
            Spacer(Modifier.width(4.dp))
            Text(
                unit,
                style = MaterialTheme.typography.labelSmall,
                color = Slate,
                modifier = Modifier.padding(bottom = 2.dp),
                maxLines = 1,
            )
        }
    }
}

/**
 * The mark that says "this number did not come from a vehicle".
 *
 * Amber rather than grey, and on the card rather than in a corner of the app.
 * A simulated reading that looks like a measured one is the single most
 * expensive thing this screen could do: a fleet acting on it makes a real
 * decision about a real truck from a number nobody measured.
 */
@Composable
fun SimulatedMark(modifier: Modifier = Modifier) {
    Text(
        "SIM",
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        fontSize = 9.sp,
        color = CautionAmber,
        modifier = modifier
            .clip(RoundedCornerShape(FleetRadius.pill))
            .background(CautionAmber.copy(alpha = 0.15f))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

/**
 * Speed, over the map, while the vehicle is moving.
 *
 * The one reading worth taking from a glance rather than a look, so it is given
 * the largest type in the app and put on the map itself — where the driver is
 * already looking — instead of in the grid below with everything else.
 */
@Composable
fun FleetSpeedBadge(
    speedKph: Double?,
    modifier: Modifier = Modifier,
    simulated: Boolean = false,
) {
    val over = (speedKph ?: 0.0) >= 90
    Column(
        modifier
            .clip(RoundedCornerShape(FleetRadius.card))
            .background(Obsidian.copy(alpha = 0.82f))
            .padding(horizontal = FleetSpace.base, vertical = FleetSpace.snug),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Text(
                speedKph?.let { "%.0f".format(it) } ?: "—",
                style = MaterialTheme.typography.displaySmall,
                // Ninety is where a loaded truck stops being comfortable and
                // where most Indian state limits sit for goods vehicles.
                color = if (over) CautionAmber else Chalk,
                maxLines = 1,
            )
            if (simulated) {
                Spacer(Modifier.width(FleetSpace.hair))
                SimulatedMark(Modifier.padding(top = 4.dp))
            }
        }
        Text("km/h", style = MaterialTheme.typography.labelSmall, color = Ash)
    }
}
