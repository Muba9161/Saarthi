package com.saarthi.driver.ui.start

import androidx.camera.core.ImageCapture
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.saarthi.core.ui.CameraBinding
import com.saarthi.driver.R
import com.saarthi.driver.network.DriverApi
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.capturePhoto
import com.saarthi.driver.ui.design.ButtonRow
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LiveDot
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.ProgressRing
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.ShutterFlash
import com.saarthi.driver.ui.design.StepHeader
import com.saarthi.driver.ui.design.StepScreen
import com.saarthi.driver.ui.design.popIn
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.rememberLoop
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger

/**
 * The arrival photograph, taken on the driver's own phone.
 *
 * The fleet's approval rests on it — it is how somebody in an office knows the
 * person asking to drive this vehicle is who they think, standing at it — and
 * the server refuses a request without one, so it cannot be skipped. The
 * driver sees the photo before it goes, because a picture of a forehead in a
 * dark yard is theirs to catch; and a failed upload keeps the same bytes, so
 * Retry never asks somebody in the rain to pose again.
 */
@Composable
fun ArrivalPhotoScreen(viewModel: DriverViewModel, assignment: DriverApi.AssignmentDto) {
    val busy by viewModel.busy.collectAsState()
    val error by viewModel.error.collectAsState()
    val camera = rememberCameraAccess()
    val cameraFailed = stringResource(R.string.photo_failed)

    var jpeg by remember { mutableStateOf<ByteArray?>(null) }
    var preview by remember { mutableStateOf<ImageBitmap?>(null) }
    var capturing by remember { mutableStateOf(false) }
    var shots by remember { mutableIntStateOf(0) }
    val plate = assignment.registrationNumber

    val shot = preview
    when {
        shot != null && busy -> UploadingScreen(shot)
        shot != null -> PreviewScreen(
            photo = shot,
            shots = shots,
            error = error,
            onRetake = {
                jpeg = null
                preview = null
                viewModel.clearError()
            },
            onUse = { jpeg?.let { viewModel.submitSelfie(assignment.id, it) } },
        )
        else -> CaptureScreen(
            plate = plate,
            cameraGranted = camera.granted,
            onAllowCamera = camera.request,
            capturing = capturing,
            error = error,
            onCapture = { capture ->
                capturing = true
                capturePhoto(
                    capture = capture,
                    tag = "selfie",
                    onResult = { bytes, bitmap ->
                        capturing = false
                        jpeg = bytes
                        preview = bitmap
                        shots++
                    },
                    onFailure = {
                        capturing = false
                        viewModel.reportSelfieFailure(cameraFailed)
                    },
                )
            },
        )
    }
}

/** The step header both halves of this screen share, with its two-part rail. */
@Composable
private fun PhotoHeader(title: String) {
    val c = Saarthi.colors
    StepHeader(
        eyebrow = stringResource(R.string.photo_step, 2, 2),
        title = title,
        eyebrowColor = c.primary,
    )
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        repeat(2) {
            Box(
                Modifier
                    .weight(1f)
                    .height(5.dp)
                    .clip(CircleShape)
                    .background(c.primary),
            )
        }
    }
}

@Composable
private fun CaptureScreen(
    plate: String?,
    cameraGranted: Boolean,
    onAllowCamera: () -> Unit,
    capturing: Boolean,
    error: String?,
    onCapture: (ImageCapture) -> Unit,
) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val imageCapture = remember { ImageCapture.Builder().build() }
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }

    if (cameraGranted) {
        // Bound through `:core`, which owns the CameraX dependency. Front
        // camera where there is one; some rugged handsets have none, and a
        // photo a colleague takes beats no photo.
        LaunchedEffect(lifecycleOwner) {
            CameraBinding.bind(
                context = context,
                lifecycleOwner = lifecycleOwner,
                previewView = previewView,
                preferFront = true,
                imageCapture,
            )
        }
    }

    StepScreen(padding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 22.dp)) {
        PhotoHeader(stringResource(R.string.photo_title))
        Text(
            stringResource(R.string.photo_lead),
            style = SType.lead,
            color = c.muted,
            modifier = Modifier
                .padding(top = 14.dp)
                .rise(stagger(1)),
        )
        Box(
            Modifier
                .padding(top = 14.dp)
                .weight(1f)
                .fillMaxWidth()
                .rise(stagger(2))
                .clip(RoundedCornerShape(28.dp))
                .background(
                    Brush.radialGradient(
                        0f to Color(0xFF3A4150),
                        0.6f to Color(0xFF1A1E27),
                        1f to Color(0xFF0E1015),
                    ),
                ),
        ) {
            if (cameraGranted) {
                AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())
                FaceGuide()
                CameraChip(stringResource(R.string.photo_front_camera), Modifier.align(Alignment.TopStart))
                plate?.let {
                    Text(
                        it,
                        style = SType.plate(13.sp),
                        color = Color(0xFF18181B),
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(14.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color.White.copy(alpha = 0.92f))
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                }
                OverlayHint(stringResource(R.string.photo_hint), Modifier.align(Alignment.BottomCenter))
            } else {
                CameraRefused(onAllowCamera)
            }
        }
        error?.let { NoticeCard(it, NoticeTone.DANGER, Modifier.padding(top = 12.dp)) }
        Column(
            Modifier
                .fillMaxWidth()
                .padding(top = 16.dp)
                .rise(stagger(4)),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            val label = stringResource(R.string.photo_take)
            Box(
                Modifier
                    .size(78.dp)
                    .shadow(10.dp, CircleShape, spotColor = Color(0x6618181B))
                    .clip(CircleShape)
                    .background(c.card)
                    .pressable(enabled = cameraGranted && !capturing, scale = 0.94f, label = label) { onCapture(imageCapture) },
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier
                        .size(60.dp)
                        .clip(CircleShape)
                        .background(c.primary),
                    contentAlignment = Alignment.Center,
                ) {
                    LineIcon(Lucide.camera, size = 26.dp, color = c.onPrimary)
                }
                // The primary ring around the shutter: `box-shadow: 0 0 0 4px`.
                Canvas(Modifier.size(78.dp)) {
                    drawCircle(c.primary, radius = size.minDimension / 2f - 2.dp.toPx(), style = Stroke(4.dp.toPx()))
                }
            }
            Text(
                if (capturing) stringResource(R.string.photo_taking) else label,
                style = SType.bodyStrong.copy(fontSize = 14.sp),
                color = c.fg,
            )
        }
    }
}

