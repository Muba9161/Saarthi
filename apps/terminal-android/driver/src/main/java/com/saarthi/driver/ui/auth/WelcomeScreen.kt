package com.saarthi.driver.ui.auth

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import com.saarthi.driver.R
import com.saarthi.driver.ui.common.currentLanguage
import com.saarthi.driver.ui.design.AppName
import com.saarthi.driver.ui.design.BrandLockup
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SystemBars
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger
import kotlinx.coroutines.delay

private class Slide(
    @DrawableRes val image: Int,
    @StringRes val alt: Int,
    /** Where the photo's focus sits, as the design's `object-position`. */
    val focusX: Float,
    val focusY: Float,
    @StringRes val eyebrow: Int,
    @StringRes val title: Int,
    @StringRes val body: Int,
)

private val Slides = listOf(
    Slide(
        R.drawable.welcome_cab_road,
        R.string.welcome_1_alt,
        0.5f, 0.3f,
        R.string.welcome_1_eyebrow,
        R.string.welcome_1_title,
        R.string.welcome_1_body,
    ),
    Slide(
        R.drawable.driver_role,
        R.string.welcome_2_alt,
        0.5f, 0.22f,
        R.string.welcome_2_eyebrow,
        R.string.welcome_2_title,
        R.string.welcome_2_body,
    ),
    Slide(
        R.drawable.welcome_night_truck,
        R.string.welcome_3_alt,
        0.3f, 0.5f,
        R.string.welcome_3_eyebrow,
        R.string.welcome_3_title,
        R.string.welcome_3_body,
    ),
)

/**
 * The welcome carousel: three photographs, three sentences, two doors.
 *
 * Stories-style — the bars at the top fill over five seconds each, a tap on
 * the right moves on and a tap on the left goes back — because it is a pattern
 * every driver's phone has already taught them.
 */
@Composable
fun WelcomeScreen(
    onSignIn: () -> Unit,
    onCreate: () -> Unit,
    onLanguage: () -> Unit,
) {
    SystemBars(lightContent = true)
    val reduced = Saarthi.reducedMotion
    var index by rememberSaveable { mutableIntStateOf(0) }
    // Bumped on every change so the story bar and the zoom restart.
    var epoch by remember { mutableIntStateOf(0) }

    LaunchedEffect(index, epoch) {
        if (reduced) return@LaunchedEffect
        delay(SLIDE_MS.toLong())
        index = (index + 1) % Slides.size
        epoch++
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0xFF111113)),
    ) {
        Slides.forEachIndexed { i, slide ->
            SlideImage(slide, visible = i == index, epoch = epoch)
        }
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0f to Color(0xB8111113),
                        0.24f to Color(0x00111113),
                        0.36f to Color(0x00111113),
                        0.62f to Color(0xE0111113),
                        0.82f to Color(0xFF111113),
                    ),
                ),
        )

        // Tap zones: back on the left third, forward on the rest.
        Row(
            Modifier
                .fillMaxWidth()
                .padding(top = 110.dp)
                .height(300.dp),
        ) {
            Box(
                Modifier
                    .weight(0.38f)
                    .fillMaxHeight()
                    .pressable(scale = 1f, label = stringResource(R.string.welcome_previous)) {
                        index = (index + Slides.size - 1) % Slides.size
                        epoch++
                    },
            )
            Box(
                Modifier
                    .weight(0.62f)
                    .fillMaxHeight()
                    .pressable(scale = 1f, label = stringResource(R.string.welcome_next)) {
                        index = (index + 1) % Slides.size
                        epoch++
                    },
            )
        }

        Column(
            Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(start = 20.dp, end = 20.dp, top = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Slides.forEachIndexed { i, _ ->
                    StoryBar(
                        state = when {
                            i < index -> 1
                            i == index -> 0
                            else -> -1
                        },
                        epoch = epoch,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(Modifier.shadow(10.dp, RoundedCornerShape(13.dp))) {
                    BrandLockup(height = 60.dp, plated = true)
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        AppName.APP,
                        style = SType.bodyStrong.copy(letterSpacing = (-0.01).em),
                        color = Color.White,
                    )
                    Text(
                        AppName.BY,
                        style = SType.captionStrong,
                        color = Color.White.copy(alpha = 0.72f),
                        maxLines = 1,
                    )
                }
                Row(
                    Modifier
                        .height(36.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.14f))
                        .border(1.dp, Color.White.copy(alpha = 0.2f), CircleShape)
                        .pressable(label = stringResource(R.string.language_sheet_title), onClick = onLanguage)
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    LineIcon(Lucide.languages, size = 14.dp, color = Color.White)
                    // The language in force, in its own script; the design's
                    // "English · हिन्दी" until the driver has picked one.
                    Text(
                        currentLanguage(LocalContext.current)?.nativeName ?: "English · हिन्दी",
                        style = SType.captionStrong,
                        color = Color.White,
                    )
                }
            }
        }

        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.navigationBars)
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            AnimatedContent(
                targetState = index,
                transitionSpec = { fadeIn(tween(400)) togetherWith fadeOut(tween(200)) },
                label = "welcome-copy",
            ) { shown ->
                val slide = Slides[shown]
                Column(
                    Modifier.padding(bottom = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Eyebrow(stringResource(slide.eyebrow), Modifier.rise(stagger(1)), color = Color(0xFFFE8A4B))
                    Text(
                        stringResource(slide.title),
                        style = SType.hero,
                        color = Color.White,
                        modifier = Modifier.rise(stagger(2)),
                    )
                    Text(
                        stringResource(slide.body),
                        style = SType.lead,
                        color = Color.White.copy(alpha = 0.78f),
                        modifier = Modifier.rise(stagger(3)),
                    )
                }
            }
            SaarthiButton(
                stringResource(R.string.welcome_sign_in),
                onSignIn,
                Modifier.rise(stagger(4)),
                tone = ButtonTone.WHITE,
            )
            SaarthiButton(
                stringResource(R.string.welcome_create),
                onCreate,
                Modifier.rise(stagger(5)),
                tone = ButtonTone.GHOST,
            )
        }
    }
}

