package com.saarthi.driver.ui

import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import com.saarthi.core.util.DebugLog
import java.util.concurrent.Executors

/**
 * Taking a photograph, once, for every screen that needs one.
 *
 * The driver app photographs two quite different things — a person at a vehicle,
 * and a till roll at a pump — and the *reading* of the result is identical: pull
 * the JPEG out of the `ImageProxy`, decode a preview, close the proxy whatever
 * happens. Two copies of that would drift, and the part that would drift is the
 * `finally` block: an `ImageProxy` never closed exhausts CameraX's buffer and
 * the camera silently stops producing frames a few shots later.
 *
 * Nothing is written to the gallery. Both of these are evidence belonging to a
 * fleet — a photograph of a person, a receipt for somebody's money — and a copy
 * left in shared storage would outlive every purpose it was taken for.
 */
internal fun capturePhoto(
    capture: ImageCapture,
    /** Names the screen in any log line, so a failure can be placed. */
    tag: String,
    onResult: (jpeg: ByteArray, preview: ImageBitmap) -> Unit,
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
                    DebugLog.warn(tag, "Could not read the photo: ${error.message}")
                    onFailure()
                } finally {
                    // Always. A proxy left open exhausts CameraX's buffer and
                    // the camera stops producing frames with no error at all.
                    image.close()
                }
            }

            override fun onError(exception: ImageCaptureException) {
                DebugLog.warn(tag, "Capture failed: ${exception.message}")
                onFailure()
            }
        },
    )
}
