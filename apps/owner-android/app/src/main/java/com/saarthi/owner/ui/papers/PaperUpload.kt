package com.saarthi.owner.ui.papers

import android.app.DatePickerDialog
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/*
 * Getting a paper or a photograph off the phone and into its folder: from the
 * camera or from a file, checked here for what the server will refuse anyway
 * (size, type), so the owner hears it before waiting on an upload.
 */

/** The server's `STORAGE_MAX_FILE_SIZE`. */
private const val MAX_FILE_BYTES = 10L * 1024 * 1024

/** A photograph's longest side once it leaves the phone: sharp enough to read, small enough for mobile data. */
private const val MAX_EDGE_PX = 2000

private val DateLabel: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM yyyy")

/** Something the person may pick from: a PDF or a photo for a paper, a photo for the Photos folder. */
internal class Pickers(val takePhoto: () -> Unit, val chooseFile: () -> Unit)

/**
 * The camera and the file picker, each ending in a ready-to-send file or the
 * reason it cannot be sent.
 */
@Composable
internal fun rememberPickers(imagesOnly: Boolean, onPicked: (Result<OwnerApi.Upload>) -> Unit): Pickers {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    // A path, not a File, so it survives the activity being recreated while the camera is open.
    var capturePath by rememberSaveable { mutableStateOf<String?>(null) }

    val document = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch { onPicked(runCatching { readPicked(context, uri) }) }
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { taken ->
        val path = capturePath
        if (taken && path != null) {
            scope.launch {
                onPicked(runCatching { asJpeg(File(path).readBytes(), "photo.jpg") })
                File(path).delete()
            }
        }
    }
    return Pickers(
        takePhoto = {
            val file = File(File(context.cacheDir, "papers").apply { mkdirs() }, "capture-${System.currentTimeMillis()}.jpg")
            capturePath = file.absolutePath
            camera.launch(FileProvider.getUriForFile(context, "${context.packageName}.receipts", file))
        },
        chooseFile = { document.launch(if (imagesOnly) arrayOf("image/*") else arrayOf("application/pdf", "image/*")) },
    )
}

/** A picked file as bytes: a PDF as it is, any image re-drawn as a right-way-up JPEG. */
private suspend fun readPicked(context: Context, uri: Uri): OwnerApi.Upload = withContext(Dispatchers.IO) {
    val resolver = context.contentResolver
    val mime = resolver.getType(uri).orEmpty()
    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
    } ?: "file"
    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: error("That file could not be read.")
    when {
        mime == "application/pdf" -> {
            if (bytes.size > MAX_FILE_BYTES) error("That PDF is larger than 10 MB. Scan it at a lower quality or photograph the paper instead.")
            OwnerApi.Upload(name, mime, bytes)
        }
        mime.startsWith("image/") -> asJpeg(bytes, name)
        else -> error("Choose a PDF or a photo.")
    }
}

/**
 * A photograph as a JPEG no longer than [MAX_EDGE_PX] on its longest side,
 * turned the way the camera was held. Re-drawing also turns HEIC, which some
 * phones save by default, into something every reviewer can open.
 */
