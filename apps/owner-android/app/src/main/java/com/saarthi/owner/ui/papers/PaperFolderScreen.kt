package com.saarthi.owner.ui.papers

import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.prettyDate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.InlineSpinner
import com.saarthi.owner.ui.design.LineIcon
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

/**
 * One folder, opened: what the register says about the paper, the files
 * uploaded into it, or — for the photographs and the sticker — those.
 *
 * Starts from the wallet the Papers screen already holds, and reads it again
 * only after the Secure PIN, when the RC comes back whole.
 */
@Composable
fun PaperFolderScreen(app: OwnerApp, vehicle: VehiclesApi.Vehicle, initial: PapersApi.Wallet, folderId: String) {
    var wallet by remember { mutableStateOf(initial) }
    val folder = wallet.folders.firstOrNull { it.id == folderId }

    DetailScreen(eyebrow = formatPlate(vehicle.registrationNumber), title = folder?.label ?: "Papers", spacing = 12.dp) {
        if (folder == null) {
            Hint("This folder is no longer on file.")
            return@DetailScreen
        }
        folder.folderStatus?.let { StatusTag(it) }
        when (folder.kind) {
            PapersApi.KIND_PHOTOS -> PhotoGrid(app, wallet.photos)
            PapersApi.KIND_QR -> StickerPanel(app, vehicle.id)
            else -> {
                val rc = wallet.rc
                if (folder.id == RC_FOLDER && rc != null) {
                    VirtualRcCard(rc)
                    RcAccessPanel(app, rc, onUnlocked = { wallet = app.papers.wallet(vehicle.id) })
                    if (rc.access == PapersApi.ACCESS_FULL && rc.pdfAvailable) RcCertificate(app, rc)
                } else {
                    if (folder.id == RC_FOLDER) {
                        Hint("No RTO record has been fetched for this vehicle yet. Fetch it from the vehicle's Registration tab on the Saarthi website and the virtual RC appears here.")
                    }
                    folder.registerValidUntil?.let { RegisterLine(it) }
                }
                FolderFiles(app, folder, wallet)
            }
        }
    }
}

/** The files filed in this folder; a tap downloads one and hands it to a viewer. */
@Composable
private fun FolderFiles(app: OwnerApp, folder: PapersApi.Folder, wallet: PapersApi.Wallet) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var opening by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }

    val files = wallet.filesIn(folder)
    if (files.isEmpty()) {
        Hint(
            if (wallet.hasRegisterRecord(folder)) {
                "No scan uploaded. The dates above come from the RTO register."
            } else {
                "Nothing filed here yet. Upload it from Saarthi on the web."
            },
        )
        return
    }
    files.forEach { paper ->
        key(paper.id) {
            PaperFileRow(paper, busy = opening == paper.id) {
                if (opening != null) return@PaperFileRow
                opening = paper.id
                notice = null
                scope.launch {
                    notice = try {
                        val file = paperFile(context, paper.id, paper.mimeType)
                        app.papers.downloadPaper(paper.id, file)
                        when (openPaper(context, file, paper.mimeType)) {
                            PaperOpening.OPENED -> null
                            PaperOpening.NO_VIEWER -> "No app on this phone can open this file." to NoticeTone.WARNING
                        }
                    } catch (failure: Exception) {
                        failure.readable() to NoticeTone.DANGER
                    } finally {
                        opening = null
                    }
                }
            }
        }
    }
    notice?.let { (text, tone) -> NoticeCard(text, tone) }
}

@Composable
private fun PaperFileRow(paper: PapersApi.Paper, busy: Boolean, onOpen: () -> Unit) {
    val c = Saarthi.colors
    val expiry = validityOf(paper.expiryDate)
    val (well, ink) = when {
        paper.verificationStatus == "REJECTED" -> c.dangerSoft to c.danger
        expiry == FolderStatus.EXPIRED -> c.dangerSoft to c.danger
        expiry == FolderStatus.EXPIRING_SOON -> c.warningSoft to c.warning
        else -> c.primarySoft to c.primary
    }
    val title = paper.title?.takeIf { it.isNotBlank() } ?: paper.documentType.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 20.dp)
            .pressable(scale = 0.98f, label = "Open $title", onClick = onOpen)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconWell(Lucide.fileText, well = well, ink = ink, size = 42.dp, radius = 13.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            listOfNotNull(
                paper.number?.let { if (it.length > 4) "••••" + it.takeLast(4) else it },
                prettyDate(paper.expiryDate)?.let { "Valid till $it" },
                if (paper.verificationStatus == "REJECTED") "Rejected, upload again" else null,
            ).joinToString(" · ").takeIf { it.isNotBlank() }?.let {
                Text(it, style = SType.caption, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (busy) InlineSpinner(c.primary) else LineIcon(Lucide.download, size = 18.dp, color = c.subtle)
    }
}

/** The stored RC certificate, once the RC is shown in full. */
@Composable
private fun RcCertificate(app: OwnerApp, rc: PapersApi.VirtualRc) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    SaarthiButton(
        "Open RC certificate",
        onClick = {
            busy = true
            problem = null
            scope.launch {
                problem = try {
                    val file = paperFile(context, "rc-${rc.lookupId}", "application/pdf")
                    app.papers.downloadRc(rc.lookupId, file)
                    if (openPaper(context, file, "application/pdf") == PaperOpening.NO_VIEWER) {
                        "No app on this phone can open a PDF."
                    } else {
                        null
                    }
                } catch (failure: Exception) {
                    failure.readable()
                } finally {
                    busy = false
                }
            }
        },
        busy = busy,
        busyText = "Opening…",
        leading = Lucide.fileText,
        tone = ButtonTone.SECONDARY,
    )
    problem?.let { NoticeCard(it, NoticeTone.DANGER) }
}

