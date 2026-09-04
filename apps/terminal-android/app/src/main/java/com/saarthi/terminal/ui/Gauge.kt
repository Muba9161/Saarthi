package com.saarthi.terminal.ui

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.cos
import kotlin.math.sin

/**
 * A dial.
 *
 * The cockpit shows four of these — speed, engine speed, fuel and coolant — for
 * the reason every vehicle built in the last century has: a number has to be
 * read, and a shape can be caught. A driver glancing down for a fifth of a
 * second sees where the needle sits without parsing digits, and that is the
 * entire difference between an instrument and a label on a screen.
 *
 * What it will not do is imply a reading it does not have. With no value the
 * arc stays empty, the needle is absent and the figure is an em dash — because a
 * dial resting at zero and a dial with nothing to show look identical, and on a
 * fuel gauge that distinction is the difference between "half a tank" and "this
 * vehicle does not report fuel".
 */

/**
 * Where the dial's range sits relative to the reading.
 *
 * Bands are drawn behind the value, faintly, the way a redline is printed on a
 * rev counter — so a driver learns where "too much" is before they ever get
 * there, rather than discovering it from a colour change at the moment it
 * matters.
 */
data class GaugeBand(val from: Float, val to: Float, val color: Color)

@Composable
fun Gauge(
    label: String,
    value: Double?,
    /** The top of the dial. A value past it pins the needle rather than rescaling. */
    max: Double,
    unit: String,
    modifier: Modifier = Modifier,
    /** Whole numbers for speed and rpm, one decimal for volts. */
    decimals: Int = 0,
    bands: List<GaugeBand> = emptyList(),
    tone: Color? = null,
    simulated: Boolean = false,
    /** How large to draw the dial — see [GaugeSizes]. */
    dialSize: Dp = GaugeSizes.Regular,
) {
    val reduced = LocalReducedMotion.current
    val fraction = ((value ?: 0.0) / max).coerceIn(0.0, 1.0).toFloat()

    /*
     * Eased, not snapped.
     *
     * A needle that jumps between readings looks like a fault; one that sweeps
     * looks like the vehicle changing, which is what it is. The spring is
     * deliberately slack — a stiff one overshoots and oscillates, which on a rev
     * counter reads as an engine hunting.
     */
    val swept by animateFloatAsState(
        targetValue = if (value == null) 0f else fraction,
        animationSpec = if (reduced) {
            tween(0)
        } else {
            spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessLow)
        },
        label = "gauge-$label",
    )

    val accent = tone ?: MaterialTheme.colorScheme.primary
    val track = MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)
    val ink = MaterialTheme.colorScheme.onSurface
    val faint = MaterialTheme.colorScheme.onSurfaceVariant

    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        /*
         * A fixed dial, not one that fills its column.
         *
         * Sized to the width available, it grew to about 150dp on a phone — and
         * four of those plus their labels took more than half the screen, which
         * left the map, the thing this cockpit is for, as a strip along the top.
         * A dial only has to be large enough to read a needle angle at a glance,
         * and that is a good deal smaller than "as large as there is room for".
         */
        Box(
            Modifier.size(dialSize),
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.fillMaxSize()) {
                val stroke = Stroke(width = size.minDimension * 0.09f, cap = StrokeCap.Round)
                val inset = stroke.width / 2
                val side = size.minDimension - stroke.width
                val topLeft = Offset(
                    (size.width - side) / 2f,
                    (size.height - side) / 2f + inset * 0.2f,
                )
                val arcSize = Size(side, side)

                // 240° from bottom-left: the shape a driver expects a dial to
                // have. A full ring has no beginning, so there is nowhere for
                // "empty" to be.
                drawArc(
                    color = track,
                    startAngle = START_ANGLE,
                    sweepAngle = SWEEP,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = stroke,
                )

                // Bands sit under the value, thin and faint — printed on the
                // dial face rather than competing with the reading.
                bands.forEach { band ->
                    drawArc(
                        color = band.color.copy(alpha = 0.35f),
                        startAngle = START_ANGLE + SWEEP * band.from,
                        sweepAngle = SWEEP * (band.to - band.from),
                        useCenter = false,
                        topLeft = topLeft,
                        size = arcSize,
                        style = Stroke(width = stroke.width * 0.42f, cap = StrokeCap.Butt),
                    )
                }

                if (value != null) {
                    drawArc(
                        color = accent,
                        startAngle = START_ANGLE,
                        sweepAngle = SWEEP * swept,
                        useCenter = false,
                        topLeft = topLeft,
                        size = arcSize,
                        style = stroke,
                    )

                    // The needle tip. A short radial mark rather than a full
                    // pointer: at this size a pointer from the centre is more
                    // ink than the reading it indicates.
                    val angle = Math.toRadians((START_ANGLE + SWEEP * swept).toDouble())
                    val radius = side / 2f
                    val centre = Offset(topLeft.x + radius, topLeft.y + radius)
                    val outer = radius + stroke.width * 0.10f
                    val inner = radius - stroke.width * 0.62f
                    drawLine(
                        color = ink,
                        start = Offset(
                            centre.x + (cos(angle) * inner).toFloat(),
                            centre.y + (sin(angle) * inner).toFloat(),
                        ),
                        end = Offset(
                            centre.x + (cos(angle) * outer).toFloat(),
                            centre.y + (sin(angle) * outer).toFloat(),
                        ),
                        strokeWidth = size.minDimension * 0.028f,
                        cap = StrokeCap.Round,
                    )
                }
            }

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = value?.let { "%.${decimals}f".format(it) } ?: "—",
                    // The figure follows the ring it sits inside. Left at the
                    // headline size it overflowed a shrunken dial, and a number
                    // touching the arc either side of it reads as damage.
                    style = if (dialSize < GaugeSizes.Regular) {
                        MaterialTheme.typography.titleLarge
                    } else {
                        MaterialTheme.typography.headlineSmall
                    },
                    fontWeight = FontWeight.Bold,
                    color = if (value == null) faint else ink,
                    maxLines = 1,
                )
                Text(
                    text = unit,
                    style = MaterialTheme.typography.labelMedium,
                    color = faint,
                    maxLines = 1,
                    softWrap = false,
                )
            }
        }

        Spacer(Modifier.height(4.dp))

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Text(
                text = label.uppercase(),
                style = MaterialTheme.typography.labelMedium,
                color = faint,
                maxLines = 1,
                softWrap = false,
            )
            // Section 19's marker, as a dot. A word here would be wider than the
            // label it qualifies.
            if (simulated) {
                Spacer(Modifier.width(5.dp))
                Box(
                    Modifier
                        .size(6.dp)
                        .clip(CircleShape)
                        .background(SaarthiWarning),
                )
            }
        }
    }
}

