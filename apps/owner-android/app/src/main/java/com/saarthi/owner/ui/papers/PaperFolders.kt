package com.saarthi.owner.ui.papers

import androidx.annotation.StringRes
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.ui.common.parseDate
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/*
 * A vehicle's folders, filed as the web's Documents tab and the driver's app
 * file them: one per paper, then the photographs and the QR sticker, then any
 * files of a type no longer offered. The server decides each folder's standing;
 * this only draws it.
 */

/** How a folder stands, in the same words the web's folder tags use. */
internal enum class FolderStatus(@StringRes val word: Int) {
    VALID(R.string.papers_status_valid),
    EXPIRING_SOON(R.string.papers_status_expiring),
    EXPIRED(R.string.papers_status_expired),
    REJECTED(R.string.papers_status_rejected),
    MISSING(R.string.papers_status_missing),
    OPTIONAL(R.string.papers_status_optional),
    ON_FILE(R.string.papers_status_on_file),
    ;

    /** Lapsed, about to, or refused: the ones an owner has to act on. */
    val needsAttention: Boolean get() = this == EXPIRED || this == EXPIRING_SOON || this == REJECTED

    /** Something is held for this paper, uploaded or from the register. */
    val onFile: Boolean get() = this != MISSING && this != OPTIONAL
}

internal val PapersApi.Folder.folderStatus: FolderStatus?
    get() = status?.let { value -> FolderStatus.entries.firstOrNull { it.name == value } }

/** The folder the virtual RC belongs in. */
internal const val RC_FOLDER = "REGISTRATION_CERTIFICATE"
internal const val INSURANCE_FOLDER = "INSURANCE"

/** The RTO register says something about this paper, whether or not a scan was uploaded. */
internal fun PapersApi.Wallet.hasRegisterRecord(folder: PapersApi.Folder): Boolean =
    folder.registerValidUntil != null || (folder.id == RC_FOLDER && rc != null)

/** The uploaded files filed in [folder], in the server's order: the latest expiry last. */
internal fun PapersApi.Wallet.filesIn(folder: PapersApi.Folder): List<PapersApi.Paper> =
    folder.documentIds.mapNotNull { id -> documents.firstOrNull { it.id == id } }

/**
 * Days until this paper runs out: the latest upload's own date, otherwise the
 * register's. Null when neither gives one.
 */
internal fun PapersApi.Wallet.daysLeft(folder: PapersApi.Folder): Int? =
    filesIn(folder).lastOrNull()?.daysToExpiry
        ?: parseDate(folder.registerValidUntil)?.let { ChronoUnit.DAYS.between(LocalDate.now(), it).toInt() }

/** The vehicle's papers in a few numbers, for Home and the vehicle's Papers card. */
internal data class PapersStanding(
    /** Expired, expiring or refused. */
    val attention: Int,
    val expired: Int,
    /** Papers with something on file, uploaded or from the register. */
    val onFile: Int,
)

internal fun PapersApi.Wallet.standing(): PapersStanding {
    val papers = folders.filter { it.kind == PapersApi.KIND_PAPER }.mapNotNull { it.folderStatus }
    return PapersStanding(
        attention = papers.count { it.needsAttention },
        expired = papers.count { it == FolderStatus.EXPIRED || it == FolderStatus.REJECTED },
        onFile = papers.count { it.onFile },
    )
}

/** Folders two to a row, in the order the server filed them. */
@Composable
internal fun FolderGrid(
    wallet: PapersApi.Wallet,
    onOpen: (PapersApi.Folder) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        wallet.folders.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                pair.forEach { folder ->
                    FolderTile(folder, wallet.hasRegisterRecord(folder), onOpen = { onOpen(folder) }, Modifier.weight(1f))
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun FolderTile(folder: PapersApi.Folder, fromRegister: Boolean, onOpen: () -> Unit, modifier: Modifier) {
    val c = Saarthi.colors
    val meta = when {
        folder.kind == PapersApi.KIND_PHOTOS -> pluralStringResource(R.plurals.papers_folder_photos, folder.count, folder.count)
        folder.kind == PapersApi.KIND_QR -> stringResource(R.string.papers_folder_qr_meta)
        folder.count == 0 && fromRegister -> stringResource(R.string.papers_folder_from_register)
        else -> pluralStringResource(R.plurals.papers_folder_files, folder.count, folder.count)
    }
    Column(
        modifier
            .heightIn(min = 132.dp)
            .card(radius = 20.dp)
            .pressable(scale = 0.97f, label = stringResource(R.string.papers_folder_tile_label, folder.label, meta), onClick = onOpen)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FolderArt(folderColour(folder.kind))
        Text(folder.label, style = SType.bodyStrong, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(meta, style = SType.caption, color = c.muted, maxLines = 1)
        folder.folderStatus?.let { StatusTag(it) }
    }
}

/** A coloured tag, toned the way the web's folder tags are. */
@Composable
internal fun StatusTag(status: FolderStatus, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val (ground, ink) = when (status) {
        FolderStatus.VALID -> c.successBg to c.success
        FolderStatus.EXPIRING_SOON, FolderStatus.MISSING -> c.warningBg to c.warning
        FolderStatus.EXPIRED, FolderStatus.REJECTED -> c.dangerBg to c.danger
        FolderStatus.OPTIONAL -> c.sunken to c.muted
        FolderStatus.ON_FILE -> c.infoSoft to c.info
    }
    StatusPill(stringResource(status.word), background = ground, ink = ink, modifier = modifier, dot = false)
}

/** The web's folder colours: the brand for papers, teal for photos, slate for the sticker and the rest. */
@Composable
private fun folderColour(kind: String): Color = when (kind) {
    PapersApi.KIND_PHOTOS -> Color(0xFF1F9D8B)
    PapersApi.KIND_QR -> Color(0xFF5B6170)
    PapersApi.KIND_OTHER -> Color(0xFF8A8F9C)
    else -> Saarthi.colors.primary
}

/** A folder with a sheet of paper in it, drawn rather than stamped, so it takes the folder's colour. */
@Composable
private fun FolderArt(colour: Color) {
    val paper = Saarthi.colors.card
    Canvas(Modifier.size(width = 46.dp, height = 36.dp)) {
        val w = size.width
        val h = size.height
        val radius = CornerRadius(5.dp.toPx())
        // The back, with its tab.
        val back = Path().apply {
            moveTo(0f, h * 0.16f)
            lineTo(w * 0.36f, h * 0.16f)
            lineTo(w * 0.44f, 0f)
            lineTo(w, 0f)
            lineTo(w, h)
            lineTo(0f, h)
            close()
        }
        drawPath(back, colour.copy(alpha = 0.55f))
        drawRoundRect(paper, topLeft = Offset(w * 0.12f, h * 0.12f), size = Size(w * 0.76f, h * 0.6f), cornerRadius = radius)
        drawRoundRect(colour, topLeft = Offset(0f, h * 0.34f), size = Size(w, h * 0.66f), cornerRadius = radius)
    }
}
