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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.core.R as CoreR
import com.saarthi.core.ui.LocalReducedMotion
import com.saarthi.driver.R

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
 * The hero panel on the first screen.
 *
 * A photograph of an artic under a warm key light, cropped to a tall rounded
 * block that fades into the page where the text begins. It is the only element
 * in the app allowed to be purely atmospheric.
 *
 * This replaced a lorry drawn in [Canvas]. The drawn one was defensible on
 * paper — it weighed nothing, themed with the palette and was nobody's vehicle
 * in particular — and it looked exactly like what it was. The screen that
 * decides whether a driver believes this is real software is the wrong place to
 * be seen economising, and a megabyte and a half on a sixty-eight megabyte APK
 * is not a saving worth a bad first impression.
 *
 * Two things about the asset are load-bearing:
 *
 *  * **It lives in `drawable-nodpi`.** Plain `drawable/` is the mdpi bucket, so
 *    on a 3x handset Android would decode it at three times its stored size —
 *    a 5016x2823 bitmap, about 57 MB of heap, on phones that do not have it to
 *    spare. `nodpi` decodes it as authored.
 *  * **Its ground is already near-black**, within a shade of [Obsidian], so the
 *    scrim below has almost nothing to hide and the panel dissolves into the
 *    page rather than ending at a seam.
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
        /*
         * A very slow push in.
         *
         * Six per cent over four seconds, once, on entry — under the threshold
         * where the eye reads it as movement, above the one where the screen
         * reads as a still. It settles and stops rather than looping, because a
         * hero that never stops breathing is a hero that keeps asking to be
         * looked at while somebody is trying to type a password underneath it.
         */
        val reducedMotion = LocalReducedMotion.current
        var entered by remember { mutableStateOf(reducedMotion) }
        LaunchedEffect(Unit) { entered = true }
        val push by animateFloatAsState(
            targetValue = if (entered) 1f else 0f,
            animationSpec = FleetMotion.enter(stillOr(4_000)),
            label = "hero",
        )

        Image(
            painter = painterResource(R.drawable.splash_truck),
            contentDescription = "An articulated lorry under a warm light",
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    scaleX = 1.06f - push * 0.06f
                    scaleY = 1.06f - push * 0.06f
                },
        )

        // A last wash into the page colour, so the panel dissolves rather than
        // stopping. The image's own floor is already dark, so this only has to
        // carry the final quarter.
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0.55f to Color.Transparent,
                        1f to Obsidian,
                    ),
                ),
        )
    }
}

/**
 * The company's actual logo, name and tagline together.
 *
 * The real lockup rather than the app's own arrangement of the parts. The splash
 * used to draw the mark on a chip and then set "SAARTHI" and "DRIVER" in the
 * app's own typeface underneath — a wordmark assembled here rather than the one
 * the company actually uses, with the tagline missing entirely.
 *
 * On a white card, and that is not decoration. The logotype is navy and the
 * tagline is navy on a transparent ground; dropped straight onto Obsidian the
 * name and the tagline both disappear and only the saffron and green survive.
 * The white card is how the web app solves the identical problem, and inventing
 * a knockout variant of somebody's logo would be worse than reusing the
 * treatment that exists.
 */
@Composable
fun BrandLockup(
    modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.Dp = 200.dp,
) {
    Box(
        modifier
            .size(size)
            .clip(RoundedCornerShape(size * 0.16f))
            .background(Color.White),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            painter = painterResource(R.drawable.brand_lockup),
            // The whole identity, so a screen reader says the company's name
            // rather than "image".
            contentDescription = "VorldX Saarthi — manage, track, move, together",
            modifier = Modifier
                .fillMaxSize()
                // The artwork carries its own margin; a second one would leave
                // the logo swimming in white.
                .padding(size * 0.04f),
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
            painter = painterResource(CoreR.drawable.saarthi_mark),
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
            /*
             * One image, not three components.
             *
             * The tagline used to be typed out underneath in the app's own
             * face — "Manage. Track. Move. Together." — while the real logo
             * carries it already, spaced and coloured as the brand sets it.
             * Two versions of a tagline on one screen is one too many, and the
             * one that should survive is the company's.
             */
            BrandLockup(size = 220.dp)
        }
    }
}
