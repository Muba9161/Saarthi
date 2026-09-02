package com.saarthi.terminal.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * The terminal's shared surfaces.
 *
 * Two rules run through all of them, and both come from where this screen
 * lives rather than from taste:
 *
 * **Status is never colour alone.** Every state carries an icon and a word as
 * well as a hue (section 60). A driver with red-green colour blindness reading a
 * warning at dusk through a polarised windscreen is the case this protects, and
 * it is not a rare one.
 *
 * **Glass carries the chrome; contrast carries the numbers.** Section 7 asks
 * for subtle glassmorphism and then immediately says speed, navigation,
 * warnings and SOS must stay readable in bright sunlight. Both are satisfied by
 * making the glass do the work rather than making it thin: a frosted panel with
 * an inner highlight, a hairline edge, and a tint dense enough to hold 4.5:1
 * against the brightest basemap tile underneath it. Where a value still could
 * not survive that, it goes on a solid card instead.
 */

/** A semantic state, expressed three ways at once. */
enum class StatusTone { NEUTRAL, GOOD, WARN, CRITICAL, INFO }

@Composable
fun StatusTone.color(): Color = when (this) {
    StatusTone.GOOD -> SaarthiSuccess
    StatusTone.WARN -> SaarthiWarning
    StatusTone.CRITICAL -> SaarthiDanger
    StatusTone.INFO -> SaarthiInfo
    StatusTone.NEUTRAL -> MaterialTheme.colorScheme.onSurfaceVariant
}

/**
 * A frosted panel that reads over a map without hiding it.
 *
 * Three layers, and each earns its place:
 *
 *  * a **tint** dense enough to hold 4.5:1 text contrast over the brightest
 *    basemap tile — a panel that looks lovely over a dark satellite view and
 *    becomes unreadable over a white motorway fails exactly when the driver is
 *    on a motorway;
 *  * an **inner highlight**, brighter along the top edge, which is what makes a
 *    flat translucent rectangle read as glass rather than as a faded box;
 *  * a **hairline edge**, so the panel has a boundary against a busy map.
 *
 * A true backdrop blur is deliberately not used. `Modifier.blur` does nothing
 * below API 31 and costs a full-screen render pass above it, and this panel
 * sits over a live map on tablets chosen for their price. Simulated frost is
 * indistinguishable at this size and works on every unit a fleet will fit.
 */
@Composable
fun GlassCard(
    modifier: Modifier = Modifier,
    /** Padding inside the panel. Tightened on a phone, where space is scarce. */
    contentPadding: androidx.compose.ui.unit.Dp = Gutter,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    val dark = LocalDarkCockpit.current
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(22.dp),
        color = Color.Transparent,
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            if (dark) Color.White.copy(alpha = 0.14f) else Color.White.copy(alpha = 0.7f),
        ),
        shadowElevation = 10.dp,
    ) {
        Box(
            Modifier.background(
                Brush.verticalGradient(
                    if (dark) {
                        listOf(
                            Color(0xFF1B2338).copy(alpha = 0.92f),
                            Color(0xFF0B1020).copy(alpha = 0.88f),
                        )
                    } else {
                        listOf(
                            Color.White.copy(alpha = 0.92f),
                            Color(0xFFEDF2FB).copy(alpha = 0.86f),
                        )
                    },
                ),
            ),
        ) {
            Column(Modifier.padding(contentPadding), content = content)
        }
    }
}

/** A solid card. For anything a translucent one could not carry. */
@Composable
fun SolidCard(
    modifier: Modifier = Modifier,
    contentPadding: androidx.compose.ui.unit.Dp = Gutter,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 2.dp,
        shadowElevation = 2.dp,
    ) {
        Column(Modifier.padding(contentPadding), content = content)
    }
}

/**
 * One large figure with its label.
 *
 * `value` is nullable on purpose and renders as an em dash. "Not reported" and
 * "zero" are different statements — a vehicle that cannot read fuel level is not
 * a vehicle with an empty tank — and a gauge that showed 0 for both would send a
 * driver looking for a pump.
 */
@Composable
fun Readout(
    label: String,
    value: String?,
    modifier: Modifier = Modifier,
    unit: String? = null,
    tone: StatusTone = StatusTone.NEUTRAL,
    simulated: Boolean = false,
    large: Boolean = false,
) {
    Column(modifier) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                text = value ?: "—",
                style = if (large) {
                    MaterialTheme.typography.displayMedium
                } else {
                    MaterialTheme.typography.headlineMedium
                },
                color = if (value == null) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    tone.color()
                },
            )
            if (unit != null && value != null) {
                Spacer(Modifier.width(4.dp))
                Text(
                    text = unit,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = if (large) 10.dp else 3.dp),
                )
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = label.uppercase(),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (simulated) {
                Spacer(Modifier.width(8.dp))
                SimulatedTag()
            }
        }
    }
}

