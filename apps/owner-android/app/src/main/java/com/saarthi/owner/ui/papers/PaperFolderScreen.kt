package com.saarthi.owner.ui.papers

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.prettyDate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.ButtonTone
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
fun PaperFolderScreen(
    app: OwnerApp,
    vehicle: VehiclesApi.Vehicle,
    initial: PapersApi.Wallet,
    folderId: String,
    onChanged: () -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    var wallet by remember { mutableStateOf(initial) }
    val folder = wallet.folders.firstOrNull { it.id == folderId }
    val account = app.session.account.value
    var notice by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }
    var uploading by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<PapersApi.Photo?>(null) }

    /**
     * Read the wallet again after a change, and let the Papers screen behind
     * know. The change is already on the server, so a failed read only leaves
     * this screen a step behind.
     */
    fun refresh() {
        scope.launch {
            runCatching { wallet = app.papers.wallet(vehicle.id) }
            onChanged()
        }
    }

    DetailScreen(eyebrow = formatPlate(vehicle.registrationNumber), title = folder?.label ?: stringResource(R.string.papers_title), spacing = 12.dp) {
        if (folder == null) {
            Hint(stringResource(R.string.papers_folder_gone))
            return@DetailScreen
        }
        folder.folderStatus?.let { StatusTag(it) }
        when (folder.kind) {
            PapersApi.KIND_PHOTOS -> PhotoFolder(
                app,
                vehicle.id,
                wallet.photos,
                photoRights(account),
                notice,
                onNotice = { notice = it },
                onAdded = ::refresh,
                onRemove = { removing = it },
            )
            PapersApi.KIND_QR -> StickerPanel(app, vehicle.id)
            else -> {
                val rc = wallet.rc
                if (folder.id == RC_FOLDER && rc != null) {
                    VirtualRcCard(rc)
                    RcAccessPanel(app, rc, onUnlocked = { wallet = app.papers.wallet(vehicle.id) })
                    if (rc.access == PapersApi.ACCESS_FULL && rc.pdfAvailable) RcCertificate(app, rc)
                } else {
                    if (folder.id == RC_FOLDER) {
                        Hint(stringResource(R.string.papers_folder_no_rc_record))
                    }
                    folder.registerValidUntil?.let { RegisterLine(it) }
                }
                FolderFiles(
                    app,
                    folder,
                    wallet,
                    // Retired types keep their files in Other, but take no new ones — as on the web.
                    canUpload = folder.kind == PapersApi.KIND_PAPER && account?.can(PapersApi.CAN_UPLOAD_PAPERS) == true,
                    notice = notice,
                    onNotice = { notice = it },
                    onUpload = { uploading = true },
                )
            }
        }
    }

    // Beside the page, not in it, so they rise over the whole screen.
    if (folder != null) {
        UploadPaperSheet(
            visible = uploading,
            folderLabel = folder.label,
            documentType = folder.id,
            plate = vehicle.registrationNumber,
            onDismiss = { uploading = false },
        ) { file, number, issued, expires ->
            app.papers.uploadPaper(vehicle.id, folder.id, number, issued, expires, file)
            uploading = false
            notice = Words.get(R.string.papers_folder_uploaded) to NoticeTone.SUCCESS
            refresh()
        }
    }
    RemovePhotoSheet(app, removing, onDismiss = { removing = null }) { removed ->
        removing = null
        wallet = wallet.copy(photos = wallet.photos.filterNot { it.id == removed.id })
        notice = Words.get(R.string.papers_folder_photo_removed) to NoticeTone.SUCCESS
        refresh()
    }
}

/**
 * The files filed in this folder; a tap downloads one and hands it to a viewer.
 * An account that may upload adds a paper here, or a renewed copy of one.
 */
