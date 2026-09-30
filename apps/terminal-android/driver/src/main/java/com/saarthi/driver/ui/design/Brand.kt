package com.saarthi.driver.ui.design

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import com.saarthi.driver.R
import com.saarthi.core.R as CoreR

/**
 * The brand ground: deep navy, a saffron glow bottom-right and a green one top-right.
 *
 * The design's `.brand` class, layer for layer — a 100° linear sweep through
 * three navies, with two elliptical radial glows in the right-hand corners. The
 * ellipses are drawn as circles under a vertical scale, which is how a CSS
 * `radial-gradient(38% 110% …)` is shaped.
 */
fun Modifier.brandGradient(shape: Shape = RectangleShape): Modifier =
    this
        .clip(shape)
        .drawWithCache {
            val w = size.width
            val h = size.height
            val angle = Math.toRadians(100.0)
            val dx = sin(angle).toFloat()
            val dy = -cos(angle).toFloat()
            val half = (abs(w * dx) + abs(h * dy)) / 2f
            val centre = Offset(w / 2f, h / 2f)
            val linear = Brush.linearGradient(
                0f to Brand.navyDeep,
                0.55f to Brand.navy,
                1f to Brand.navyBright,
                start = centre - Offset(dx * half, dy * half),
                end = centre + Offset(dx * half, dy * half),
            )
            onDrawBehind {
                drawRect(linear)
                ellipseGlow(
                    centre = Offset(w, 0f),
                    radiusX = 0.30f * w,
                    radiusY = 0.90f * h,
                    stops = arrayOf(0f to Color(0xBF028C48), 1f to Color(0x0002783F)),
                )
                ellipseGlow(
                    centre = Offset(w, h),
                    radiusX = 0.38f * w,
                    radiusY = 1.10f * h,
                    stops = arrayOf(
                        0f to Color(0xD9FE5D09),
                        0.35f to Color(0x59FE5D09),
                        1f to Color(0x00FE5D09),
                    ),
                )
            }
        }

private fun DrawScope.ellipseGlow(
    centre: Offset,
    radiusX: Float,
    radiusY: Float,
    stops: Array<Pair<Float, Color>>,
) {
    if (radiusX <= 0f || radiusY <= 0f) return
    scale(scaleX = 1f, scaleY = radiusY / radiusX, pivot = centre) {
        drawCircle(
            brush = Brush.radialGradient(*stops, center = centre, radius = radiusX),
            radius = radiusX,
            center = centre,
        )
    }
}

/**
 * The VorldX mark, sized by height, as every header in the design shows it.
 *
 * On a dark ground it sits on a white plate — the mark's navy disappears into
 * near-black otherwise — and on a light ground it stands on its own.
 */
