package com.saarthi.driver.ui.design

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.saarthi.core.ui.LocalReducedMotion

/** A dot that breathes while something is live, and holds still when it is not. */
@Composable
fun LiveDot(color: Color, size: Dp = 8.dp, breathing: Boolean = true, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(size)
            .then(if (breathing) Modifier.breathing() else Modifier)
            .clip(CircleShape)
            .background(color),
    )
}

/** The design's status pill: tinted ground, a dot, 12/600 words. */
@Composable
fun StatusPill(
    text: String,
    background: Color,
    ink: Color,
    modifier: Modifier = Modifier,
    dot: Boolean = true,
    live: Boolean = false,
    dotColor: Color = ink,
    ring: Color? = null,
) {
    Row(
        modifier
            .clip(CircleShape)
            .background(background)
            .then(if (ring != null) Modifier.border(1.dp, ring, CircleShape) else Modifier)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (dot) LiveDot(dotColor, size = 8.dp, breathing = live)
        Text(text, style = SType.captionStrong, color = ink, maxLines = 1)
    }
}

/** What kind of news a notice carries; picks its wash, ring and dot. */
enum class NoticeTone { WARNING, DANGER, SUCCESS, INFO }

/**
 * A washed notice with a hairline ring — "A break is due soon", "No signal".
 *
 * Announced to screen readers as it appears, because every one of these is
 * something the driver should hear without looking for it.
 */
@Composable
fun NoticeCard(
    text: String,
    tone: NoticeTone,
    modifier: Modifier = Modifier,
    icon: String? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val c = Saarthi.colors
    val (wash, ring, ink, soft) = when (tone) {
        NoticeTone.WARNING -> listOf(c.warningWash, c.warningRing, c.warning, c.warningSoft)
        NoticeTone.DANGER -> listOf(c.dangerWash, c.dangerRing, c.danger, c.dangerSoft)
        NoticeTone.SUCCESS -> listOf(c.successWash, c.successGlow, c.success, c.successSoft)
        NoticeTone.INFO -> listOf(c.primaryWash, c.primaryRing, c.primary, c.primarySoft)
    }
    val shape = RoundedCornerShape(if (icon != null) 18.dp else 16.dp)
    Row(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(wash)
            .border(1.dp, ring, shape)
            .padding(horizontal = if (icon != null) 16.dp else 14.dp, vertical = 14.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = if (icon != null) Alignment.CenterVertically else Alignment.Top,
    ) {
        if (icon != null) {
            IconWell(icon, well = soft, ink = ink, size = 36.dp, shape = CircleShape, iconSize = 18.dp)
        } else {
            Box(
                Modifier
                    .padding(top = 6.dp)
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(ink),
            )
        }
        Text(text, style = SType.body, color = c.fg, modifier = Modifier.weight(1f))
        trailing?.invoke()
    }
}

/** The dark toast that confirms something happened — "Trip started. Drive safely." */
@Composable
fun Toast(text: String, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Color(0xFF18181B))
            .border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(16.dp))
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconWell(
            Lucide.check,
            well = Color(0xFF3DAE79),
            ink = Color(0xFF071D12),
            size = 26.dp,
            shape = CircleShape,
            iconSize = 14.dp,
            stroke = 3f,
        )
        Text(text, style = SType.bodyMedium, color = Color(0xFFF4F4F5))
    }
}

/**
 * A disc with a tick that writes itself — saved, approved, done.
 *
 * [halo] is the design's outer ring (`box-shadow: 0 0 0 14px`), drawn as a
 * wider circle behind the disc.
 */
@Composable
fun SuccessDisc(
    size: Dp,
    disc: Color,
    tick: Color,
    halo: Color = Color.Transparent,
    haloWidth: Dp = 14.dp,
    tickSize: Dp = size * 0.48f,
    tickStroke: Float = 2.8f,
    modifier: Modifier = Modifier,
    brand: Boolean = false,
) {
    val reduced = LocalReducedMotion.current
    val drawn = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) { if (!reduced) drawn.animateTo(1f, tween(600, 300, Ease.inOut)) }
    Box(modifier.size(size + haloWidth * 2).popIn(), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(size + haloWidth * 2)
                .clip(CircleShape)
                .background(halo),
        )
        Box(
            Modifier
                .size(size)
                .then(if (brand) Modifier.brandGradient(CircleShape) else Modifier.clip(CircleShape).background(disc)),
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.size(tickSize)) {
                drawTick(drawn.value, tick, tickStroke * this.size.minDimension / 24f)
            }
        }
    }
}

/**
 * Rings that expand and fade from behind a disc — the design's ripples and radar.
 *
 * Three rings a third of a period apart, so there is always one in flight.
 */
@Composable
fun BoxScope.RippleRings(
    color: Color,
    periodMs: Int = 2_400,
    from: Float = 0.9f,
    to: Float = 1.9f,
    startAlpha: Float = 0.55f,
    count: Int = 2,
    filled: Boolean = true,
    strokeWidth: Dp = 2.dp,
) {
    val phase by rememberLoop(periodMs, Ease.out, rest = -1f, label = "ripple")
    if (phase < 0f) return
    Canvas(Modifier.matchParentSize()) {
        val base = size.minDimension / 2f
        repeat(count) { index ->
            val t = (phase + index.toFloat() / count) % 1f
            val radius = base * (from + (to - from) * t)
            // The ring's own opacity fades over the colour's, as CSS
            // animating `opacity` over a translucent background does.
            val alpha = color.alpha * startAlpha * (1f - t)
            if (filled) {
                drawCircle(color.copy(alpha = alpha), radius)
            } else {
                drawCircle(color.copy(alpha = alpha), radius, style = Stroke(strokeWidth.toPx()))
            }
        }
    }
}