@Composable
private fun FolderFiles(
    app: OwnerApp,
    folder: PapersApi.Folder,
    wallet: PapersApi.Wallet,
    canUpload: Boolean,
    notice: Pair<String, NoticeTone>?,
    onNotice: (Pair<String, NoticeTone>?) -> Unit,
    onUpload: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var opening by remember { mutableStateOf<String?>(null) }

    val files = wallet.filesIn(folder)
    if (files.isEmpty()) {
        Hint(
            when {
                wallet.hasRegisterRecord(folder) -> stringResource(R.string.papers_files_register_only)
                canUpload -> stringResource(R.string.papers_files_empty_can_upload)
                else -> stringResource(R.string.papers_files_empty)
            },
        )
    }
    if (canUpload) {
        val renewing = folder.folderStatus?.needsAttention == true
        SaarthiButton(
            when {
                files.isEmpty() -> stringResource(R.string.papers_files_upload_first)
                renewing -> stringResource(R.string.papers_files_upload_renewed)
                else -> stringResource(R.string.papers_files_upload_new_copy)
            },
            onClick = onUpload,
            tone = if (files.isEmpty() || renewing) ButtonTone.PRIMARY else ButtonTone.SECONDARY,
            leading = Lucide.plus,
        )
    }
    files.forEach { paper ->
        key(paper.id) {
            PaperFileRow(paper, busy = opening == paper.id) {
                if (opening != null) return@PaperFileRow
                opening = paper.id
                onNotice(null)
                scope.launch {
                    onNotice(
                        try {
                            val file = paperFile(context, paper.id, paper.mimeType)
                            app.papers.downloadPaper(paper.id, file)
                            when (openPaper(context, file, paper.mimeType)) {
                                PaperOpening.OPENED -> null
                                PaperOpening.NO_VIEWER -> Words.get(R.string.papers_files_no_viewer) to NoticeTone.WARNING
                            }
                        } catch (failure: Exception) {
                            failure.readable() to NoticeTone.DANGER
                        },
                    )
                    opening = null
                }
            }
        }
    }
    notice?.let { (text, tone) -> NoticeCard(text, tone) }
}

@Composable
internal fun PaperFileRow(paper: PapersApi.Paper, busy: Boolean, onOpen: () -> Unit) {
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
            .pressable(scale = 0.98f, label = stringResource(R.string.papers_file_open_label, title), onClick = onOpen)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconWell(Lucide.fileText, well = well, ink = ink, size = 42.dp, radius = 13.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            listOfNotNull(
                paper.number?.let { if (it.length > 4) "••••" + it.takeLast(4) else it },
                prettyDate(paper.expiryDate)?.let { stringResource(R.string.papers_valid_till, it) },
                if (paper.verificationStatus == "REJECTED") stringResource(R.string.papers_file_rejected) else null,
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
        stringResource(R.string.papers_rc_certificate_open),
        onClick = {
            busy = true
            problem = null
            scope.launch {
                problem = try {
                    val file = paperFile(context, "rc-${rc.lookupId}", "application/pdf")
                    app.papers.downloadRc(rc.lookupId, file)
                    if (openPaper(context, file, "application/pdf") == PaperOpening.NO_VIEWER) {
                        Words.get(R.string.papers_rc_certificate_no_viewer)
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
        busyText = stringResource(R.string.papers_opening),
        leading = Lucide.fileText,
        tone = ButtonTone.SECONDARY,
    )
    problem?.let { NoticeCard(it, NoticeTone.DANGER) }
}

/**
 * A QR code: a vehicle's windscreen sticker (a scan opens the vehicle) or a
 * driver's badge. Issued on first ask, as the web's QR panel does; a plan
 * without QR identity says so in its own words.
 */
@Composable
internal fun StickerPanel(
    app: OwnerApp,
    subjectId: String,
    subjectType: String = "VEHICLE",
    caption: String = stringResource(R.string.papers_sticker_vehicle_caption),
) {
    val c = Saarthi.colors
    val loaded by produceState<Result<Pair<PapersApi.Sticker, Bitmap?>>?>(null, subjectId) {
        value = runCatching {
            val sticker = app.papers.sticker(subjectId, subjectType) ?: error(Words.get(R.string.papers_sticker_not_issued))
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
            (result.exceptionOrNull() as? Exception)?.readable() ?: stringResource(R.string.papers_sticker_load_failed),
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
                        Image(image.asImageBitmap(), contentDescription = stringResource(R.string.papers_sticker_description), modifier = Modifier.fillMaxSize())
                    } else {
                        LineIcon(Lucide.qr, size = 40.dp, color = c.subtle)
                    }
                }
                if (sticker.shortLabel.isNotBlank()) Text(sticker.shortLabel, style = SType.mono(14.sp), color = c.fg)
                Text(caption, style = SType.small, color = c.muted)
            }
        }
    }
}
