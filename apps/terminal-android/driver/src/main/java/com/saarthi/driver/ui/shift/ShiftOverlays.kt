package com.saarthi.driver.ui.shift

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.core.telemetry.Position
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Brand
import com.saarthi.driver.ui.design.BrandMark
import com.saarthi.driver.ui.design.BottomSheet
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.InlineSpinner
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.PlateMono
import com.saarthi.driver.ui.design.RippleRings
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SystemBars
import com.saarthi.driver.ui.design.Toast
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.rememberLoop
import com.saarthi.driver.ui.design.rise
import java.util.Locale

/**
 * "Raise an emergency?" — the second, deliberate tap.
 *
 * The SOS button only arms; this screen fires. It stands down on its own after
 * a while, so a pocket press does not leave the phone primed for the shift.
 */
@Composable
fun SosOverlay(
    visible: Boolean,
    sending: Boolean,
    failed: Boolean,
    position: Position?,
    onSend: () -> Unit,
    onCancel: () -> Unit,
) {
    BackHandler(enabled = visible, onBack = onCancel)
    LaunchedEffect(visible, sending) {
        if (!visible || sending) return@LaunchedEffect
        kotlinx.coroutines.delay(SOS_STAND_DOWN_MS)
        onCancel()
    }
    AnimatedVisibility(visible, enter = fadeIn(tween(400)), exit = fadeOut(tween(250))) {
        SystemBars(lightContent = true)
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        0f to Brand.sosDeep,
                        0.55f to Brand.sosNight,
                        1f to Brand.sosBlack,
                    ),
                )
                .windowInsetsPadding(WindowInsets.statusBars)
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            BrandMark(height = 32.dp, plated = true, modifier = Modifier.padding(start = 20.dp, top = 4.dp))
            SosBeacon(
                Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 110.dp)
                    .size(260.dp),
            )
            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(
                    stringResource(R.string.sos_title),
                    style = SType.title.copy(fontSize = 30.sp, lineHeight = 34.sp, letterSpacing = (-0.035).em),
                    color = Color.White,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.rise(),
                )
                Text(
                    stringResource(if (failed) R.string.sos_failed else R.string.sos_body),
                    style = SType.lead.copy(lineHeight = 23.sp),
                    color = Color.White.copy(alpha = 0.82f),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.rise(60),
                )
                PositionPill(position, Modifier.rise(100))
                SendButton(sending, onSend, Modifier.padding(top = 8.dp).rise(140))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(56.dp)
                        .clip(RoundedCornerShape(18.dp))
                        .background(Color.White.copy(alpha = 0.12f))
                        .border(1.dp, Color.White.copy(alpha = 0.22f), RoundedCornerShape(18.dp))
                        .pressable(label = stringResource(R.string.action_cancel), onClick = onCancel)
                        .rise(180),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(stringResource(R.string.action_cancel), style = SType.button, color = Color.White)
                }
            }
        }
    }
}

/** Three rings spreading from a beating white disc. */
@Composable
private fun SosBeacon(modifier: Modifier) {
    val beat by rememberLoop(1_200, Ease.standard, reverse = true, rest = 0f, label = "sos-beat")
    Box(modifier, contentAlignment = Alignment.Center) {
        Box(Modifier.size(180.dp)) {
            RippleRings(Color.White.copy(alpha = 0.35f), periodMs = 2_200, from = 0.6f, to = 1.9f, startAlpha = 0.9f, count = 3, filled = false)
        }
        Box(
            Modifier
                .size(128.dp)
                .graphicsLayer {
                    scaleX = 1f + 0.06f * beat
                    scaleY = 1f + 0.06f * beat
                }
                .shadow(20.dp, CircleShape, spotColor = Color.Black.copy(alpha = 0.6f))
                .clip(CircleShape)
                .background(Color.White),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                stringResource(R.string.sos),
                style = SType.display.copy(fontSize = 34.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 0.04.em),
                color = Brand.sosBanner,
            )
        }
    }
}

@Composable
private fun PositionPill(position: Position?, modifier: Modifier) {
    Row(
        modifier
            .clip(CircleShape)
            .background(Color.White.copy(alpha = 0.12f))
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        LineIcon(Lucide.mapPin, size = 14.dp, color = Color.White)
        Text(
            position?.let {
                stringResource(
                    R.string.sos_position,
                    String.format(Locale.US, "%.4f", it.latitude),
                    String.format(Locale.US, "%.4f", it.longitude),
                )
            } ?: stringResource(R.string.sos_no_position),
            style = SType.small,
            color = Color.White,
        )
    }
}