/** 150° puts the start bottom-left; 240° of travel ends bottom-right. */
private const val START_ANGLE = 150f
private const val SWEEP = 240f

/**
 * The three sizes a dial comes in.
 *
 * Fixed sizes rather than "as large as the column allows": sized to its width, a
 * dial grew to about 150dp on a phone, and four of those plus their labels took
 * more than half the screen — which left the map, the thing this cockpit is for,
 * as a strip along the top. A dial only has to be big enough to read a needle
 * angle at a glance, and that is a good deal smaller than the room available.
 *
 * Which one applies is decided by the screen, in one place, in `CockpitScreen`.
 */
object GaugeSizes {
    /**
     * A dash display or a tablet, where height is not the constraint.
     *
     * About 18mm on a typical panel — comfortably readable without looking
     * directly at it, which is the whole job of a dial.
     */
    val Regular: Dp = 104.dp

    /**
     * A phone held upright.
     *
     * Four dials plus their labels at the full size took about two fifths of a
     * portrait screen. Eighty-eight points is still well above the size at which
     * a needle angle can be read at a glance, and it gives the map back roughly
     * a sixth of the screen.
     */
    val Compact: Dp = 88.dp

    /**
     * A phone on its side.
     *
     * The rail beside the map is about 280dp tall there, and two rows of compact
     * dials plus the start-trip card above them came to roughly 330dp: the fuel
     * and coolant labels sat below the fold. The rail scrolls, so nothing was
     * unreachable — but a gauge a driver has to scroll to see may as well not be
     * fitted, and this is the largest dial that leaves all four visible at once.
     */
    val Dense: Dp = 78.dp
}