/**
 * The simulated-data marker.
 *
 * Required by section 19, and drawn deliberately loud rather than as a subtle
 * footnote. A driver signing off a vehicle on a coolant reading a test harness
 * invented is the failure this label exists to prevent, and a marker somebody
 * has to look for does not prevent it.
 */
@Composable
fun SimulatedTag(modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.semantics {
            contentDescription = "This value is simulated, not measured from the vehicle"
        },
        shape = RoundedCornerShape(6.dp),
        color = SaarthiWarning.copy(alpha = 0.18f),
        border = androidx.compose.foundation.BorderStroke(1.dp, SaarthiWarning.copy(alpha = 0.6f)),
    ) {
        Text(
            text = "SIMULATED",
            style = MaterialTheme.typography.labelMedium,
            color = SaarthiWarning,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

/** A status chip: icon, word and colour together. Never colour alone. */
@Composable
fun StatusChip(
    icon: ImageVector,
    label: String,
    tone: StatusTone = StatusTone.NEUTRAL,
    modifier: Modifier = Modifier,
) {
    val tint = tone.color()
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(999.dp),
        color = tint.copy(alpha = 0.14f),
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
            Text(label, style = MaterialTheme.typography.labelLarge, color = tint)
        }
    }
}

/**
 * A primary action, sized for a moving vehicle.
 *
 * 64dp minimum height rather than Material's 48dp. The reader is being shaken
 * by a road surface, and a target that works at a desk does not work at 60 km/h
 * on a national highway.
 */
@Composable
fun PrimaryAction(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    tone: StatusTone = StatusTone.INFO,
) {
    val background = if (enabled) tone.color() else MaterialTheme.colorScheme.surfaceVariant
    Surface(
        modifier = modifier
            .sizeIn(minHeight = TouchTarget)
            .clip(RoundedCornerShape(16.dp))
            .clickable(enabled = enabled, onClick = onClick),
        color = background,
        shape = RoundedCornerShape(16.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 24.dp, vertical = 18.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(22.dp),
                )
                Spacer(Modifier.width(10.dp))
            }
            Text(
                label,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = if (enabled) {
                    MaterialTheme.colorScheme.onPrimary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier,
    )
}

/**
 * The connection banner.
 *
 * Shown only when there is something to say. Being offline in a tunnel is
 * normal, and a permanent red bar every time a truck goes under a bridge is a
 * bar drivers learn to look past — so the offline state is stated calmly and
 * says what is actually happening to their data, which is that nothing is lost.
 */
@Composable
fun ConnectionBanner(
    offline: Boolean,
    pendingUploads: Int,
    modifier: Modifier = Modifier,
) {
    if (!offline && pendingUploads == 0) return

    Surface(
        modifier = modifier.fillMaxWidth(),
        color = if (offline) {
            SaarthiWarning.copy(alpha = 0.16f)
        } else {
            MaterialTheme.colorScheme.surfaceVariant
        },
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                Icons.Rounded.CloudOff,
                contentDescription = null,
                tint = if (offline) SaarthiWarning else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
            Text(
                text = when {
                    offline && pendingUploads > 0 ->
                        "No signal. $pendingUploads readings are saved and will be sent automatically."
                    offline -> "No signal. Everything is being saved on this terminal."
                    else -> "Sending $pendingUploads saved readings…"
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

/**
 * A single-line divider between cockpit blocks.
 *
 * Not `HorizontalDivider`: at the contrast this app needs, Material's default is
 * invisible on the dark scheme through a windscreen reflection.
 */
@Composable
fun TerminalDivider(modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.6f)),
    )
}

/**
 * The pulsing dot beside "online".
 *
 * Stops entirely under reduced motion, rather than merely slowing: the point of
 * that setting is that nothing on the screen moves on its own, and a slower
 * pulse is still a pulse.
 */
@Composable
fun LivePulse(
    active: Boolean,
    tone: StatusTone = StatusTone.GOOD,
    modifier: Modifier = Modifier,
) {
    val reducedMotion = LocalReducedMotion.current
    val tint = tone.color()

    val alpha = if (active && !reducedMotion) {
        val transition = rememberInfiniteTransition(label = "pulse")
        transition.animateFloat(
            initialValue = 0.35f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(1_400, easing = LinearEasing),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "pulse-alpha",
        ).value
    } else {
        if (active) 1f else 0.35f
    }

    Box(
        modifier
            .size(10.dp)
            .clip(CircleShape)
            .background(
                Brush.radialGradient(
                    listOf(tint.copy(alpha = alpha), tint.copy(alpha = alpha * 0.4f)),
                ),
            )
            .border(1.dp, tint.copy(alpha = 0.7f), CircleShape),
    )
}
