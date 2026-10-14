package com.saarthi.owner.ui.payments

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.core.content.FileProvider
import com.saarthi.owner.R
import com.saarthi.owner.network.PaymentsApi
import java.io.File
import java.io.OutputStream
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** A receipt saved on the phone: where it is, and how the person was told. */
data class SavedReceipt(val uri: Uri, val inDownloads: Boolean)

/**
 * Draw [receipt] as a one-page PDF and keep it: in Downloads/Saarthi on
 * Android 10 and later, where the person finds it in Files; in the app's own
 * cache before that, from where it is shared. [forWhat] says what was paid
 * for, "Cab for 3 people to Ayodhya".
 *
 * A payment receipt only — Saarthi issues no tax invoice here, and the page
 * says so rather than looking like one.
 */
suspend fun saveReceipt(context: Context, receipt: PaymentsApi.Receipt, label: String, forWhat: String): SavedReceipt =
    withContext(Dispatchers.IO) {
        val document = drawReceipt(context, receipt, label, forWhat)
        val name = "Saarthi-receipt-${receipt.reference}.pdf"
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = context.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, PDF)
                    put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Saarthi")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: error("The phone would not make room for the receipt.")
                resolver.openOutputStream(uri)?.use { document.writeTo(it) } ?: error("The receipt could not be written.")
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                SavedReceipt(uri, inDownloads = true)
            } else {
                val folder = File(context.cacheDir, "receipts").apply { mkdirs() }
                val file = File(folder, name)
                file.outputStream().use { stream: OutputStream -> document.writeTo(stream) }
                SavedReceipt(FileProvider.getUriForFile(context, "${context.packageName}.receipts", file), inDownloads = false)
            }
        } finally {
            document.close()
        }
    }

/** The phone's own PDF viewer, or nothing if it has none. */
fun Context.openReceipt(saved: SavedReceipt) {
    runCatching {
        startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(saved.uri, PDF)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

/** The share sheet: WhatsApp, email, print, save elsewhere. */
fun Context.shareReceipt(saved: SavedReceipt) {
    val send = Intent(Intent.ACTION_SEND)
        .setType(PDF)
        .putExtra(Intent.EXTRA_STREAM, saved.uri)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    runCatching { startActivity(Intent.createChooser(send, "Share receipt").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

private const val PDF = "application/pdf"

// A5, in PDF points.
private const val PAGE_W = 420
private const val PAGE_H = 595
private const val MARGIN = 32f

private val Ink = 0xFF111827.toInt()
private val Muted = 0xFF6B7280.toInt()
private val Rule = 0xFFE5E7EB.toInt()
private val Paid = 0xFF15803D.toInt()
private val PaidWash = 0xFFDCFCE7.toInt()

private val Money: NumberFormat = NumberFormat.getCurrencyInstance(Locale.Builder().setLanguage("en").setRegion("IN").build())
private val When: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM yyyy, h:mm a", Locale.ENGLISH)

private fun drawReceipt(context: Context, receipt: PaymentsApi.Receipt, label: String, forWhat: String): PdfDocument {
    val document = PdfDocument()
    val page = document.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, 1).create())
    val canvas = page.canvas
    var y = MARGIN

    // The brand lockup, as the app shows it, on the page's white.
    BitmapFactory.decodeResource(context.resources, R.drawable.brand_lockup)?.let { full ->
        val width = 92f
        val height = width * full.height / full.width
        // Three pixels a point is sharp in print; the full-size art would make a half-megabyte receipt.
        val logo = Bitmap.createScaledBitmap(full, (width * 3).toInt(), (height * 3).toInt(), true)
        if (logo !== full) full.recycleQuietly()
        canvas.drawBitmap(logo, null, RectF(MARGIN, y, MARGIN + width, y + height), Paint(Paint.FILTER_BITMAP_FLAG))
        logo.recycleQuietly()
        y += height + 18f
    }

    y = text(canvas, "Payment receipt", MARGIN, y, size = 20f, bold = true)
    y = text(canvas, label, MARGIN, y + 2f, size = 10.5f, color = Muted)
    y += 16f

    // The amount and its state, the two things a receipt is read for.
    val refunded = receipt.refundedAmount > 0
    val amountText = Money.format(receipt.amount)
    y = text(canvas, amountText, MARGIN, y, size = 26f, bold = true)
    val stateWord = when {
        receipt.status == "REFUNDED" -> "Refunded"
        refunded -> "Paid · ${Money.format(receipt.refundedAmount)} refunded"
        else -> "Paid"
    }
    val pill = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 10f; typeface = Typeface.DEFAULT_BOLD; color = Paid }
    val pillWidth = pill.measureText(stateWord) + 16f
    canvas.drawRoundRect(RectF(MARGIN, y + 4f, MARGIN + pillWidth, y + 22f), 9f, 9f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = PaidWash })
    canvas.drawText(stateWord, MARGIN + 8f, y + 17f, pill)
    y += 40f

    canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, Paint().apply { color = Rule; strokeWidth = 1f })
    y += 14f

    val paidAt = runCatching { Instant.parse(receipt.paidAt).atZone(ZoneId.of("Asia/Kolkata")).format(When) + " IST" }.getOrDefault(receipt.paidAt)
    val rows = listOfNotNull(
        "Receipt no." to receipt.reference,
        "Paid on" to paidAt,
        receipt.payerName?.let { "Paid by" to it },
        receipt.payeeName?.let { "Paid to" to it },
        "For" to listOfNotNull(receipt.forReference, forWhat.ifBlank { null }).joinToString(" · "),
        "Method" to if (receipt.provider == "cashfree") "Online, through Cashfree" else receipt.method.lowercase().replaceFirstChar { it.uppercase() },
        receipt.providerReference?.takeIf { it != receipt.reference }?.let { "Transaction reference" to it },
    )
    rows.forEach { (name, value) ->
        text(canvas, name, MARGIN, y, size = 10f, color = Muted, width = 120)
        y = maxOf(y + 14f, text(canvas, value, MARGIN + 128f, y, size = 10.5f, width = PAGE_W - (MARGIN * 2).toInt() - 128)) + 8f
    }

    val footer = "This receipt confirms a payment made through VorldX Saarthi. It is not a tax invoice.\n" +
        "Generated on ${java.time.ZonedDateTime.now(ZoneId.of("Asia/Kolkata")).format(When)} IST."
    text(canvas, footer, MARGIN, PAGE_H - MARGIN - 30f, size = 8.5f, color = Muted, width = PAGE_W - (MARGIN * 2).toInt())

    document.finishPage(page)
    return document
}

/** Draw wrapped text from (x, y) and return the y just below it. */
private fun text(
    canvas: Canvas,
    value: String,
    x: Float,
    y: Float,
    size: Float,
    bold: Boolean = false,
    color: Int = Ink,
    width: Int = PAGE_W - (MARGIN * 2).toInt(),
): Float {
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = size
        this.color = color
        typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
    }
    val layout = StaticLayout.Builder.obtain(value, 0, value.length, paint, width)
        .setAlignment(Layout.Alignment.ALIGN_NORMAL)
        .build()
    canvas.save()
    canvas.translate(x, y)
    layout.draw(canvas)
    canvas.restore()
    return y + layout.height
}

private fun Bitmap.recycleQuietly() = runCatching { recycle() }
