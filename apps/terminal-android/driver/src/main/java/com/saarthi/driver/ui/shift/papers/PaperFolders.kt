package com.saarthi.driver.ui.shift.papers

import androidx.annotation.StringRes
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
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
import com.saarthi.core.network.PaperFolderDto
import com.saarthi.core.network.PapersWalletDto
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.StatusPill
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.pressable
import java.time.LocalDate

/**
 * The wallet's folders, as the fleet's web Documents tab files them: one per
 * paper, then the photographs and the QR sticker, then anything of a type no
 * longer offered.
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

    /** Lapsed or about to, or refused — the ones a driver must tell the office about. */
    val needsAttention: Boolean get() = this == EXPIRED || this == EXPIRING_SOON || this == REJECTED
}

internal val PaperFolderDto.folderStatus: FolderStatus?
    get() = status?.let { value -> FolderStatus.entries.firstOrNull { it.name == value } }

internal val PaperFolderDto.isVehicle: Boolean get() = ownerType == OWNER_VEHICLE

/** The folder the virtual RC belongs in, and the one the licence does. */
internal const val RC_FOLDER = "REGISTRATION_CERTIFICATE"
internal const val LICENCE_FOLDER = "DRIVING_LICENCE"

/**
 * The vehicle's papers in one line, for Home: the worst news first, otherwise
 * the paper whose register date comes round soonest.
 *
 * [status] is null when nothing is filed for the vehicle at all; [folders] are
 * the ones standing at [status].
 */
internal data class PapersStanding(
    val status: FolderStatus?,
    val folders: List<PaperFolderDto>,
    val nextDue: PaperFolderDto?,
    val onFile: Int,
)

internal fun PapersWalletDto.vehicleStanding(): PapersStanding {
    val papers = folders.filter { it.isVehicle && it.kind == KIND_PAPER }
    val worst = WORST_FIRST.firstOrNull { status -> papers.any { it.folderStatus == status } }
    val today = LocalDate.now()
    val nextDue = papers
        .mapNotNull { folder -> parseDate(folder.registerValidUntil)?.let { folder to it } }
        .filter { (_, date) -> !date.isBefore(today) }
        .minByOrNull { (_, date) -> date }
        ?.first
    return PapersStanding(
        status = worst,
        folders = papers.filter { it.folderStatus == worst },
        nextDue = nextDue,
        onFile = papers.count { it.folderStatus == FolderStatus.VALID || it.folderStatus == FolderStatus.ON_FILE },
    )
}

/** Lapsed before refused before lapsing before absent; good news only when there is no other. */
private val WORST_FIRST = listOf(
    FolderStatus.EXPIRED,
    FolderStatus.REJECTED,
    FolderStatus.EXPIRING_SOON,
    FolderStatus.MISSING,
    FolderStatus.VALID,
    FolderStatus.ON_FILE,
)

/** The RTO register says something about this paper, whether or not a scan was uploaded. */
internal fun PapersWalletDto.hasRegisterRecord(folder: PaperFolderDto): Boolean =
    folder.registerValidUntil != null ||
        (folder.id == RC_FOLDER && rc != null) ||
        (folder.id == LICENCE_FOLDER && licence != null)

/** The folder's name in the driver's language; the server's English for a type this build has not met. */
@Composable
internal fun PaperFolderDto.displayName(): String =
    folderNames[id]?.let { stringResource(it) } ?: label

private val folderNames: Map<String, Int> = mapOf(
    "REGISTRATION_CERTIFICATE" to R.string.papers_folder_rc,
    "INSURANCE" to R.string.papers_folder_insurance,
    "FITNESS_CERTIFICATE" to R.string.papers_folder_fitness,
    "PERMIT" to R.string.papers_folder_permit,
    "POLLUTION_CERTIFICATE" to R.string.papers_folder_puc,
    "ROAD_TAX" to R.string.papers_folder_road_tax,
    "PHOTOS" to R.string.papers_folder_photos,
    "QR" to R.string.papers_folder_qr,
    "OTHER" to R.string.papers_folder_other,
    "DRIVING_LICENCE" to R.string.papers_folder_licence,
    "DRIVER_IDENTITY_PROOF" to R.string.papers_folder_identity,
    "DRIVER_ADDRESS_PROOF" to R.string.papers_folder_address,
    "DRIVER_AADHAAR" to R.string.papers_folder_aadhaar,
    "DRIVER_PAN" to R.string.papers_folder_pan,
    "DRIVER_VOTER_ID" to R.string.papers_folder_voter,
    "DRIVER_PHOTO" to R.string.papers_folder_photo,
    "DRIVER_MEDICAL_CERTIFICATE" to R.string.papers_folder_medical,
    "DRIVER_POLICE_VERIFICATION" to R.string.papers_folder_police,
)

/** Folders two to a row, in the order the server filed them. */
@Composable
internal fun FolderGrid(
    folders: List<PaperFolderDto>,
    hasRegisterRecord: (PaperFolderDto) -> Boolean,
    onOpen: (PaperFolderDto) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        folders.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                pair.forEach { folder ->
                    FolderTile(folder, hasRegisterRecord(folder), onOpen = { onOpen(folder) }, Modifier.weight(1f))
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun FolderTile(folder: PaperFolderDto, fromRegister: Boolean, onOpen: () -> Unit, modifier: Modifier) {
    val c = Saarthi.colors
    val name = folder.displayName()
    val status = folder.folderStatus
    val meta = when {
        folder.kind == KIND_PHOTOS -> pluralStringResource(R.plurals.papers_photos, folder.count, folder.count)
        folder.kind == KIND_QR -> stringResource(R.string.papers_qr_meta)
        folder.count == 0 && fromRegister -> stringResource(R.string.papers_from_rto)
        else -> pluralStringResource(R.plurals.papers_files, folder.count, folder.count)
    }
    Column(
        modifier
            .heightIn(min = 132.dp)
            .card(radius = 20.dp)
            .pressable(scale = 0.97f, label = "$name, $meta", onClick = onOpen)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FolderArt(folderColour(folder.kind))
        Text(name, style = SType.bodyStrong, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(meta, style = SType.caption, color = c.muted, maxLines = 1)
        status?.let { StatusTag(it) }
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

/** The web's folder colours: indigo for papers, teal for photos, slate for the sticker and the rest. */
@Composable
private fun folderColour(kind: String): Color = when (kind) {
    KIND_PHOTOS -> Color(0xFF1F9D8B)
    KIND_QR -> Color(0xFF5B6170)
    KIND_OTHER -> Color(0xFF8A8F9C)
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

internal const val KIND_PAPER = "PAPER"
internal const val KIND_PHOTOS = "PHOTOS"
internal const val KIND_QR = "QR"
internal const val KIND_OTHER = "OTHER"