/** One photograph: cross-fades in over a second and eases back from a slight zoom. */
@Composable
private fun SlideImage(slide: Slide, visible: Boolean, epoch: Int) {
    val reduced = Saarthi.reducedMotion
    val alpha by animateFloatAsState(if (visible) 1f else 0f, tween(1_000), label = "slide-fade")
    val zoom = remember { Animatable(1f) }
    LaunchedEffect(visible, epoch) {
        if (visible && !reduced) {
            zoom.snapTo(1.14f)
            zoom.animateTo(1f, tween(7_000, easing = Ease.standard))
        }
    }
    if (alpha <= 0f) return
    Image(
        painter = painterResource(slide.image),
        contentDescription = stringResource(slide.alt),
        contentScale = ContentScale.Crop,
        alignment = BiasAlignment(slide.focusX * 2f - 1f, slide.focusY * 2f - 1f),
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer {
                this.alpha = alpha
                scaleX = zoom.value
                scaleY = zoom.value
            },
    )
}

/** One segment of the story rail: done, filling, or waiting. */
@Composable
private fun StoryBar(state: Int, epoch: Int, modifier: Modifier) {
    val reduced = Saarthi.reducedMotion
    val fill = remember { Animatable(0f) }
    LaunchedEffect(state, epoch) {
        when (state) {
            1 -> fill.snapTo(1f)
            -1 -> fill.snapTo(0f)
            else -> {
                fill.snapTo(0f)
                if (reduced) fill.snapTo(0.55f) else fill.animateTo(1f, tween(SLIDE_MS, easing = LinearEasing))
            }
        }
    }
    Box(
        modifier
            .height(3.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(Color.White.copy(alpha = 0.28f)),
    ) {
        Box(
            Modifier
                .matchParentSize()
                .graphicsLayer {
                    scaleX = fill.value
                    transformOrigin = TransformOrigin(0f, 0.5f)
                }
                .background(Color.White),
        )
    }
}

private const val SLIDE_MS = 5_000