private suspend fun asJpeg(bytes: ByteArray, name: String): OwnerApi.Upload = withContext(Dispatchers.Default) {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) error("That photo could not be read.")
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_EDGE_PX) sample *= 2
    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        ?: error("That photo could not be read.")

    val degrees = runCatching {
        when (ExifInterface(bytes.inputStream()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
    }.getOrDefault(0f)
    val scale = minOf(1f, MAX_EDGE_PX.toFloat() / maxOf(decoded.width, decoded.height))
    val matrix = Matrix().apply {
        postScale(scale, scale)
        postRotate(degrees)
    }
    val upright = if (scale < 1f || degrees != 0f) {
        Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    } else {
        decoded
    }
    val out = ByteArrayOutputStream()
    upright.compress(Bitmap.CompressFormat.JPEG, 85, out)
    OwnerApi.Upload(name.substringBeforeLast('.') + ".jpg", "image/jpeg", out.toByteArray())
}

/**
 * Upload a paper into [folderLabel]'s folder: pick it, then the dates the
 * server needs. The expiry is required for every vehicle paper; the number and
 * issue date are kept when given.
 */
@Composable
internal fun UploadPaperSheet(
    visible: Boolean,
    folderLabel: String,
    onDismiss: () -> Unit,
    onUpload: suspend (OwnerApi.Upload, String?, LocalDate?, LocalDate) -> Unit,
) {
    var opening by remember { mutableIntStateOf(0) }
    var wasVisible by remember { mutableStateOf(false) }
    if (visible && !wasVisible) opening++
    wasVisible = visible
    BottomSheet(visible = visible, onDismiss = onDismiss) {
        // A fresh form on every opening.
        key(opening) { UploadForm(folderLabel, onUpload) }
    }
}

@Composable
private fun UploadForm(folderLabel: String, onUpload: suspend (OwnerApi.Upload, String?, LocalDate?, LocalDate) -> Unit) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    var picked by remember { mutableStateOf<OwnerApi.Upload?>(null) }
    var number by remember { mutableStateOf("") }
    var issued by remember { mutableStateOf<LocalDate?>(null) }
    var expires by remember { mutableStateOf<LocalDate?>(null) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val pickers = rememberPickers(imagesOnly = false) { result ->
        result.onSuccess { picked = it; problem = null }.onFailure { problem = it.message ?: "That file could not be used." }
    }

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Upload $folderLabel", style = SType.sheetTitle, color = c.fg)
        val file = picked
        if (file == null) {
            Text("A clear photo of the paper, or a PDF of up to 10 MB.", style = SType.body, color = c.muted)
            SaarthiButton("Take a photo", onClick = pickers.takePhoto, leading = Lucide.camera)
            SaarthiButton("Choose a file", onClick = pickers.chooseFile, tone = ButtonTone.SECONDARY, leading = Lucide.folder)
        } else {
            Row(
                Modifier
                    .fillMaxWidth()
                    .card(radius = 16.dp, elevated = false)
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                IconWell(if (file.mimeType == "application/pdf") Lucide.fileText else Lucide.image, well = c.primarySoft, ink = c.primary, size = 40.dp, radius = 12.dp)
                Column(Modifier.weight(1f)) {
                    Text(file.fileName, style = SType.smallStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("%.1f MB".format(file.bytes.size / 1_048_576.0), style = SType.caption, color = c.muted)
                }
                LinkButton("Change", onClick = { picked = null })
            }
            CompactField(number, { number = it.take(80) }, "Number on the paper (optional)")
            DateRow("Valid till", expires, required = true, future = true) { expires = it }
            DateRow("Issued on (optional)", issued, required = false, future = false) { issued = it }
            SaarthiButton(
                "Upload",
                onClick = {
                    val until = expires ?: return@SaarthiButton
                    busy = true
                    problem = null
                    scope.launch {
                        try {
                            onUpload(file, number, issued, until)
                        } catch (failure: Exception) {
                            problem = failure.readable()
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = expires != null && !busy,
                busy = busy,
                busyText = "Uploading…",
            )
            if (expires == null) Text("Add the date it is valid till to upload.", style = SType.caption, color = c.subtle)
        }
        problem?.let { NoticeCard(it, NoticeTone.DANGER) }
    }
}

/** A date chosen from the phone's own calendar; [future] limits it to today onwards, otherwise up to today. */
@Composable
private fun DateRow(label: String, date: LocalDate?, required: Boolean, future: Boolean, onPick: (LocalDate) -> Unit) {
    val c = Saarthi.colors
    val context = LocalContext.current
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 14.dp, color = c.elevated, ring = if (required && date == null) c.primaryRing else c.input, elevated = false)
            .pressable(scale = 0.99f, label = label) {
                val shown = date ?: LocalDate.now()
                DatePickerDialog(
                    context,
                    { _, year, month, day -> onPick(LocalDate.of(year, month + 1, day)) },
                    shown.year,
                    shown.monthValue - 1,
                    shown.dayOfMonth,
                ).apply {
                    val today = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
                    if (future) datePicker.minDate = today else datePicker.maxDate = today + 86_399_000
                }.show()
            }
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        LineIcon(Lucide.calendar, size = 18.dp, color = c.primary)
        Text(label, style = SType.small, color = c.muted, modifier = Modifier.weight(1f))
        Text(date?.let { DateLabel.format(it) } ?: "Choose", style = SType.smallStrong, color = if (date == null) c.subtle else c.fg)
    }
}
