package com.saarthi.owner.ui.papers

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.saarthi.owner.network.OwnerApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume

/**
 * The text printed on a paper, recognised on the phone itself by Google's
 * on-device reader — the same ML Kit family the driver app scans QR codes
 * with. Nothing leaves the phone and nothing is paid for. A PDF is read from
 * its first pages only, drawn one at a time.
 */
internal object PaperScanner {

    private const val PDF_PAGES = 2

    /** Wide enough for small print on an A4 page to read cleanly. */
    private const val PDF_WIDTH_PX = 1600

    /** The paper's text, or null when nothing could be read off it. */
    suspend fun text(context: Context, file: OwnerApi.Upload): String? = withContext(Dispatchers.Default) {
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        try {
            val pages = if (file.mimeType == PDF) pdfText(context, file.bytes, recognizer) else listOfNotNull(imageText(file.bytes, recognizer))
            pages.joinToString("\n").ifBlank { null }
        } finally {
            recognizer.close()
        }
    }

    private suspend fun imageText(bytes: ByteArray, recognizer: TextRecognizer): String? =
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.let { recognise(recognizer, it) }

    /**
     * Each of the first pages drawn on white and read. A PDF the phone cannot
     * open — locked with a password, or damaged — reads as nothing, and the
     * person fills the details in instead.
     */
    private suspend fun pdfText(context: Context, bytes: ByteArray, recognizer: TextRecognizer): List<String> {
        val copy = File(File(context.cacheDir, "papers").apply { mkdirs() }, "scan-${System.nanoTime()}.pdf")
        return try {
            copy.writeBytes(bytes)
            ParcelFileDescriptor.open(copy, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
                PdfRenderer(descriptor).use { renderer ->
                    (0 until minOf(renderer.pageCount, PDF_PAGES)).map { index ->
                        val bitmap = renderer.openPage(index).use { page ->
                            val height = (page.height * PDF_WIDTH_PX.toFloat() / page.width).toInt().coerceAtLeast(1)
                            Bitmap.createBitmap(PDF_WIDTH_PX, height, Bitmap.Config.ARGB_8888).also { canvas ->
                                canvas.eraseColor(Color.WHITE)
                                page.render(canvas, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            }
                        }
                        // Not recycled by hand: a read cut short may still hold it.
                        recognise(recognizer, bitmap)
                    }
                }
            }
        } catch (unreadable: Exception) {
            if (unreadable is CancellationException) throw unreadable
            emptyList()
        } finally {
            copy.delete()
        }
    }

    /** One image's text; a page the reader fails on reads as blank rather than failing the upload. */
    private suspend fun recognise(recognizer: TextRecognizer, image: Bitmap): String = suspendCancellableCoroutine { waiting ->
        recognizer.process(InputImage.fromBitmap(image, 0))
            .addOnSuccessListener { result -> waiting.resume(result.text) }
            .addOnFailureListener { waiting.resume("") }
    }

    private const val PDF = "application/pdf"
}
