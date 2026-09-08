package com.saarthi.driver.ui.design

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.core.R
import com.saarthi.core.ui.LocalReducedMotion
import kotlin.math.sin

/**
 * The face of the app.
 *
 * The screens a driver sees before they have signed in are the only ones that
 * have to *sell* anything, and the thing being sold is that this is real
 * software from a real company rather than something a yard manager knocked
 * together. That is almost entirely a matter of the first screen.
 *
 * The lorry is drawn rather than photographed, and that is a decision worth
 * stating. A stock photograph would be a licence to track, a megabyte in an APK
 * a driver downloads on their own data, and — the real problem — a vehicle from
 * a fleet that is not theirs. A drawn one scales to any handset, weighs
 * nothing, themes with the palette, and is honest about being an illustration.
 */

/**
 * A lorry, in side profile, on a lit road.
 *
 * Deliberately generic: a cab and a box trailer, no maker's grille and no
 * livery. It reads as "haulage" at a glance and as nobody's vehicle in
 * particular on a second look, which is the correct amount of specificity for
 * a screen shown to drivers from every fleet on the platform.
 */
@Composable
fun TruckIllustration(
    modifier: Modifier = Modifier,
    rolling: Boolean = true,
) {
    val reducedMotion = LocalReducedMotion.current
    val sweep by rememberSweep(1_200)
    val breath by rememberBreath(3_000, restingAt = 0.5f)

    // A very small vertical bob. Enough to suggest a running engine, far short
    // of anything that would read as the screen being unstable.
    val bob = if (reducedMotion || !rolling) 0f else sin(breath * Math.PI).toFloat() * 2f

    Canvas(
        modifier.semantics {
            contentDescription = "An illustration of an articulated lorry on a road"
        },
    ) {
        val w = size.width
        val h = size.height

        val road = h * 0.78f
        val wheelR = h * 0.075f
        val wheelCy = road - wheelR
        val bodyBottom = wheelCy - h * 0.01f
        val trailerTop = h * 0.30f
        val cabTop = h * 0.24f

        // --- Ground and horizon ------------------------------------------
        //
        // A warm bloom on the horizon behind the vehicle. It is what stops the
        // illustration reading as a sticker pasted onto a black rectangle.
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(Ember.copy(alpha = 0.20f), Color.Transparent),
                center = Offset(w * 0.62f, road),
                radius = w * 0.55f,
            ),
            radius = w * 0.55f,
            center = Offset(w * 0.62f, road),
        )

        drawLine(
            color = Hairline,
            start = Offset(0f, road),
            end = Offset(w, road),
            strokeWidth = 2f,
        )

        // Lane markings, travelling backwards under the vehicle.
        val dash = w * 0.06f
        val gap = w * 0.05f
        val shift = if (reducedMotion || !rolling) 0f else sweep * (dash + gap)
        drawLine(
            color = Slate.copy(alpha = 0.5f),
            start = Offset(-dash + shift, road + h * 0.045f),
            end = Offset(w + dash + shift, road + h * 0.045f),
            strokeWidth = 3f,
            cap = StrokeCap.Round,
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash, gap), 0f),
        )

        /*
         * No speed lines behind the tail.
         *
         * They were tried, and there is not enough canvas to the left of the
         * trailer to hold them: they ran off the edge and read as rendering
         * artefacts rather than as motion. The lane markings travelling under
         * the wheels already say the vehicle is moving, and they say it inside
         * the frame.
         */

        // Everything from here up moves together with the bob.
        translate(0f, bob) {

            // --- Trailer --------------------------------------------------
            drawRoundRect(
                brush = Brush.verticalGradient(
                    listOf(Color(0xFF2A2E35), Color(0xFF191C21)),
                ),
                topLeft = Offset(w * 0.06f, trailerTop),
                size = Size(w * 0.50f, bodyBottom - trailerTop),
                cornerRadius = CornerRadius(w * 0.012f),
            )
            drawRoundRect(
                color = Hairline,
                topLeft = Offset(w * 0.06f, trailerTop),
                size = Size(w * 0.50f, bodyBottom - trailerTop),
                cornerRadius = CornerRadius(w * 0.012f),
                style = Stroke(width = 2f),
            )

            // Ribs. A blank box reads as a shipping container; the ribs are
            // what make it a curtain-sided trailer.
            for (i in 1..5) {
                val x = w * (0.06f + 0.50f * (i / 6f))
                drawLine(
                    color = Color.Black.copy(alpha = 0.35f),
                    start = Offset(x, trailerTop + h * 0.02f),
                    end = Offset(x, bodyBottom - h * 0.02f),
                    strokeWidth = 2f,
                )
            }

            // The stripe. The one place the brand colour touches the vehicle.
            drawRoundRect(
                brush = EmberSweep,
                topLeft = Offset(w * 0.06f, trailerTop + (bodyBottom - trailerTop) * 0.62f),
                size = Size(w * 0.50f, h * 0.035f),
                cornerRadius = CornerRadius(w * 0.004f),
            )

            // --- Cab ------------------------------------------------------
            val cab = Path().apply {
                moveTo(w * 0.575f, bodyBottom)
                lineTo(w * 0.575f, cabTop)
                lineTo(w * 0.86f, cabTop)
                cubicTo(
                    w * 0.905f, cabTop,
                    w * 0.93f, cabTop + h * 0.05f,
                    w * 0.93f, cabTop + h * 0.10f,
                )
                lineTo(w * 0.93f, bodyBottom - h * 0.02f)
                cubicTo(
                    w * 0.93f, bodyBottom,
                    w * 0.92f, bodyBottom,
                    w * 0.90f, bodyBottom,
                )
                close()
            }
            drawPath(cab, brush = Brush.verticalGradient(listOf(EmberBright, Ember, EmberDeep)))
            drawPath(cab, color = Color.Black.copy(alpha = 0.25f), style = Stroke(width = 2f))

            // Windscreen and side glass, as one dark slab with a highlight.
            val glass = Path().apply {
                moveTo(w * 0.60f, cabTop + h * 0.03f)
                lineTo(w * 0.855f, cabTop + h * 0.03f)
                cubicTo(
                    w * 0.895f, cabTop + h * 0.035f,
                    w * 0.905f, cabTop + h * 0.07f,
                    w * 0.905f, cabTop + h * 0.115f,
                )
                lineTo(w * 0.60f, cabTop + h * 0.115f)
                close()
            }
            drawPath(
                glass,
                brush = Brush.verticalGradient(listOf(Color(0xFF3E4A5C), Color(0xFF1B2029))),
            )
            drawLine(
                color = Color.White.copy(alpha = 0.22f),
                start = Offset(w * 0.62f, cabTop + h * 0.05f),
                end = Offset(w * 0.78f, cabTop + h * 0.05f),
                strokeWidth = 3f,
                cap = StrokeCap.Round,
            )

            // The gap between cab and trailer, so the two do not read as one box.
            drawRect(
                color = Color(0xFF101216),
                topLeft = Offset(w * 0.556f, trailerTop + h * 0.04f),
                size = Size(w * 0.02f, bodyBottom - trailerTop - h * 0.04f),
            )

            // Skirt and headlight.
            drawRoundRect(
                color = Color(0xFF15171B),
                topLeft = Offset(w * 0.575f, bodyBottom - h * 0.035f),
                size = Size(w * 0.355f, h * 0.035f),
                cornerRadius = CornerRadius(w * 0.006f),
            )
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(Color(0xFFFFF3D6), Color.Transparent),
                    center = Offset(w * 0.925f, bodyBottom - h * 0.055f),
                    radius = w * 0.05f,
                ),
                radius = w * 0.05f,
                center = Offset(w * 0.925f, bodyBottom - h * 0.055f),
            )

            // --- Wheels ---------------------------------------------------
            for (cx in listOf(w * 0.15f, w * 0.27f, w * 0.66f, w * 0.86f)) {
                drawCircle(Color(0xFF0D0E11), radius = wheelR, center = Offset(cx, wheelCy))
                drawCircle(
                    Color(0xFF2C3037),
                    radius = wheelR,
                    center = Offset(cx, wheelCy),
                    style = Stroke(width = 3f),
                )
                drawCircle(Color(0xFF383D45), radius = wheelR * 0.42f, center = Offset(cx, wheelCy))
            }
        }
    }
}

