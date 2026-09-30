package com.saarthi.driver.ui.design

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.core.ui.LocalReducedMotion
import com.saarthi.driver.R

/**
 * How much of a PIN is in: four rings that fill and pop.
 *
 * Never the digits — a PIN readable over a shoulder in a queue is a PIN
 * somebody else knows. [shakeKey] changes to shake the row, which is how a
 * wrong PIN is shown without a word of red text in the way.
 */
@Composable
fun PinDots(entered: Int, length: Int = 4, shakeKey: Int = 0, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val reduced = LocalReducedMotion.current
    val shake = remember { Animatable(0f) }
    val px = with(LocalDensity.current) { 1.dp.toPx() }
    val described = stringResource(R.string.pin_progress, entered, length)
    LaunchedEffect(shakeKey) {
        if (shakeKey == 0 || reduced) return@LaunchedEffect
        shake.animateTo(
            0f,
            keyframes {
                durationMillis = 500
                -2f at 50
                4f at 100
                -6f at 150
                6f at 200
                -6f at 250
                6f at 300
                -6f at 350
                4f at 400
                -2f at 450
            },
        )
    }
    Row(
        modifier
            .fillMaxWidth()
            .graphicsLayer { translationX = shake.value * px }
            .semantics { contentDescription = described },
        horizontalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterHorizontally),
    ) {
        repeat(length) { index ->
            PinDot(on = index < entered, fill = c.primary, ring = c.borderStrong)
        }
    }
}

@Composable
private fun PinDot(on: Boolean, fill: Color, ring: Color) {
    val reduced = LocalReducedMotion.current
    val pop = remember { Animatable(1f) }
    LaunchedEffect(on) {
        if (on && !reduced) {
            pop.snapTo(0.55f)
            pop.animateTo(1f, tween(300, easing = Ease.pop))
        }
    }
    Box(
        Modifier
            .size(18.dp)
            .graphicsLayer { scaleX = pop.value; scaleY = pop.value }
            .clip(CircleShape)
            .background(if (on) fill else Color.Transparent)
            .then(if (on) Modifier else Modifier.border(2.dp, ring, CircleShape)),
    )
}

/**
 * The design's keypad: three columns, rounded keys, zero under the eight.
 *
 * A keypad rather than a keyboard, because a keyboard offers autocorrect, a
 * clipboard and a suggestion strip — a dozen places four digits could end up.
 */
@Composable
fun PinKeypad(
    onDigit: (Char) -> Unit,
    onBackspace: () -> Unit,
    modifier: Modifier = Modifier,
    keyHeight: Dp = 60.dp,
    enabled: Boolean = true,
) {
    val rows = listOf("123", "456", "789")
    val deleteLabel = stringResource(R.string.pin_delete)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        rows.forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { digit ->
                    Key(digit.toString(), keyHeight, Modifier.weight(1f), enabled) { onDigit(digit) }
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.weight(1f).height(keyHeight))
            Key("0", keyHeight, Modifier.weight(1f), enabled) { onDigit('0') }
            Box(
                Modifier
                    .weight(1f)
                    .height(keyHeight)
                    .clip(RoundedCornerShape(20.dp))
                    .pressable(enabled = enabled, scale = 0.93f, label = deleteLabel, onClick = onBackspace),
                contentAlignment = Alignment.Center,
            ) {
                LineIcon(
                    Lucide.backspace,
                    size = 26.dp,
                    color = Saarthi.colors.fg,
                    stroke = 1.8f,
                    description = deleteLabel,
                )
            }
        }
    }
}

@Composable
private fun Key(label: String, height: Dp, modifier: Modifier, enabled: Boolean, onClick: () -> Unit) {
    val c = Saarthi.colors
    Box(
        modifier
            .height(height)
            .card(radius = 20.dp)
            .pressable(enabled = enabled, scale = 0.93f, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style = SType.button.copy(fontSize = if (height >= 64.dp) 26.sp else 25.sp, fontWeight = FontWeight.Medium),
            color = c.fg,
        )
    }
}