/**
 * A ring that fills once around its centre — sending a photo, saving a map.
 *
 * [fraction] drives it from outside; when it is null the ring fills over
 * [durationMs] by itself, which is what the design's upload ring does.
 */
@Composable
fun ProgressRing(
    track: Color,
    fill: Color,
    modifier: Modifier = Modifier,
    strokeWidth: Dp = 4.dp,
    fraction: Float? = null,
    durationMs: Int = 1_800,
) {
    val reduced = LocalReducedMotion.current
    val auto = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) { if (fraction == null && !reduced) auto.animateTo(1f, tween(durationMs, easing = Ease.inOut)) }
    val value = fraction ?: auto.value
    Canvas(modifier) {
        val stroke = strokeWidth.toPx()
        val inset = stroke / 2f
        val arcSize = Size(size.width - stroke, size.height - stroke)
        drawArc(track, 0f, 360f, false, Offset(inset, inset), arcSize, style = Stroke(stroke))
        drawArc(
            fill,
            -90f,
            360f * value.coerceIn(0f, 1f),
            false,
            Offset(inset, inset),
            arcSize,
            style = Stroke(stroke, cap = androidx.compose.ui.graphics.StrokeCap.Round),
        )
    }
}

/** A spinning partial ring, for "Submitting…" and "Connecting…". */
@Composable
fun RingSpinner(track: Color, head: Color, size: Dp, stroke: Dp, modifier: Modifier = Modifier) {
    val turn by rememberLoop(1_000, label = "ring-spin", rest = 0.15f)
    Canvas(modifier.size(size)) {
        val px = stroke.toPx()
        val inset = px / 2f
        val arcSize = Size(this.size.width - px, this.size.height - px)
        drawArc(track, 0f, 360f, false, Offset(inset, inset), arcSize, style = Stroke(px))
        rotate(turn * 360f) {
            drawArc(head, -90f, 90f, false, Offset(inset, inset), arcSize, style = Stroke(px))
        }
    }
}

/** A skeleton block — grey, rounded, with the design's shimmer sweeping across. */
@Composable
fun Skeleton(modifier: Modifier, color: Color, shine: Color, radius: Dp = 6.dp) {
    val sweep by rememberLoop(1_300, Ease.standard, rest = -1f, label = "shimmer")
    Box(
        modifier
            .clip(RoundedCornerShape(radius))
            .background(color)
            .drawWithContent {
                drawContent()
                if (sweep >= 0f) {
                    val width = size.width
                    val x = -width + 2f * width * sweep
                    drawRect(
                        Brush.horizontalGradient(
                            listOf(Color.Transparent, shine, Color.Transparent),
                            startX = x,
                            endX = x + width,
                        ),
                    )
                }
            },
    )
}

/** Paper-strip confetti falling once across a celebration screen. */
@Composable
fun BoxScope.Confetti(colors: List<Color>, lefts: List<Float>, fallHeight: Dp = 620.dp) {
    val reduced = LocalReducedMotion.current
    if (reduced) return
    val clock = remember { Animatable(0f) }
    LaunchedEffect(Unit) { clock.animateTo(1f, tween(3_000 + lefts.size * 80, easing = androidx.compose.animation.core.LinearEasing)) }
    Canvas(Modifier.fillMaxSize()) {
        val total = 3_000f + lefts.size * 80f
        lefts.forEachIndexed { index, left ->
            val start = index * 80f / total
            val span = 3_000f / total
            val t = ((clock.value - start) / span).coerceIn(0f, 1f)
            if (t <= 0f || t >= 1f) return@forEachIndexed
            val eased = Ease.out.transform(t)
            val alpha = when {
                t < 0.1f -> t / 0.1f
                else -> 1f - ((t - 0.1f) / 0.9f)
            }
            val x = size.width * left
            val y = -16.dp.toPx() + fallHeight.toPx() * eased
            rotate(560f * eased, pivot = Offset(x, y)) {
                drawRoundRect(
                    color = colors[index % colors.size].copy(alpha = alpha.coerceIn(0f, 1f)),
                    topLeft = Offset(x - 4.dp.toPx(), y - 7.dp.toPx()),
                    size = Size(8.dp.toPx(), 14.dp.toPx()),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(2.dp.toPx()),
                )
            }
        }
    }
}

/** The white flash of a shutter, once. */
@Composable
fun BoxScope.ShutterFlash(key: Any) {
    val alpha = remember(key) { Animatable(0.95f) }
    LaunchedEffect(key) { alpha.animateTo(0f, tween(500)) }
    if (alpha.value > 0f) {
        Box(
            Modifier
                .matchParentSize()
                .background(Color.White.copy(alpha = alpha.value)),
        )
    }
}

/** The small grey sentence under a card — footnotes and "why" lines. */
@Composable
fun Hint(text: String, modifier: Modifier = Modifier, color: Color = Saarthi.colors.subtle) {
    Text(text, style = SType.small, color = color, modifier = modifier.padding(horizontal = 4.dp))
}