/**
 * The hero panel on the first screen.
 *
 * A tall rounded block with the illustration in it, an ember wash behind and a
 * fade into the page at the bottom so the panel does not end on a hard edge
 * where the text begins. It is the only element in the app allowed to be purely
 * atmospheric.
 */
@Composable
fun BrandHero(
    modifier: Modifier = Modifier,
    height: androidx.compose.ui.unit.Dp = 260.dp,
) {
    val shape = RoundedCornerShape(
        topStart = 0.dp,
        topEnd = 0.dp,
        bottomStart = FleetRadius.hero,
        bottomEnd = FleetRadius.hero,
    )

    Box(
        modifier
            .fillMaxWidth()
            .height(height)
            .clip(shape)
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF1A1D22), Color(0xFF101216), Obsidian),
                ),
            ),
    ) {
        TruckIllustration(Modifier.fillMaxSize().padding(horizontal = FleetSpace.base))

        // A last wash into the page colour, so the panel dissolves rather than
        // stopping.
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0.72f to Color.Transparent,
                        1f to Obsidian,
                    ),
                ),
        )
    }
}

/**
 * The mark, on a chip.
 *
 * The Saarthi logo is navy on transparency; dropped straight onto a near-black
 * ground the navy disappears and only the saffron and green survive. The white
 * chip is how the web app solves the same problem, and inventing a knockout
 * variant of the artwork would be worse than reusing the one that exists.
 */
