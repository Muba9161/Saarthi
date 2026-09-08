package com.saarthi.driver.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.saarthi.core.ui.CameraBinding
import com.saarthi.core.util.DebugLog
import com.saarthi.driver.network.DriverApi
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.EmberBright
import com.saarthi.driver.ui.design.FieldLabel
import com.saarthi.driver.ui.design.FleetButton
import com.saarthi.driver.ui.design.FleetCard
import com.saarthi.driver.ui.design.FleetEnter
import com.saarthi.driver.ui.design.FleetError
import com.saarthi.driver.ui.design.FleetOutlineButton
import com.saarthi.driver.ui.design.FleetRadius
import com.saarthi.driver.ui.design.FleetScreen
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.FleetWorking
import com.saarthi.driver.ui.design.Obsidian
import com.saarthi.driver.ui.design.Slate
import com.saarthi.driver.ui.design.StatusPill
import com.saarthi.driver.ui.design.TrackingCode
import com.saarthi.driver.ui.design.rememberBreath
import java.util.concurrent.Executors

/**
 * The arrival photograph, taken on the driver's own phone.
 *
 * Deliberately here in the driver app and not in `:core`. The fitted tablet has
 * never taken one — it displays a photo somebody else uploaded — and Android
 * Auto must never be offered a camera at all. A capture surface in the shared
 * module would be a capture surface the car screen could reach.
 *
 * The fleet's approval rests on this photo: it is how somebody in an office
 * knows that the person asking to drive DL01AB1234 is the driver they think it
 * is, and that they were standing at the vehicle. The server enforces it —
 * `submitForApproval` refuses without one — so this screen is not a courtesy
 * and cannot be skipped.
 *
 * Three things it is careful about:
 *
 *  * **Preview before upload.** A photo taken at arm's length in a dark yard is
 *    often unusable, and the driver is the only person who can see that in time.
 *    Retake costs seconds; a rejected request costs a shift.
 *
 *  * **A refused permission is explained, not fatal.** The driver is sent to
 *    Settings rather than left on a black rectangle, because a camera permission
 *    denied once is denied silently for ever afterwards.
 *
 *  * **A failed upload keeps the photo.** The bytes stay in memory so Retry
 *    sends the same picture rather than asking somebody standing in the rain to
 *    take another one.
 */
@Composable
fun SelfieCaptureScreen(
    viewModel: DriverViewModel,
    assignment: DriverApi.AssignmentDto,
) {
    val context = LocalContext.current
    val busy by viewModel.busy.collectAsState()
    val error by viewModel.error.collectAsState()

    var captured by remember { mutableStateOf<ByteArray?>(null) }
    var preview by remember { mutableStateOf<ImageBitmap?>(null) }
    var capturing by remember { mutableStateOf(false) }
    var permitted by remember { mutableStateOf(cameraPermitted(context)) }

    FleetScreen {
        Spacer(Modifier.height(FleetSpace.base))

        FleetEnter(index = 0) {
            Column(Modifier.fillMaxWidth()) {
                StatusPill("Step 2 of 2", tint = EmberBright)
                Spacer(Modifier.height(FleetSpace.snug))
                Text(
                    "Arrival photo",
                    style = MaterialTheme.typography.headlineMedium,
                    color = Chalk,
                )
                Spacer(Modifier.height(FleetSpace.tight))
                Text(
                    "Your fleet needs a photo of you at the vehicle before they can " +
                        "approve you.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = Ash,
                )

                assignment.registrationNumber?.let { registration ->
                    Spacer(Modifier.height(FleetSpace.snug))
                    FieldLabel("Vehicle")
                    Spacer(Modifier.height(FleetSpace.hair))
                    TrackingCode(registration, size = 24.sp)
                }
            }
        }

        Spacer(Modifier.height(FleetSpace.roomy))

        if (!permitted) {
            /*
             * No camera, and no way to proceed.
             *
             * Said plainly rather than shown as a broken viewfinder. The photo
             * is mandatory server-side, so pretending the driver can carry on
             * would strand them at the next screen with a refusal they could
             * not act on.
             */
            FleetEnter(index = 1) {
                Column(Modifier.fillMaxWidth()) {
                    FleetError(
                        "Saarthi needs the camera to take your arrival photo. Allow " +
                            "camera access in your phone's settings for Saarthi, then " +
                            "come back.",
                    )
                    Spacer(Modifier.height(FleetSpace.base))
                    FleetOutlineButton(
                        label = "I have allowed it",
                        icon = Icons.Rounded.Refresh,
                        onClick = { permitted = cameraPermitted(context) },
                    )
                }
            }
            Spacer(Modifier.height(FleetSpace.wide))
            return@FleetScreen
        }

        val shot = preview
        if (shot != null) {
            // Preview, with the two decisions only the driver can make.
            FleetEnter(index = 1) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .aspectRatio(3f / 4f)
                        .clip(RoundedCornerShape(FleetRadius.card))
                        .background(Obsidian),
                ) {
                    Image(
                        bitmap = shot,
                        contentDescription = "The photo you just took",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }

            Spacer(Modifier.height(FleetSpace.base))

            if (busy) {
                FleetWorking("Sending your photo to the fleet…")
            } else {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(FleetSpace.snug),
                ) {
                    FleetOutlineButton(
                        label = "Retake",
                        icon = Icons.Rounded.Refresh,
                        modifier = Modifier.weight(1f),
                        onClick = {
                            captured = null
                            preview = null
                            viewModel.clearError()
                        },
                    )
                    FleetButton(
                        label = if (error != null) "Try again" else "Use this photo",
                        icon = Icons.Rounded.Check,
                        modifier = Modifier.weight(1f),
                        onClick = {
                            // The same bytes on every retry: nobody is asked to
                            // pose again because a tunnel dropped the upload.
                            captured?.let { viewModel.submitSelfie(assignment.id, it) }
                        },
                    )
                }
            }
        } else {
            FleetEnter(index = 1) {
                CameraViewfinder(
                    capturing = capturing,
                    onCapture = { capture ->
                        capturing = true
                        takePhoto(
                            capture = capture,
                            onResult = { bytes, bitmap ->
                                capturing = false
                                captured = bytes
                                preview = bitmap
                            },
                            onFailure = {
                                capturing = false
                                viewModel.reportSelfieFailure(
                                    "The camera could not take the photo. Try again.",
                                )
                            },
                        )
                    },
                )
            }
        }

        error?.let { message ->
            Spacer(Modifier.height(FleetSpace.snug))
            FleetError(message)
        }

        Spacer(Modifier.height(FleetSpace.wide))
    }
}

