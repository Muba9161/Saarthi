package com.saarthi.driver.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.saarthi.core.ui.CameraBinding
import com.saarthi.core.ui.TerminalPage
import com.saarthi.core.util.DebugLog
import com.saarthi.driver.network.DriverApi
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

    TerminalPage {
        Text(
            "Arrival photo",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Text(
            assignment.registrationNumber?.let {
                "Take a photo of yourself at $it. Your fleet needs it to approve you."
            } ?: "Take a photo of yourself at the vehicle.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(16.dp))

        if (!permitted) {
            /*
             * No camera, and no way to proceed.
             *
             * Said plainly rather than shown as a broken viewfinder. The photo
             * is mandatory server-side, so pretending the driver can carry on
             * would strand them at the next screen with a refusal they could
             * not act on.
             */
            Text(
                "Saarthi needs the camera to take your arrival photo. Allow camera " +
                    "access in your phone's settings for Saarthi, then come back.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.error,
            )
            Spacer(Modifier.height(12.dp))
            OutlinedButton(
                onClick = { permitted = cameraPermitted(context) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("I have allowed it")
            }
            return@TerminalPage
        }

        val shot = preview
        if (shot != null) {
            // Preview, with the two decisions only the driver can make.
            Surface(
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier.fillMaxWidth().aspectRatio(3f / 4f),
            ) {
                androidx.compose.foundation.Image(
                    bitmap = shot,
                    contentDescription = "The photo you just took",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }

            Spacer(Modifier.height(16.dp))

            if (busy) {
                CircularProgressIndicator()
                Spacer(Modifier.height(8.dp))
                Text(
                    "Sending your photo…",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    OutlinedButton(
                        onClick = {
                            captured = null
                            preview = null
                            viewModel.clearError()
                        },
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("Retake")
                    }
                    Button(
                        onClick = {
                            // The same bytes on every retry: nobody is asked to
                            // pose again because a tunnel dropped the upload.
                            captured?.let { viewModel.submitSelfie(assignment.id, it) }
                        },
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(if (error != null) "Try again" else "Use this photo")
                    }
                }
            }
        } else {
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

        error?.let { message ->
            Spacer(Modifier.height(12.dp))
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

/**
 * The live camera, and the button that freezes it.
 *
 * Front-facing where there is one, falling back to the rear rather than failing:
 * some rugged handsets issued to drivers have no selfie camera at all, and a
 * photo taken by a colleague is worth more than no photo.
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

    Surface(
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth().aspectRatio(3f / 4f),
    ) {
        AndroidView(
            factory = { previewView },
            modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(20.dp)),
        )
    }

    Spacer(Modifier.height(16.dp))

    Button(
        onClick = { onCapture(imageCapture) },
        enabled = !capturing,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(if (capturing) "Taking the photo…" else "Take photo")
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