@Composable
fun BrandMark(
    modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.Dp = 72.dp,
) {
    Box(
        modifier
            .size(size)
            .clip(RoundedCornerShape(size * 0.28f))
            .background(Color.White)
            .border(1.dp, Color.White.copy(alpha = 0.6f), RoundedCornerShape(size * 0.28f)),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            painter = painterResource(R.drawable.saarthi_mark),
            contentDescription = "Saarthi",
            modifier = Modifier.fillMaxSize().padding(size * 0.16f),
        )
    }
}

/**
 * The wordmark.
 *
 * Widely tracked capitals with the product word underneath in the accent. Kept
 * as one component so the two lines cannot drift apart between the splash and
 * the sign-in screen, which is exactly what had happened before.
 */
@Composable
fun BrandWordmark(
    modifier: Modifier = Modifier,
    subtitle: String = "DRIVER",
) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            "SAARTHI",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            letterSpacing = 8.sp,
            color = Chalk,
            textAlign = TextAlign.Center,
        )
        Text(
            subtitle,
            style = MaterialTheme.typography.labelMedium,
            letterSpacing = 11.sp,
            color = EmberBright,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * The entrance.
 *
 * Shown while the app works out whether the driver is already signed in, which
 * on a warm start is a few frames and on a cold one covers a real network wait.
 * It gates nothing: the root swaps it out the moment the answer arrives.
 */
@Composable
fun FleetSplash(modifier: Modifier = Modifier) {
    val reducedMotion = LocalReducedMotion.current
    var entered by remember { mutableStateOf(reducedMotion) }
    LaunchedEffect(Unit) { entered = true }

    val progress by animateFloatAsState(
        targetValue = if (entered) 1f else 0f,
        animationSpec = FleetMotion.enter(stillOr(620)),
        label = "splash",
    )

    Box(
        modifier
            .fillMaxSize()
            .background(FleetGround),
        contentAlignment = Alignment.Center,
    ) {
        // A single ember bloom behind the mark, so the screen has a centre.
        Canvas(Modifier.fillMaxSize().clearAndSetSemantics { }) {
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(Ember.copy(alpha = 0.16f * progress), Color.Transparent),
                    center = center,
                    radius = size.minDimension * 0.55f,
                ),
                radius = size.minDimension * 0.55f,
            )
        }

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(FleetSpace.roomy),
            modifier = Modifier.graphicsLayer {
                alpha = progress
                scaleX = 0.94f + progress * 0.06f
                scaleY = 0.94f + progress * 0.06f
            },
        ) {
            BrandMark(size = 88.dp)
            BrandWordmark()
            Spacer(Modifier.height(FleetSpace.tight))
            Text(
                "Manage. Track. Move. Together.",
                style = MaterialTheme.typography.bodyMedium,
                color = Ash,
                textAlign = TextAlign.Center,
            )
        }
    }
}
