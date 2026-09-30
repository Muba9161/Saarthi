package com.saarthi.driver.ui.design

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.saarthi.core.ui.LocalReducedMotion

/**
 * A three-quarter dial, open at the bottom — the design's instrument gauge.
 *
 * Starts at the lower left and sweeps clockwise; [fraction] of the arc is lit.
 * A missing reading draws the empty track and nothing else, because a dial
 * resting at zero would be a reading the vehicle never gave.
 */
@Composable
fun ArcGauge(
    fraction: Float?,
    color: Color,
    modifier: Modifier = Modifier,
    size: Dp = 58.dp,
    stroke: Dp = 6.dp,
    track: Color = MapInk.sunken,
) {
    val reduced = LocalReducedMotion.current
    var arrived by remember { mutableStateOf(reduced) }
    LaunchedEffect(Unit) { arrived = true }
    val shown by animateFloatAsState(
        if (arrived) (fraction ?: 0f).coerceIn(0f, 1f) else 0f,
        if (reduced) tween(0) else tween(1_400, 350, Ease.out),
        label = "gauge",
    )
    Canvas(modifier.size(size)) {
        val px = stroke.toPx()
        // The design draws r = 24 on a 60 grid; scale that to our box.
        val radius = this.size.minDimension * 24f / 60f
        val topLeft = Offset(center.x - radius, center.y - radius)
        val arc = Size(radius * 2, radius * 2)
        drawArc(track, 135f, 270f, false, topLeft, arc, style = Stroke(px, cap = StrokeCap.Round))
        if (fraction != null && shown > 0f) {
            drawArc(color, 135f, 270f * shown, false, topLeft, arc, style = Stroke(px, cap = StrokeCap.Round))
        }
    }
}