/** The dashed saffron oval that turns slowly — where a face goes. A guide, never a check. */
@Composable
private fun BoxScope.FaceGuide() {
    val turn by rememberLoop(14_000, label = "face-guide", rest = 0f)
    Canvas(
        Modifier
            .align(Alignment.Center)
            .padding(bottom = 30.dp)
            .size(width = 200.dp, height = 260.dp),
    ) {
        rotate(turn * 360f) {
            drawOval(
                color = Color(0xFFFE5D09),
                topLeft = Offset(5.dp.toPx(), 5.dp.toPx()),
                size = Size(size.width - 10.dp.toPx(), size.height - 10.dp.toPx()),
                style = Stroke(
                    width = 3.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(10.dp.toPx(), 8.dp.toPx())),
                ),
            )
        }
    }
}

/** "Front camera" / "Rear camera", with a red dot that breathes while it records. */
@Composable
internal fun CameraChip(text: String, modifier: Modifier = Modifier) {
    Row(
        modifier
            .padding(14.dp)
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.5f))
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        LiveDot(Color(0xFFF43F5E), size = 7.dp)
        Text(text, style = SType.captionStrong, color = Color.White)
    }
}

/** The dark pill of advice at the foot of a viewfinder. */
@Composable
internal fun OverlayHint(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = SType.small,
        color = Color.White.copy(alpha = 0.9f),
        textAlign = TextAlign.Center,
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Color.Black.copy(alpha = 0.5f))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    )
}

/** No camera permission: say so, and offer the button that fixes it. */
@Composable
internal fun BoxScope.CameraRefused(onAllow: () -> Unit) {
    Column(
        Modifier
            .align(Alignment.Center)
            .padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        LineIcon(Lucide.camera, size = 40.dp, color = Color.White.copy(alpha = 0.7f), stroke = 1.8f)
        Text(
            stringResource(R.string.camera_needed_photo),
            style = SType.body,
            color = Color.White.copy(alpha = 0.85f),
            textAlign = TextAlign.Center,
        )
        SaarthiButton(stringResource(R.string.camera_allow), onAllow, tone = ButtonTone.WHITE, leading = Lucide.camera)
    }
}

/** The photo just taken, with the two decisions only the driver can make. */
@Composable
private fun PreviewScreen(
    photo: ImageBitmap,
    shots: Int,
    error: String?,
    onRetake: () -> Unit,
    onUse: () -> Unit,
) {
    StepScreen(padding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 22.dp)) {
        PhotoHeader(stringResource(R.string.photo_preview_title))
        Box(
            Modifier
                .padding(top = 14.dp)
                .weight(1f)
                .fillMaxWidth()
                .clip(RoundedCornerShape(28.dp)),
        ) {
            Image(
                bitmap = photo,
                contentDescription = stringResource(R.string.photo_preview_alt),
                contentScale = ContentScale.Crop,
                alignment = androidx.compose.ui.BiasAlignment(0f, -0.6f),
                modifier = Modifier
                    .fillMaxSize()
                    .popIn(from = 1.25f),
            )
            ShutterFlash(key = shots)
        }
        error?.let { NoticeCard(it, NoticeTone.DANGER, Modifier.padding(top = 12.dp)) }
        ButtonRow {
            SaarthiButton(
                stringResource(R.string.photo_retake),
                onRetake,
                Modifier
                    .weight(1f)
                    .padding(top = 16.dp)
                    .rise(stagger(3)),
                tone = ButtonTone.SECONDARY,
            )
            SaarthiButton(
                stringResource(if (error != null) R.string.action_try_again else R.string.photo_use),
                onUse,
                Modifier
                    .weight(1f)
                    .padding(top = 16.dp)
                    .rise(stagger(3)),
            )
        }
    }
}

/** The photo in a ring that fills while it travels to the fleet. */
@Composable
private fun UploadingScreen(photo: ImageBitmap) {
    val c = Saarthi.colors
    Column(
        Modifier
            .fillMaxSize()
            .background(c.canvas)
            .padding(horizontal = 32.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(26.dp, Alignment.CenterVertically),
    ) {
        Box(Modifier.size(168.dp).popIn(), contentAlignment = Alignment.Center) {
            ProgressRing(track = c.track, fill = c.primary, modifier = Modifier.size(168.dp), strokeWidth = 7.dp)
            Image(
                bitmap = photo,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                alignment = androidx.compose.ui.BiasAlignment(0f, -0.64f),
                modifier = Modifier
                    .size(140.dp)
                    .clip(CircleShape),
            )
        }
        Text(
            stringResource(R.string.photo_sending),
            style = SType.headerTitle.copy(fontSize = 19.sp),
            color = c.fg,
            textAlign = TextAlign.Center,
            modifier = Modifier.rise(stagger(2)),
        )
        Text(
            stringResource(R.string.photo_not_saved),
            style = SType.body,
            color = c.muted,
            textAlign = TextAlign.Center,
            modifier = Modifier.rise(stagger(3)),
        )
    }
}
