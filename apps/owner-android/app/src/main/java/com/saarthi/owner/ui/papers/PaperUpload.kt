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
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.saarthi.owner.R
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.InlineSpinner
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
import kotlinx.coroutines.CancellationException
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

// Made on each use, so the month and day names follow the app\'s language when it changes.
private val DateLabel: DateTimeFormatter get() = DateTimeFormatter.ofPattern("d MMM yyyy")

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
    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: error(Words.get(R.string.papers_upload_file_unreadable))
    when {
        mime == "application/pdf" -> {
            if (bytes.size > MAX_FILE_BYTES) error(Words.get(R.string.papers_upload_pdf_too_large))
            OwnerApi.Upload(name, mime, bytes)
        }
        mime.startsWith("image/") -> asJpeg(bytes, name)
        else -> error(Words.get(R.string.papers_upload_wrong_type))
    }
}

/**
 * A photograph as a JPEG no longer than [MAX_EDGE_PX] on its longest side,
 * turned the way the camera was held. Re-drawing also turns HEIC, which some
 * phones save by default, into something every reviewer can open.
 */
private suspend fun asJpeg(bytes: ByteArray, name: String): OwnerApi.Upload = withContext(Dispatchers.Default) {
    OwnerApi.Upload(name.substringBeforeLast('.') + ".jpg", "image/jpeg", decodeUpright(bytes, MAX_EDGE_PX).toJpeg(85))
}

/** A photo decoded no larger than [maxEdge] on its longest side, the right way up. */
internal fun decodeUpright(bytes: ByteArray, maxEdge: Int): Bitmap {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) error(Words.get(R.string.papers_upload_photo_unreadable))
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxEdge) sample *= 2
    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        ?: error(Words.get(R.string.papers_upload_photo_unreadable))

    val degrees = runCatching {
        when (ExifInterface(bytes.inputStream()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
    }.getOrDefault(0f)
    return decoded.scaledTo(maxEdge, degrees)
}

/** This bitmap no longer than [maxEdge] on its longest side, turned by [degrees]. */
internal fun Bitmap.scaledTo(maxEdge: Int, degrees: Float = 0f): Bitmap {
    val scale = minOf(1f, maxEdge.toFloat() / maxOf(width, height))
    if (scale >= 1f && degrees == 0f) return this
    val matrix = Matrix().apply {
        postScale(scale, scale)
        postRotate(degrees)
    }
    return Bitmap.createBitmap(this, 0, 0, width, height, matrix, true)
}

internal fun Bitmap.toJpeg(quality: Int): ByteArray =
    ByteArrayOutputStream().also { compress(Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()

/**
 * Upload a paper into [folderLabel]'s folder: pick it, and its number and
 * dates are read off it on the phone and filled in, left open to correct. The
 * expiry is required for every vehicle paper, so a paper it cannot be read
 * from asks for that one date; the number and issue date are kept when found.
 */
@Composable
internal fun UploadPaperSheet(
    visible: Boolean,
    folderLabel: String,
    documentType: String,
    plate: String?,
    onDismiss: () -> Unit,
    expiryRequired: Boolean = true,
    onUpload: suspend (OwnerApi.Upload, String?, LocalDate?, LocalDate?) -> Unit,
) {
    var opening by remember { mutableIntStateOf(0) }
    var wasVisible by remember { mutableStateOf(false) }
    if (visible && !wasVisible) opening++
    wasVisible = visible
    BottomSheet(visible = visible, onDismiss = onDismiss) {
        // A fresh form on every opening.
        key(opening) { UploadForm(folderLabel, documentType, plate, expiryRequired, onUpload) }
    }
}

@Composable
private fun UploadForm(
    folderLabel: String,
    documentType: String,
    plate: String?,
    expiryRequired: Boolean,
    onUpload: suspend (OwnerApi.Upload, String?, LocalDate?, LocalDate?) -> Unit,
) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var picked by remember { mutableStateOf<OwnerApi.Upload?>(null) }
    var number by remember { mutableStateOf("") }
    var issued by remember { mutableStateOf<LocalDate?>(null) }
    var expires by remember { mutableStateOf<LocalDate?>(null) }
    var reading by remember { mutableStateOf(false) }
    var read by remember { mutableStateOf<ReadPaper?>(null) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val pickers = rememberPickers(imagesOnly = false) { result ->
        result.onSuccess { picked = it; problem = null }.onFailure { problem = it.message ?: Words.get(R.string.papers_upload_file_unusable) }
    }

    // Read the paper the moment it is picked, and fill in what it says.
    LaunchedEffect(picked) {
        val file = picked ?: return@LaunchedEffect
        reading = true
        val found = try {
            PaperScanner.text(context, file)?.let { PaperText.read(it, documentType, plate) } ?: ReadPaper()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            // The reader failing only means the details are chosen by hand.
            ReadPaper()
        }
        number = found.number.orEmpty()
        issued = found.issuedOn
        expires = found.expiresOn
        read = found
        reading = false
    }

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(stringResource(R.string.papers_upload_title, folderLabel), style = SType.sheetTitle, color = c.fg)
        val file = picked
        if (file == null) {
            Text(stringResource(R.string.papers_upload_intro), style = SType.body, color = c.muted)
            SaarthiButton(stringResource(R.string.papers_take_photo), onClick = pickers.takePhoto, leading = Lucide.camera)
            SaarthiButton(stringResource(R.string.papers_upload_choose_file), onClick = pickers.chooseFile, tone = ButtonTone.SECONDARY, leading = Lucide.folder)
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
                    Text(sizeLabel(file.bytes.size), style = SType.caption, color = c.muted)
                }
                LinkButton(stringResource(R.string.papers_upload_change), onClick = { picked = null; read = null }, enabled = !reading && !busy)
            }
            if (reading) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    InlineSpinner(c.primary)
                    Text(stringResource(R.string.papers_upload_reading), style = SType.small, color = c.muted)
                }
            } else {
                read?.let { found -> ReadOutcome(found, expires, expiryRequired) }
                CompactField(number, { number = it.take(80) }, stringResource(R.string.papers_upload_number))
                DateRow(if (expiryRequired) stringResource(R.string.papers_upload_valid_till) else stringResource(R.string.papers_upload_valid_till_optional), expires, required = expiryRequired, future = true) { expires = it }
                DateRow(stringResource(R.string.papers_upload_issued_optional), issued, required = false, future = false) { issued = it }
            }
            SaarthiButton(
                stringResource(R.string.papers_upload_button),
                onClick = {
                    val until = expires
                    if (expiryRequired && until == null) return@SaarthiButton
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
                enabled = (expires != null || !expiryRequired) && !busy && !reading,
                busy = busy,
                busyText = stringResource(R.string.papers_uploading),
            )
        }
        problem?.let { NoticeCard(it, NoticeTone.DANGER) }
    }
}

