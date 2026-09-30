package com.saarthi.driver.ui.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The design's card: white (or near-black), a hairline ring and a soft shadow.
 *
 * `box-shadow: 0 1px 2px -1px …, 0 4px 12px -3px …, 0 0 0 1px ring`. The ring is
 * a border; the shadow is a low platform elevation whose colour carries the
 * design's opacity, so it stays as faint as the design draws it.
 */
@Composable
fun Modifier.card(
    radius: Dp = 20.dp,
    color: Color = Saarthi.colors.card,
    ring: Color = Saarthi.colors.ring,
    elevated: Boolean = true,
): Modifier {
    val shape = RoundedCornerShape(radius)
    val dark = Saarthi.colors.dark
    return this
        .then(
            if (elevated) {
                Modifier.shadow(
                    elevation = if (dark) 1.dp else 3.dp,
                    shape = shape,
                    ambientColor = Color.Black.copy(alpha = if (dark) 0.6f else 0.5f),
                    spotColor = Color.Black.copy(alpha = if (dark) 0.6f else 0.35f),
                )
            } else {
                Modifier
            },
        )
        .clip(shape)
        .background(color)
        .border(1.dp, ring, shape)
}

/** A padded card holding a column — most of what a tab is made of. */
@Composable
fun SaarthiCard(
    modifier: Modifier = Modifier,
    radius: Dp = 20.dp,
    padding: PaddingValues = PaddingValues(18.dp),
    spacing: Dp = 12.dp,
    color: Color = Saarthi.colors.card,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .card(radius = radius, color = color)
            .padding(padding),
        verticalArrangement = Arrangement.spacedBy(spacing),
        content = content,
    )
}

/** `.eyebrow` — the small upper-case line above a title. */
@Composable
fun Eyebrow(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Saarthi.colors.muted,
    align: TextAlign? = null,
    maxLines: Int = Int.MAX_VALUE,
) {
    Text(
        text.uppercase(),
        style = SType.eyebrow,
        color = color,
        modifier = modifier,
        textAlign = align,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

/** The label above a group of rows on the Profile tab: "YOUR WORK", "LANGUAGE". */
@Composable
fun GroupLabel(text: String, modifier: Modifier = Modifier) {
    Eyebrow(text, modifier.padding(start = 4.dp, end = 4.dp, top = 10.dp))
}

/** A rounded square holding an icon — the design's "well". */
@Composable
fun IconWell(
    path: String,
    well: Color,
    ink: Color,
    modifier: Modifier = Modifier,
    size: Dp = 44.dp,
    radius: Dp = 14.dp,
    iconSize: Dp = 20.dp,
    stroke: Float = 2f,
    shape: Shape = RoundedCornerShape(radius),
) {
    Box(
        modifier
            .size(size)
            .clip(shape)
            .background(well),
        contentAlignment = Alignment.Center,
    ) {
        LineIcon(path, size = iconSize, color = ink, stroke = stroke)
    }
}

/** A hairline under a row, inset the way the design draws `inset 0 -1px 0`. */
fun Modifier.bottomRule(color: Color, show: Boolean = true): Modifier =
    if (!show) this else drawBehind {
        drawLine(
            color = color,
            start = Offset(0f, size.height - 0.5.dp.toPx()),
            end = Offset(size.width, size.height - 0.5.dp.toPx()),
            strokeWidth = 1.dp.toPx(),
        )
    }

/** A hairline above a block. */
fun Modifier.topRule(color: Color): Modifier = drawBehind {
    drawLine(color, Offset(0f, 0.5.dp.toPx()), Offset(size.width, 0.5.dp.toPx()), 1.dp.toPx())
}
