package com.saarthi.driver.ui.splash

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.AppName
import com.saarthi.driver.ui.design.Brand
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.rememberLoop

/**
 * The first thing a driver sees: the VorldX lockup drawing itself.
 *
 * The design's sequence, shortened to fit a real launch: each stroke of the
 * mark traces in turn, then the full-colour lockup floods in from the left and
 * the tracing lines fade behind it. It holds the finished logo for as long as
 * the session takes to restore.
 *
 * Under reduced motion the lockup is simply there.
 */
@Composable
fun SplashScreen() {
    val c = Saarthi.colors
    val reduced = Saarthi.reducedMotion
    val clock = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!reduced) clock.animateTo(1f, tween(TOTAL_MS, easing = LinearEasing))
    }
    val drift by rememberLoop(7_000, Ease.standard, reverse = true, rest = 0.5f, label = "splash-drift")

    Box(
        Modifier
            .fillMaxSize()
            .background(if (c.dark) Color(0xFF080C17) else Color(0xFFEEF2F8))
            .drawBehind {
                // The ground's centre sits high, as `at 50% 18%` places it.
                drawRect(
                    Brush.radialGradient(
                        colorStops = if (c.dark) {
                            arrayOf(0f to Color(0xFF0D1526), 0.62f to Color(0xFF080C17), 1f to Color(0xFF05080F))
                        } else {
                            arrayOf(0f to Color.White, 0.58f to Color(0xFFEEF2F8), 1f to Color(0xFFDFE7F2))
                        },
                        center = Offset(size.width / 2f, size.height * 0.18f),
                        radius = size.height * 0.9f,
                    ),
                )
                // Saffron top-left, green bottom-right, drifting slowly.
                val shift = (drift - 0.5f) * 0.06f
                drawCircle(
                    Brush.radialGradient(
                        listOf(Color(0x29FE5D09), Color.Transparent),
                        center = Offset(size.width * (0.22f + shift), size.height * (0.30f + shift)),
                        radius = size.width * 0.55f,
                    ),
                    radius = size.width * 0.55f,
                    center = Offset(size.width * (0.22f + shift), size.height * (0.30f + shift)),
                )
                drawCircle(
                    Brush.radialGradient(
                        listOf(Color(0x2902783F), Color.Transparent),
                        center = Offset(size.width * (0.78f - shift), size.height * (0.68f - shift)),
                        radius = size.width * 0.6f,
                    ),
                    radius = size.width * 0.6f,
                    center = Offset(size.width * (0.78f - shift), size.height * (0.68f - shift)),
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(30.dp),
        ) {
            Lockup(progress = clock.value, dark = c.dark)
            // The app's own name under the platform's lockup, set in the
            // design's spaced capitals — the lockup already carries the tagline.
            Text(
                AppName.APP.uppercase(),
                style = SType.bodyStrong.copy(letterSpacing = 0.34.em),
                color = if (c.dark) Color(0xFF8B9CB8) else Color(0xFF5A6B85),
                modifier = Modifier.graphicsLayer {
                    val t = ((clock.value * TOTAL_MS - 420f) / 700f).coerceIn(0f, 1f)
                    alpha = if (reduced) 1f else Ease.out.transform(t)
                    translationY = (1f - Ease.out.transform(t)) * 6.dp.toPx()
                },
            )
        }
    }
}

/**
 * The lockup: strokes, then the flood of colour.
 *
 * [progress] runs 0 → 1 across [TOTAL_MS]. Strokes start in their `at` order
 * over the first ~0.75 s and each takes [STROKE_MS] to draw; the full-colour
 * image then sweeps in from the left, and the lines fade out behind it.
 */
@Composable
private fun Lockup(progress: Float, dark: Boolean) {
    val strokes = remember {
        SplashTrace.map { stroke ->
            val path = PathParser().parsePathString(stroke.d).toPath()
            val measure = PathMeasure().apply { setPath(path, false) }
            Triple(stroke, path, measure.length)
        }
    }
    val scratch = remember { Path() }
    val measure = remember { PathMeasure() }
    val elapsed = progress * TOTAL_MS

    val reveal = ((elapsed - FLOOD_START_MS) / FLOOD_MS).coerceIn(0f, 1f).let(Ease.inOut::transform)
    val traceAlpha = 1f - ((elapsed - TRACE_FADE_START_MS) / 300f).coerceIn(0f, 1f)
    val navy = if (dark) Color(0xFF9DB7E6) else Brand.ink

    Box(
        Modifier
            .width(226.dp)
            .aspectRatio(900f / 813f)
            .semantics { contentDescription = "VorldX Saarthi" },
    ) {
        if (dark) {
            // The pale plate the design lays under the logo on a dark ground.
            Box(
                Modifier
                    .matchParentSize()
                    .graphicsLayer {
                        alpha = reveal
                        scaleX = 0.96f + 0.04f * reveal
                        scaleY = 0.96f + 0.04f * reveal
                    }
                    .drawBehind {
                        val grow = 17.dp.toPx()
                        drawRoundRect(
                            Color(0xFFF4F4F5),
                            topLeft = Offset(-grow, -18.dp.toPx()),
                            size = androidx.compose.ui.geometry.Size(size.width + grow * 2, size.height + 36.dp.toPx()),
                            cornerRadius = androidx.compose.ui.geometry.CornerRadius(28.dp.toPx()),
                        )
                    },
            )
        }
        Image(
            painter = painterResource(R.drawable.brand_lockup),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxWidth()
                .matchParentSize()
                .graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)
                .drawWithContent {
                    drawContent()
                    if (reveal < 1f) {
                        // A soft-edged wipe, left to right, as the design's
                        // moving gradient mask does.
                        val edge = size.width * 0.33f
                        val front = -edge + (size.width + edge * 2) * reveal
                        drawRect(
                            Brush.horizontalGradient(
                                0f to Color.Black,
                                1f to Color.Transparent,
                                startX = front - edge,
                                endX = front,
                            ),
                            blendMode = BlendMode.DstIn,
                        )
                    }
                },
        )
        if (traceAlpha > 0f) {
            Canvas(
                Modifier
                    .matchParentSize()
                    .graphicsLayer { alpha = traceAlpha },
            ) {
                scale(size.width / 900f, size.height / 813f, pivot = Offset.Zero) {
                    strokes.forEach { (stroke, path, length) ->
                        val start = stroke.at * STAGGER_MS
                        val t = ((elapsed - start) / STROKE_MS).coerceIn(0f, 1f)
                        if (t <= 0f || length <= 0f) return@forEach
                        val color = when (stroke.ink) {
                            TraceInk.NAVY -> navy
                            TraceInk.SAFFRON -> Brand.saffron
                            TraceInk.GREEN -> Brand.green
                        }
                        val style = Stroke(5f, cap = StrokeCap.Round, join = StrokeJoin.Round)
                        if (t >= 1f) {
                            drawPath(path, color, style = style)
                        } else {
                            scratch.reset()
                            measure.setPath(path, false)
                            measure.getSegment(0f, length * Ease.inOut.transform(t), scratch, true)
                            drawPath(scratch, color, style = style)
                        }
                    }
                }
            }
        }
    }
}

/** The whole sequence. */
private const val TOTAL_MS = 2_200

/** How the strokes' `at` values spread across time. */
private const val STAGGER_MS = 750f

/** How long one stroke takes to draw. */
private const val STROKE_MS = 600f

private const val FLOOD_START_MS = 1_050f
private const val FLOOD_MS = 700f
private const val TRACE_FADE_START_MS = 1_700f
