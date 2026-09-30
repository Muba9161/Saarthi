package com.saarthi.driver.ui.design

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.saarthi.core.ui.LocalReducedMotion

/**
 * The design's switch: 52 × 32, a white knob that springs across.
 *
 * A real `Role.Switch` with its label, so a screen reader announces "4-digit
 * PIN, switch, on" rather than an unnamed tap target.
 */
@Composable
fun SaarthiSwitch(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val c = Saarthi.colors
    val reduced = LocalReducedMotion.current
    val knob by animateDpAsState(
        if (checked) 20.dp else 0.dp,
        if (reduced) tween(0) else tween(350, easing = Ease.pop),
        label = "switch-knob",
    )
    val track by animateColorAsState(
        if (checked) c.primary else if (c.dark) Color(0xFF3F3F46) else Color(0xFFCFCFD3),
        tween(300),
        label = "switch-track",
    )
    Box(
        modifier
            .size(width = 52.dp, height = 32.dp)
            .alpha(if (enabled) 1f else 0.45f)
            .clip(CircleShape)
            .background(track)
            .toggleable(
                value = checked,
                enabled = enabled,
                role = Role.Switch,
                onValueChange = onCheckedChange,
            )
            .semantics { contentDescription = label },
    ) {
        Box(
            Modifier
                .padding(4.dp)
                .offset(x = knob)
                .size(24.dp)
                .shadow(2.dp, CircleShape)
                .clip(CircleShape)
                .background(Color.White),
        )
    }
}

/**
 * A segmented control whose selected pill glides between options.
 *
 * Used for Scan code / Enter number, the trip filter and the papers filter —
 * the design draws all three the same way.
 */
@Composable
fun SegmentedControl(
    options: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    height: Dp = 48.dp,
    radius: Dp = 18.dp,
    textStyle: TextStyle = SType.buttonSmall,
    icons: List<String?> = emptyList(),
    container: Color = Saarthi.colors.segment,
    indicator: Color = Saarthi.colors.segmentOn,
) {
    val c = Saarthi.colors
    val reduced = LocalReducedMotion.current
    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(radius))
            .background(container)
            .padding(4.dp),
    ) {
        val cell = maxWidth / options.size
        val x by animateDpAsState(
            cell * selected,
            if (reduced) tween(0) else tween(500, easing = Ease.out),
            label = "segment",
        )
        Box(
            Modifier
                .offset(x = x)
                .width(cell)
                .height(height)
                .card(radius = radius - 4.dp, color = indicator),
        )
        Row(Modifier.fillMaxWidth()) {
            options.forEachIndexed { index, label ->
                val on = index == selected
                val ink by animateColorAsState(if (on) c.fg else c.muted, tween(300), label = "segment-ink")
                Row(
                    Modifier
                        .weight(1f)
                        .height(height)
                        .clip(RoundedCornerShape(radius - 4.dp))
                        .semantics { this.selected = on }
                        .pressable(role = Role.Tab, scale = 1f) { onSelect(index) },
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    icons.getOrNull(index)?.let {
                        LineIcon(it, size = 18.dp, color = ink)
                        Box(Modifier.width(8.dp))
                    }
                    Text(label, style = textStyle, color = ink, maxLines = 1)
                }
            }
        }
    }
}

/** A pill chip, filled when chosen — report categories, answer choices. */
@Composable
fun ChoiceChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onColor: Color = Saarthi.colors.fg,
    onInk: Color = Saarthi.colors.canvas,
    offColor: Color = Saarthi.colors.card,
    offInk: Color = Saarthi.colors.muted,
    height: Dp = 40.dp,
) {
    Box(
        modifier
            .height(height)
            .clip(CircleShape)
            .background(if (selected) onColor else offColor)
            .semantics { this.selected = selected }
            .pressable(role = Role.Tab, onClick = onClick)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = SType.chip, color = if (selected) onInk else offInk, maxLines = 1)
    }
}

/** A full-width row of equal cells, the design's `repeat(n, 1fr)` grid. */
@Composable
fun EqualRow(
    modifier: Modifier = Modifier,
    spacing: Dp = 10.dp,
    content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit,
) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(spacing), content = content)
}
