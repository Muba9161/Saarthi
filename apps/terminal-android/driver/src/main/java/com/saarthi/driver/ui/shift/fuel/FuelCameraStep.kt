package com.saarthi.driver.ui.shift.fuel

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.provider.Settings
import androidx.camera.core.ImageCapture
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.lifecycle.awaitInstance
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.lifecycleScope
import com.saarthi.core.ui.CameraBinding
import com.saarthi.driver.R
import com.saarthi.driver.ui.capturePhoto
import com.saarthi.driver.ui.design.Brand
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.ShutterFlash
import com.saarthi.driver.ui.design.rememberLoop
import com.saarthi.driver.ui.start.OverlayHint
import com.saarthi.driver.ui.start.rememberCameraAccess
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Step one: the slip, through the rear camera.
 *
 * Camera access is asked for as the step opens — the driver has just tapped
 * "Fuel slip", so the question is expected — and a refusal leaves the
 * viewfinder explaining why the camera matters, with the way to allow it.
 */
@Composable
internal fun FuelCameraStep(
    onShot: (jpeg: ByteArray, photo: ImageBitmap) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    val camera = rememberCameraAccess()
    val scope = rememberCoroutineScope()
    val latestShot by rememberUpdatedState(onShot)
    val capture = remember { ImageCapture.Builder().build() }
    var capturing by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var shots by remember { mutableIntStateOf(0) }

    LaunchedEffect(Unit) { if (!camera.granted) camera.request() }

    val shoot: () -> Unit = {
        capturing = true
        failed = false
        shots++
        val pressedAt = SystemClock.uptimeMillis()
        capturePhoto(
            capture = capture,
            tag = "fuel-slip",
            // Both callbacks arrive on CameraX's executor; state is set back on
            // the main thread, and never after this step has gone.
            onResult = { jpeg, photo ->
                scope.launch {
                    // Let the shutter flash finish before the step changes, as
                    // the design's 420 ms does, however quickly the camera was.
                    delay((FLASH_MS - (SystemClock.uptimeMillis() - pressedAt)).coerceAtLeast(0L))
                    capturing = false
                    latestShot(jpeg, photo)
                }
            },
            onFailure = {
                scope.launch {
                    capturing = false
                    failed = true
                }
            },
        )
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(stringResource(R.string.fuel_lead), style = SType.lead, color = c.muted)
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .clip(RoundedCornerShape(28.dp))
                .background(
                    Brush.radialGradient(
                        0f to Color(0xFF3A352E),
                        0.6f to Color(0xFF1E1B17),
                        1f to Color(0xFF0F0E0C),
                    ),
                ),
        ) {
            if (camera.granted) {
                RearViewfinder(capture, Modifier.matchParentSize())
                SlipGuide()
                Text(
                    stringResource(R.string.fuel_rear_camera),
                    style = SType.captionStrong,
                    color = Color.White,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(14.dp)
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = 0.5f))
                        .padding(horizontal = 12.dp, vertical = 7.dp),
                )
                OverlayHint(stringResource(R.string.fuel_frame_hint), Modifier.align(Alignment.BottomCenter))
            } else {
                CameraBlocked(onAllow = camera.request)
            }
            if (shots > 0) ShutterFlash(key = shots)
        }
        if (failed) NoticeCard(stringResource(R.string.photo_failed), NoticeTone.DANGER)
        SaarthiButton(
            stringResource(R.string.fuel_photograph),
            shoot,
            enabled = camera.granted,
            busy = capturing,
            busyText = stringResource(R.string.fuel_taking),
            leading = Lucide.camera,
        )
        Text(
            stringResource(R.string.fuel_photo_first),
            style = SType.small,
            color = c.subtle,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * The live preview from the rear camera, bound through `:core` as every camera
 * in the app is, and released as this step leaves.
 *
 * Released on purpose: the camera is bound to the activity, so left alone it
 * would keep running — privacy dot lit, battery draining — behind the figures
 * and on through the rest of the shift.
 */
@Composable
private fun RearViewfinder(capture: ImageCapture, modifier: Modifier) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val preview = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    DisposableEffect(lifecycleOwner) {
        CameraBinding.bind(context, lifecycleOwner, preview, preferFront = false, capture)
        onDispose {
            // The provider is already up, so this runs at once on the main
            // thread — before any rebind a retake makes. A destroyed lifecycle
            // cancels it, and CameraX has released the camera by then anyway.
            lifecycleOwner.lifecycleScope.launch {
                runCatching { ProcessCameraProvider.awaitInstance(context).unbindAll() }
            }
        }
    }
    AndroidView(factory = { preview }, modifier = modifier)
}

/** The dashed saffron frame a slip fits inside, glowing gently. A guide, never a check. */
@Composable
private fun BoxScope.SlipGuide() {
    val glow by rememberLoop(1_200, Ease.standard, reverse = true, rest = 1f, label = "slip-guide")
    Canvas(
        Modifier
            .matchParentSize()
            .graphicsLayer { alpha = 0.6f + 0.4f * glow },
    ) {
        val left = size.width * 0.22f
        val top = size.height * 0.12f
        val stroke = 3.dp.toPx()
        drawRoundRect(
            color = Brand.saffron,
            topLeft = Offset(left + stroke / 2, top + stroke / 2),
            size = Size(size.width * 0.56f - stroke, size.height * 0.72f - stroke),
            cornerRadius = CornerRadius(10.dp.toPx()),
            style = Stroke(
                width = stroke,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(10.dp.toPx(), 8.dp.toPx())),
            ),
        )
    }
}

/**
 * No camera: why it matters, the button that asks, and — for a driver who once
 * said "don't ask again", when Android stops showing the question — the way to
 * the app's settings.
 */
@Composable
private fun BoxScope.CameraBlocked(onAllow: () -> Unit) {
    val context = LocalContext.current
    Column(
        Modifier
            .align(Alignment.Center)
            .padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        LineIcon(Lucide.camera, size = 40.dp, color = Color.White.copy(alpha = 0.7f), stroke = 1.8f)
        Text(
            stringResource(R.string.fuel_camera_needed),
            style = SType.body,
            color = Color.White.copy(alpha = 0.85f),
            textAlign = TextAlign.Center,
        )
        SaarthiButton(stringResource(R.string.camera_allow), onAllow, tone = ButtonTone.WHITE, leading = Lucide.camera)
        LinkButton(
            stringResource(R.string.fuel_open_settings),
            onClick = { openAppSettings(context) },
            color = Color.White.copy(alpha = 0.8f),
            weight = FontWeight.Medium,
        )
    }
}

private fun openAppSettings(context: Context) {
    runCatching {
        context.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

/** How long the shutter flash plays before the figures step takes over. */
private const val FLASH_MS = 420L