@Composable
fun BrandMark(
    height: Dp = 36.dp,
    plated: Boolean = Saarthi.colors.dark,
    modifier: Modifier = Modifier,
) {
    val corner = if (height >= 34.dp) 10.dp else 9.dp
    val padX = if (plated) 7.dp * (height / 36.dp) else 0.dp
    val padY = if (plated) 5.dp * (height / 36.dp) else 2.dp
    // Sized from the height, as `height: 100%; width: auto` does: the mark's
    // own proportions decide the width, so it never stretches across a row.
    val width = (height - padY * 2) * MARK_RATIO + padX * 2
    Box(
        modifier
            .size(width = width, height = height)
            .clip(RoundedCornerShape(corner))
            .background(if (plated) Color.White else Color.Transparent)
            .padding(horizontal = padX, vertical = padY),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            painter = painterResource(CoreR.drawable.saarthi_mark),
            contentDescription = "VorldX Saarthi",
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

/** The mark's own proportions: 512 × 307. */
const val MARK_RATIO = 512f / 307f

/**
 * The whole VorldX Saarthi logo — mark, wordmark and strapline — for the
 * places with room to show it. Sized by height like [BrandMark], on a snug
 * white tile when the ground is dark so the navy wordmark still reads.
 */
@Composable
fun BrandLockup(
    height: Dp,
    plated: Boolean = Saarthi.colors.dark,
    modifier: Modifier = Modifier,
) {
    val pad = if (plated) height * 0.1f else 0.dp
    val width = (height - pad * 2) * LOCKUP_RATIO + pad * 2
    Box(
        modifier
            .size(width = width, height = height)
            .clip(RoundedCornerShape(height * 0.22f))
            .background(if (plated) Color.White else Color.Transparent)
            .padding(pad),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            painter = painterResource(R.drawable.brand_lockup),
            contentDescription = "VorldX Saarthi",
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

/** The full logo's own proportions: 900 × 813. */
private const val LOCKUP_RATIO = 900f / 813f

/**
 * What this app is called, and whose it is.
 *
 * Humsafar (हमसफ़र, "companion on the journey") is the app; VorldX Saarthi is
 * the platform that offers it and the name on the fleet's side. The QR on a
 * vehicle stays a "Saarthi code" and the voice assistant stays "Saarthi",
 * because those belong to the platform the driver meets through this app.
 */
object AppName {
    const val APP = "Humsafar"
    const val BY = "by VorldX Saarthi"
}

/** Two letters for a person, from their name — "Ravi Kumar" is RK. */
fun initialsOf(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
    return when {
        parts.isEmpty() -> "S"
        parts.size == 1 -> parts[0].take(1).uppercase()
        else -> (parts.first().take(1) + parts.last().take(1)).uppercase()
    }
}

/** A person, as the design draws them before there is a photograph: their initials. */
@Composable
fun Avatar(
    name: String,
    size: Dp,
    modifier: Modifier = Modifier,
    fontSize: TextUnit = (size.value * 0.34f).sp,
    background: Color = Color.White,
    ink: Color = Brand.navy,
    brand: Boolean = false,
) {
    Box(
        modifier
            .size(size)
            .then(
                if (brand) Modifier.brandGradient(CircleShape)
                else Modifier.clip(CircleShape).background(background),
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initialsOf(name),
            style = SType.bodyStrong.copy(fontSize = fontSize, fontWeight = FontWeight.Bold),
            color = if (brand) Color.White else ink,
        )
    }
}

/**
 * Soft colour drifting behind a brand panel — the design's `.aurora` blobs.
 *
 * Radial fades rather than blurred shapes: a Gaussian blur on a phone GPU for
 * a decoration is a battery cost with nothing to show for it, and a soft-edged
 * gradient reads the same.
 */
@Composable
fun BoxScope.Aurora() {
    val drift by rememberLoop(9_000, Ease.standard, reverse = true, rest = 0f, label = "aurora")
    Canvas(Modifier.matchParentSize()) {
        val blue = Offset(-60.dp.toPx() + 110.dp.toPx(), -40.dp.toPx() + 110.dp.toPx())
        val moveBlue = Offset(60.dp.toPx() * drift, 40.dp.toPx() * drift)
        drawCircle(
            Brush.radialGradient(
                listOf(Color(0x8C2360BE), Color(0x002360BE)),
                center = blue + moveBlue,
                radius = 130.dp.toPx() * (1f + 0.15f * drift),
            ),
            radius = 130.dp.toPx() * (1f + 0.15f * drift),
            center = blue + moveBlue,
        )
        val orange = Offset(size.width - 50.dp.toPx(), size.height - 40.dp.toPx())
        val moveOrange = Offset(-50.dp.toPx() * drift, -30.dp.toPx() * drift)
        drawCircle(
            Brush.radialGradient(
                listOf(Color(0x8CFE5D09), Color(0x00FE5D09)),
                center = orange + moveOrange,
                radius = 110.dp.toPx() * (1f + 0.1f * drift),
            ),
            radius = 110.dp.toPx() * (1f + 0.1f * drift),
            center = orange + moveOrange,
        )
    }
}

/**
 * The spinning brand ring around the logo — "Signing you in…", "Restoring…".
 *
 * A conic sweep from transparent through indigo, saffron and green, masked to a
 * ring and turned once every 1.1 s.
 */
@Composable
fun BrandSpinner(size: Dp = 136.dp, modifier: Modifier = Modifier) {
    val turn by rememberLoop(1_100, label = "brand-spin", rest = 0f)
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val ring = 6.dp.toPx()
            rotate(turn * 360f) {
                drawCircle(
                    brush = Brush.sweepGradient(
                        0f to Color(0x003B47BA),
                        (110f / 360f) to Color(0xFF3B47BA),
                        (230f / 360f) to Brand.saffron,
                        (320f / 360f) to Brand.green,
                        1f to Color(0x0002783F),
                    ),
                    radius = (this.size.minDimension - ring) / 2f,
                    style = Stroke(ring),
                )
            }
        }
        Box(
            Modifier
                .padding(14.dp * (size / 136.dp))
                .fillMaxSize()
                .clip(CircleShape)
                .background(Color.White),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painter = painterResource(CoreR.drawable.saarthi_mark),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .size(width = 68.dp * (size / 136.dp), height = 68.dp * (size / 136.dp) / MARK_RATIO),
            )
        }
    }
}

/** Draw a tick that writes itself, as the design's `.draw` checks do. */
fun DrawScope.drawTick(progress: Float, color: Color, strokeWidth: Float, box: Float = size.minDimension) {
    val unit = box / 24f
    val origin = Offset((size.width - box) / 2f, (size.height - box) / 2f)
    translate(origin.x, origin.y) {
        val a = Offset(20f * unit, 6f * unit)
        val b = Offset(9f * unit, 17f * unit)
        val c = Offset(4f * unit, 12f * unit)
        val first = (c - b).getDistance()
        val second = (b - a).getDistance()
        val total = first + second
        val drawn = total * progress.coerceIn(0f, 1f)
        // The tick is drawn short arm first, the way a hand writes it.
        val firstDrawn = drawn.coerceAtMost(first)
        if (firstDrawn > 0f) {
            drawLine(color, c, c + (b - c) * (firstDrawn / first), strokeWidth, StrokeCap.Round)
        }
        val secondDrawn = (drawn - first).coerceAtLeast(0f)
        if (secondDrawn > 0f) {
            drawLine(color, b, b + (a - b) * (secondDrawn / second), strokeWidth, StrokeCap.Round)
        }
    }
}