@Composable
private fun SendButton(sending: Boolean, onSend: () -> Unit, modifier: Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .height(64.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(Color.White)
            .pressable(enabled = !sending, label = stringResource(R.string.sos_send), onClick = onSend),
        horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (sending) InlineSpinner(Brand.sosBanner, size = 20.dp, stroke = 3.dp)
        Text(
            stringResource(if (sending) R.string.sos_sending else R.string.sos_send),
            style = SType.button.copy(fontSize = 18.sp, fontWeight = FontWeight.Bold),
            color = Brand.sosBanner,
        )
    }
}

/** "Emergency raised" — stays until the driver dismisses it, with the fleet's reference. */
@Composable
fun BoxScope.SosBanner(reference: String?, onDismiss: () -> Unit) {
    AnimatedVisibility(
        reference != null,
        enter = slideInVertically(tween(550, easing = Ease.out)) { -it * 2 },
        exit = slideOutVertically(tween(300)) { -it * 2 },
        modifier = Modifier
            .align(Alignment.TopCenter)
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(start = 12.dp, end = 12.dp, top = 4.dp),
    ) {
        val beat by rememberLoop(1_200, Ease.standard, reverse = true, rest = 0f, label = "banner-beat")
        Row(
            Modifier
                .fillMaxWidth()
                .shadow(16.dp, RoundedCornerShape(18.dp), spotColor = Brand.sosBanner)
                .clip(RoundedCornerShape(18.dp))
                .background(Brand.sosBanner)
                .semantics { liveRegion = LiveRegionMode.Assertive }
                .padding(start = 16.dp, end = 10.dp, top = 14.dp, bottom = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier
                    .size(36.dp)
                    .graphicsLayer {
                        scaleX = 1f + 0.06f * beat
                        scaleY = 1f + 0.06f * beat
                    }
                    .clip(CircleShape)
                    .background(Color.White.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) {
                LineIcon(Lucide.siren, size = 18.dp, color = Color.White, stroke = 2.2f)
            }
            val template = stringResource(R.string.sos_banner, SOS_SLOT)
            val code = reference.orEmpty()
            Text(
                buildAnnotatedString {
                    val at = template.indexOf(SOS_SLOT)
                    if (at < 0) {
                        append(template)
                    } else {
                        append(template.substring(0, at))
                        withStyle(SpanStyle(fontFamily = PlateMono, fontWeight = FontWeight.Bold)) { append(code) }
                        append(template.substring(at + SOS_SLOT.length))
                    }
                },
                style = SType.bodyMedium,
                color = Color.White,
                modifier = Modifier.weight(1f),
            )
            CircleButton(
                Lucide.close,
                stringResource(R.string.sos_dismiss),
                onDismiss,
                size = 40.dp,
                iconSize = 16.dp,
                background = Color.White.copy(alpha = 0.16f),
                ink = Color.White,
                elevated = false,
                stroke = 2.4f,
            )
        }
    }
}

/** A short confirmation above the tab bar, which leaves by itself. */
@Composable
fun BoxScope.ShellToast(text: String?) {
    AnimatedVisibility(
        text != null,
        enter = fadeIn(tween(500, easing = Ease.out)) +
            slideInVertically(tween(500, easing = Ease.out)) { it / 3 } +
            scaleIn(tween(500, easing = Ease.out), initialScale = 0.96f),
        exit = fadeOut(tween(250)) + scaleOut(tween(250), targetScale = 0.96f),
        modifier = Modifier
            .align(Alignment.BottomCenter)
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(start = 20.dp, end = 20.dp, bottom = 112.dp),
    ) {
        Toast(text.orEmpty(), Modifier.shadow(16.dp, RoundedCornerShape(16.dp), spotColor = Color.Black.copy(alpha = 0.5f)))
    }
}

/** "Are you sure?" for the two things that cannot be undone from the cab. */
@Composable
fun ConfirmSheet(
    visible: Boolean,
    title: String,
    body: String,
    action: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    BackHandler(enabled = visible, onBack = onDismiss)
    BottomSheet(visible = visible, onDismiss = onDismiss) {
        val c = Saarthi.colors
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = SType.sheetTitle, color = c.fg)
            Text(body, style = SType.lead, color = c.muted)
            SaarthiButton(action, onConfirm, Modifier.padding(top = 8.dp), tone = ButtonTone.DANGER_OUTLINE)
            LinkButton(
                stringResource(R.string.action_cancel),
                onDismiss,
                Modifier.align(Alignment.CenterHorizontally),
                color = c.muted,
                weight = FontWeight.Medium,
            )
        }
    }
}

/** Placeholder the banner's reference is spliced into, so translations can move it. */
private const val SOS_SLOT = "\u0000"

/** An armed SOS nobody confirms stands down after this long. */
private const val SOS_STAND_DOWN_MS = 30_000L