/** The vehicle's photographs, two to a row; a tap shows one full size. */
@Composable
private fun PhotoGrid(app: OwnerApp, photos: List<PapersApi.Photo>) {
    var shown by remember { mutableStateOf<PapersApi.Photo?>(null) }
    if (photos.isEmpty()) {
        Hint("No photographs of this vehicle yet. Add them from Saarthi on the web.")
        return
    }
    shown?.let { photo ->
        FullPhoto(app, photo, onClose = { shown = null })
        return
    }
    photos.chunked(2).forEach { pair ->
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            pair.forEach { photo ->
                Thumbnail(app, photo, onOpen = { shown = photo }, Modifier.weight(1f))
            }
            if (pair.size == 1) Spacer(Modifier.weight(1f))
        }
    }
}

/** Bytes from the API, decoded off the main thread; null while loading or when unreadable. */
@Composable
private fun rememberRemoteBitmap(key: Any, load: suspend () -> ByteArray?): Bitmap? {
    val bitmap by produceState<Bitmap?>(null, key) {
        value = withContext(Dispatchers.IO) {
            runCatching { load()?.let { BitmapFactory.decodeByteArray(it, 0, it.size) } }.getOrNull()
        }
    }
    return bitmap
}

@Composable
private fun Thumbnail(app: OwnerApp, photo: PapersApi.Photo, onOpen: () -> Unit, modifier: Modifier) {
    val bitmap = rememberRemoteBitmap(photo.id to true) { app.papers.photo(photo.id, thumbnail = photo.hasThumbnail) }
    val label = photo.caption ?: "Vehicle photograph"
    Box(
        modifier
            .aspectRatio(4f / 3f)
            .clip(RoundedCornerShape(16.dp))
            .background(Saarthi.colors.sunken)
            .pressable(scale = 0.97f, label = label, onClick = onOpen),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) {
            Image(bitmap.asImageBitmap(), contentDescription = label, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            LineIcon(Lucide.image, size = 24.dp, color = Saarthi.colors.subtle)
        }
    }
}

@Composable
private fun FullPhoto(app: OwnerApp, photo: PapersApi.Photo, onClose: () -> Unit) {
    val bitmap = rememberRemoteBitmap(photo.id to false) { app.papers.photo(photo.id, thumbnail = false) }
    val label = photo.caption ?: "Vehicle photograph"
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = SType.bodyStrong, color = Saarthi.colors.fg, modifier = Modifier.weight(1f))
        CircleButton(Lucide.close, "Close photograph", onClose, size = 40.dp, elevated = false)
    }
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) {
            Image(
                bitmap.asImageBitmap(),
                contentDescription = label,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(bitmap.width.toFloat() / bitmap.height.coerceAtLeast(1)),
            )
        } else {
            Box(Modifier.fillMaxWidth().aspectRatio(4f / 3f), contentAlignment = Alignment.Center) {
                LineIcon(Lucide.image, size = 28.dp, color = Color.White.copy(alpha = 0.6f))
            }
        }
    }
}

/**
 * The windscreen sticker: a scan opens this vehicle. Issued on first ask, as
 * the web's QR panel does; a plan without QR identity says so in its own words.
 */
@Composable
private fun StickerPanel(app: OwnerApp, vehicleId: String) {
    val c = Saarthi.colors
    val loaded by produceState<Result<Pair<PapersApi.Sticker, Bitmap?>>?>(null, vehicleId) {
        value = runCatching {
            val sticker = app.papers.sticker(vehicleId) ?: error("This vehicle has no QR sticker yet.")
            val image = withContext(Dispatchers.IO) {
                app.papers.stickerImage(sticker)?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
            }
            sticker to image
        }
    }
    val result = loaded
    when {
        result == null -> InlineSpinner(c.primary)
        result.isFailure -> NoticeCard(
            (result.exceptionOrNull() as? Exception)?.readable() ?: "The QR sticker could not be loaded.",
            NoticeTone.WARNING,
        )
        else -> {
            val (sticker, image) = result.getOrThrow()
            Column(
                Modifier
                    .fillMaxWidth()
                    .card(radius = 24.dp)
                    .padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(
                    Modifier
                        .size(220.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color.White)
                        .padding(12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    if (image != null) {
                        Image(image.asImageBitmap(), contentDescription = "QR sticker", modifier = Modifier.fillMaxSize())
                    } else {
                        LineIcon(Lucide.qr, size = 40.dp, color = c.subtle)
                    }
                }
                if (sticker.shortLabel.isNotBlank()) Text(sticker.shortLabel, style = SType.mono(14.sp), color = c.fg)
                Text(
                    "A scan of this sticker opens this vehicle in Saarthi. Print it from Saarthi on the web.",
                    style = SType.small,
                    color = c.muted,
                )
            }
        }
    }
}