/**
 * What reading the paper found, in a line: filled in and ready, or which date
 * is still needed — and a warning when it names another vehicle, or has run out.
 */
@Composable
private fun ReadOutcome(found: ReadPaper, expires: LocalDate?, expiryRequired: Boolean) {
    val c = Saarthi.colors
    found.otherPlate?.let { other ->
        NoticeCard(stringResource(R.string.papers_upload_other_plate, formatPlate(other)), NoticeTone.WARNING)
    }
    when {
        expires != null && expires.isBefore(LocalDate.now()) ->
            NoticeCard(stringResource(R.string.papers_upload_ran_out, DateLabel.format(expires)), NoticeTone.WARNING)
        found.foundAnything && (expires != null || !expiryRequired) ->
            Text(stringResource(R.string.papers_upload_filled), style = SType.small, color = c.success)
        found.foundAnything ->
            Text(stringResource(R.string.papers_upload_filled_need_expiry), style = SType.small, color = c.warning)
        !expiryRequired ->
            Text(stringResource(R.string.papers_upload_nothing_read_optional), style = SType.small, color = c.muted)
        else ->
            Text(stringResource(R.string.papers_upload_nothing_read), style = SType.small, color = c.warning)
    }
}

private fun sizeLabel(bytes: Int): String =
    if (bytes < 1_048_576) Words.get(R.string.papers_size_kb, (bytes + 1023) / 1024) else Words.get(R.string.papers_size_mb, "%.1f".format(bytes / 1_048_576.0))

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
        Text(date?.let { DateLabel.format(it) } ?: stringResource(R.string.papers_upload_choose_date), style = SType.smallStrong, color = if (date == null) c.subtle else c.fg)
    }
}
