package com.saarthi.driver.ui.design

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.driver.R

/** How a full-width button is painted. */
enum class ButtonTone { PRIMARY, SECONDARY, BRAND, WHITE, GHOST, DANGER_OUTLINE, MAP }

/**
 * The design's `.btn`: 56 tall, 16 radius, 16/600, full width.
 *
 * One component for every tone, so a busy state, an icon either side and the
 * press behaviour are identical wherever a button appears.
 */
@Composable
fun SaarthiButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tone: ButtonTone = ButtonTone.PRIMARY,
    enabled: Boolean = true,
    busy: Boolean = false,
    busyText: String? = null,
    leading: String? = null,
    trailing: String? = null,
    height: Dp = 56.dp,
    radius: Dp = 16.dp,
    textStyle: TextStyle = SType.button,
    leadingTint: Color? = null,
) {
    val c = Saarthi.colors
    val shape = RoundedCornerShape(radius)
    val (container, fullInk) = when (tone) {
        ButtonTone.PRIMARY -> c.primary to c.onPrimary
        ButtonTone.SECONDARY -> c.card to c.fg
        ButtonTone.BRAND -> Color.Transparent to Color.White
        ButtonTone.WHITE -> Color.White to Brand.navy
        ButtonTone.GHOST -> Color.White.copy(alpha = 0.12f) to Color.White
        ButtonTone.DANGER_OUTLINE -> c.card to c.danger
        ButtonTone.MAP -> MapInk.sunken to MapInk.fg
    }
    val weight = when (tone) {
        ButtonTone.SECONDARY, ButtonTone.GHOST -> FontWeight.Medium
        else -> textStyle.fontWeight ?: FontWeight.SemiBold
    }
    val active = enabled && !busy
    // Dimmed by colour rather than by an alpha layer: the ground stays solid,
    // and there is no extra layer to go stale when the screen swaps around it.
    val ink = if (enabled) fullInk else fullInk.copy(alpha = fullInk.alpha * 0.45f)
    Row(
        modifier
            .fillMaxWidth()
            .height(height)
            .then(
                if (tone == ButtonTone.BRAND) {
                    Modifier.shadow(12.dp, shape, spotColor = Brand.navyDeep, ambientColor = Color.Transparent)
                } else {
                    Modifier
                },
            )
            .then(if (tone == ButtonTone.BRAND) Modifier.brandGradient(shape) else Modifier.clip(shape))
            .background(container)
            .then(
                when (tone) {
                    ButtonTone.SECONDARY -> Modifier.border(1.dp, c.border, shape)
                    ButtonTone.GHOST -> Modifier.border(1.dp, Color.White.copy(alpha = 0.26f), shape)
                    ButtonTone.DANGER_OUTLINE -> Modifier.border(1.dp, c.dangerRing, shape)
                    else -> Modifier
                },
            )
            .pressable(enabled = active, scale = 0.985f, onClick = onClick),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (busy) {
            InlineSpinner(color = ink, size = 18.dp)
            Spacer(Modifier.width(8.dp))
        } else if (leading != null) {
            LineIcon(leading, size = 20.dp, color = leadingTint ?: ink)
            Spacer(Modifier.width(8.dp))
        }
        Text(
            if (busy) busyText ?: text else text,
            style = textStyle.copy(fontWeight = weight),
            color = ink,
            maxLines = 1,
        )
        if (!busy && trailing != null) {
            Spacer(Modifier.width(8.dp))
            LineIcon(trailing, size = 18.dp, color = ink, stroke = 2.2f)
        }
    }
}

/** `.link` — a word that acts, 44 tall so a thumb can find it. */
@Composable
fun LinkButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = Saarthi.colors.primary,
    style: TextStyle = SType.bodyStrong,
    weight: FontWeight = FontWeight.SemiBold,
    enabled: Boolean = true,
) {
    Box(
        modifier
            .defaultMinSize(minHeight = 44.dp)
            .clip(RoundedCornerShape(10.dp))
            .pressable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = style.copy(fontWeight = weight), color = color)
    }
}

/**
 * A round icon button — back, close, bell, mute.
 *
 * Always named: an icon-only control with nothing for a screen reader to say is
 * a control a blind driver's helper cannot use.
 */
@Composable
fun CircleButton(
    path: String,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 44.dp,
    iconSize: Dp = 18.dp,
    background: Color = Saarthi.colors.card,
    ink: Color = Saarthi.colors.fg,
    elevated: Boolean = true,
    stroke: Float = 2.2f,
    shape: androidx.compose.ui.graphics.Shape = CircleShape,
    ring: Color? = null,
    /** A solid part of the glyph, such as the dot in the recentre crosshair. */
    fill: String? = null,
    content: (@Composable () -> Unit)? = null,
) {
    Box(
        modifier
            .size(size)
            .then(if (elevated) Modifier.card(radius = size / 2, color = background) else Modifier)
            .clip(shape)
            .then(if (!elevated) Modifier.background(background) else Modifier)
            .then(if (ring != null) Modifier.border(1.dp, ring, shape) else Modifier)
            .pressable(scale = 0.92f, label = description, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        LineIcon(path, size = iconSize, color = ink, stroke = stroke, fill = fill, description = description)
        content?.invoke()
    }
}

/**
 * The SOS pill, which glows gently so it is found without being looked for.
 *
 * Opens a confirmation; it never raises anything on its own. The fleet is only
 * called out from the confirm screen, because a single tap on a phone in a
 * cradle is raised by potholes.
 */
@Composable
fun SosButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    height: Dp = 44.dp,
    color: Color = Saarthi.colors.sos,
) {
    val glow by rememberLoop(1_300, Ease.standard, reverse = true, rest = 0f, label = "sos-glow")
    val raise = stringResource(R.string.sos_raise)
    Row(
        modifier
            .height(height)
            .drawBehind {
                drawRoundRect(
                    color = color.copy(alpha = 0.18f + 0.22f * glow),
                    topLeft = androidx.compose.ui.geometry.Offset(-3.dp.toPx() * glow, 2.dp.toPx()),
                    size = androidx.compose.ui.geometry.Size(
                        size.width + 6.dp.toPx() * glow,
                        size.height + 2.dp.toPx() * glow,
                    ),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(size.height),
                )
            }
            .clip(CircleShape)
            .background(color)
            .pressable(scale = 0.92f, label = raise, onClick = onClick)
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        LineIcon(Lucide.siren, size = 16.dp, color = Color.White, stroke = 2.2f)
        Text(
            stringResource(R.string.sos),
            style = SType.chip.copy(fontWeight = FontWeight.Bold, letterSpacing = 0.78.sp),
            color = Color.White,
        )
    }
}

/** The small ring that spins inside a busy button. */
@Composable
fun InlineSpinner(color: Color, size: Dp = 18.dp, stroke: Dp = 2.5.dp, modifier: Modifier = Modifier) {
    val turn by rememberLoop(1_000, label = "inline-spin", rest = 0.2f)
    Canvas(modifier.size(size)) {
        rotate(turn * 360f) {
            drawArc(
                color = color,
                startAngle = 0f,
                sweepAngle = 270f,
                useCenter = false,
                style = Stroke(stroke.toPx()),
                topLeft = androidx.compose.ui.geometry.Offset(stroke.toPx() / 2, stroke.toPx() / 2),
                size = androidx.compose.ui.geometry.Size(
                    this.size.width - stroke.toPx(),
                    this.size.height - stroke.toPx(),
                ),
            )
        }
    }
}

/** A row of buttons sharing the width equally, as the design's two-button grids do. */
@Composable
fun ButtonRow(content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), content = content)
}