/**
 * The live camera, and the button that freezes it.
 *
 * Front-facing where there is one, falling back to the rear rather than failing:
 * some rugged handsets issued to drivers have no selfie camera at all, and a
 * photo taken by a colleague is worth more than no photo.
 *
 * The oval on the glass is a guide and nothing more — nothing is measured
 * against it and no photo is refused for missing it. It exists because a driver
 * holding a phone at arm's length in a yard takes a picture of their forehead
 * roughly a third of the time, and the retake costs everybody a minute.
 */
@Composable
private fun CameraViewfinder(
    capturing: Boolean,
    onCapture: (ImageCapture) -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val imageCapture = remember { ImageCapture.Builder().build() }
    val previewView = remember {
        PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
    }
    val breath by rememberBreath(2_600, restingAt = 0.7f)

    // Bound through `:core`, which owns the CameraX dependency and therefore the
    // Guava future its provider hands back. See `CameraBinding`.
    LaunchedEffect(lifecycleOwner) {
        CameraBinding.bind(
            context = context,
            lifecycleOwner = lifecycleOwner,
            previewView = previewView,
            preferFront = true,
            imageCapture,
        )
    }

    Column {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(3f / 4f)
                .clip(RoundedCornerShape(FleetRadius.card))
                .background(Obsidian),
        ) {
            AndroidView(
                factory = { previewView },
                modifier = Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(FleetRadius.card)),
            )

            Canvas(Modifier.fillMaxSize().clearAndSetSemantics { }) {
                val w = size.width
                val h = size.height
                val ovalW = w * 0.62f
                val ovalH = h * 0.52f

                drawOval(
                    color = EmberBright.copy(alpha = 0.35f + breath * 0.35f),
                    topLeft = Offset((w - ovalW) / 2f, (h - ovalH) / 2f - h * 0.04f),
                    size = Size(ovalW, ovalH),
                    style = Stroke(
                        width = 3f,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(18f, 14f), 0f),
                    ),
                )
            }
        }

        Spacer(Modifier.height(FleetSpace.snug))

        Text(
            "Stand where the vehicle number can be seen behind you if you can.",
            style = MaterialTheme.typography.bodySmall,
            color = Slate,
        )

        Spacer(Modifier.height(FleetSpace.base))

        FleetButton(
            label = "Take photo",
            busyLabel = "Taking the photo…",
            busy = capturing,
            icon = Icons.Rounded.CameraAlt,
            onClick = { onCapture(imageCapture) },
        )
    }
}

/** Whether the camera permission is granted right now, not when this first drew. */
private fun cameraPermitted(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
        PackageManager.PERMISSION_GRANTED

/**
 * Take one photograph, in memory.
 *
 * Never written to storage. The photo is a person's face at a place and time,
 * and a copy left in the phone's gallery would outlive every purpose it was
 * taken for — which is neither what the driver expects nor what the fleet needs.
 */
private fun takePhoto(
    capture: ImageCapture,
    onResult: (ByteArray, ImageBitmap) -> Unit,
    onFailure: () -> Unit,
) {
    capture.takePicture(
        Executors.newSingleThreadExecutor(),
        object : ImageCapture.OnImageCapturedCallback() {
            override fun onCaptureSuccess(image: ImageProxy) {
                try {
                    // `ImageCapture` gives JPEG by default, so the first plane
                    // is already the encoded file rather than raw planes to
                    // convert.
                    val buffer = image.planes[0].buffer
                    val bytes = ByteArray(buffer.remaining())
                    buffer.get(bytes)

                    val bitmap = android.graphics.BitmapFactory
                        .decodeByteArray(bytes, 0, bytes.size)
                        ?.asImageBitmap()

                    if (bitmap == null) onFailure() else onResult(bytes, bitmap)
                } catch (error: Exception) {
                    DebugLog.warn("selfie", "Could not read the photo: ${error.message}")
                    onFailure()
                } finally {
                    image.close()
                }
            }

            override fun onError(exception: ImageCaptureException) {
                DebugLog.warn("selfie", "Capture failed: ${exception.message}")
                onFailure()
            }
        },
    )
}
