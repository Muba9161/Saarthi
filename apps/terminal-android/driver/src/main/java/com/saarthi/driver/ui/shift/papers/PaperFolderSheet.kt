package com.saarthi.driver.ui.shift.papers

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.core.network.DriverPaperDto
import com.saarthi.core.network.PaperFolderDto
import com.saarthi.core.network.PapersWalletDto
import com.saarthi.core.network.VehiclePhotoDto
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.SaarthiDriverApp
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.Hint
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.shift.flow.FlowPanel
import com.saarthi.driver.ui.shift.flow.FlowTopBar

/**
 * One folder, opened: what the register says about the paper, the files the
 * fleet uploaded into it, or — for the photographs and the sticker — those.
 */
@Composable
internal fun PaperFolderSheet(
    folder: PaperFolderDto?,
    wallet: PapersWalletDto?,
    cockpit: TerminalViewModel,
    papers: PapersViewModel,
    onClose: () -> Unit,
) {
    FlowPanel(visible = folder != null, onBack = onClose) {
        if (folder != null && wallet != null) FolderContent(folder, wallet, cockpit, papers, onClose)
    }
}

@Composable
private fun ColumnScope.FolderContent(
    folder: PaperFolderDto,
    wallet: PapersWalletDto,
    cockpit: TerminalViewModel,
    papers: PapersViewModel,
    onClose: () -> Unit,
) {
    val state by cockpit.uiState.collectAsState()
    Column(
        Modifier
            .weight(1f)
            .padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        FlowTopBar(title = folder.displayName(), plate = state.registration, onBack = onClose)
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            folder.folderStatus?.let { StatusTag(it) }
            when (folder.kind) {
                KIND_PHOTOS -> PhotoGrid(wallet.photos, papers)
                KIND_QR -> QrSticker(state.server?.vehicleQr?.imageDataUri, state.server?.vehicleQr?.shortLabel, papers)
                else -> {
                    when (folder.id) {
                        RC_FOLDER -> wallet.rc?.let {
                            VirtualRcCard(it)
                            OwnerRcControls(it.registrationNumber)
                        }
                        LICENCE_FOLDER -> wallet.licence?.let { LicenceCard(it) }
                        else -> folder.registerValidUntil?.let { RegisterLine(it) }
                    }
                    FolderFiles(folder, wallet)
                }
            }
        }
    }
}

/** The files filed in this folder, each opened from the copy on the phone. */
@Composable
private fun FolderFiles(folder: PaperFolderDto, wallet: PapersWalletDto) {
    val context = LocalContext.current
    val cache = remember(context) { (context.applicationContext as SaarthiDriverApp).papers }
    val onPhone by cache.cached.collectAsState()
    var opened by remember { mutableStateOf<Pair<String, PaperOpening>?>(null) }

    val files: List<DriverPaperDto> = folder.documentIds.mapNotNull { id -> wallet.documents.firstOrNull { it.id == id } }
    val hasRecord = wallet.hasRegisterRecord(folder)

    if (files.isEmpty()) {
        Hint(stringResource(if (hasRecord) R.string.papers_folder_no_scan else R.string.papers_folder_empty))
        return
    }
    files.forEach { paper ->
        key(paper.id) {
            PaperRow(
                paper,
                onPhone = paper.id in onPhone,
                onOpen = { opened = paper.displayTitle to openPaper(context, cache, paper) },
            )
        }
    }
    opened?.let { (title, result) ->
        PaperNotice(
            when (result) {
                PaperOpening.OPENED -> stringResource(R.string.papers_opening, title)
                PaperOpening.NOT_ON_PHONE -> stringResource(R.string.papers_not_saved)
                PaperOpening.NO_VIEWER -> stringResource(R.string.papers_no_viewer)
            },
        )
    }
}

/** The vehicle's photographs, two to a row; a tap shows one full size. */
@Composable
private fun PhotoGrid(photos: List<VehiclePhotoDto>, papers: PapersViewModel) {
    var shown by remember { mutableStateOf<VehiclePhotoDto?>(null) }
    if (photos.isEmpty()) {
        Hint(stringResource(R.string.papers_photos_none))
        return
    }
    shown?.let { photo ->
        FullPhoto(photo, papers, onClose = { shown = null })
        return
    }
    photos.chunked(2).forEach { pair ->
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            pair.forEach { photo ->
                Thumbnail(photo, papers, onOpen = { shown = photo }, Modifier.weight(1f))
            }
            if (pair.size == 1) Spacer(Modifier.weight(1f))
        }
    }
}

@Composable
private fun Thumbnail(photo: VehiclePhotoDto, papers: PapersViewModel, onOpen: () -> Unit, modifier: Modifier) {
    val bitmap by produceState<Bitmap?>(null, photo.id) { value = papers.photo(photo, thumbnail = true) }
    val label = photo.caption ?: stringResource(R.string.papers_photo_alt)
    Box(
        modifier
            .aspectRatio(4f / 3f)
            .clip(RoundedCornerShape(16.dp))
            .background(Saarthi.colors.sunken)
            .pressable(scale = 0.97f, label = label, onClick = onOpen),
        contentAlignment = Alignment.Center,
    ) {
        val image = bitmap
        if (image != null) {
            Image(image.asImageBitmap(), contentDescription = label, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            LineIcon(Lucide.image, size = 24.dp, color = Saarthi.colors.subtle)
        }
    }
}

@Composable
private fun FullPhoto(photo: VehiclePhotoDto, papers: PapersViewModel, onClose: () -> Unit) {
    val bitmap by produceState<Bitmap?>(null, photo.id) { value = papers.photo(photo, thumbnail = false) }
    val label = photo.caption ?: stringResource(R.string.papers_photo_alt)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = SType.bodyStrong, color = Saarthi.colors.fg, modifier = Modifier.weight(1f))
            CircleButton(Lucide.close, stringResource(R.string.action_close), onClose, size = 40.dp, elevated = false)
        }
        Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            val image = bitmap
            if (image != null) {
                Image(
                    image.asImageBitmap(),
                    contentDescription = label,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(image.width.toFloat() / image.height.coerceAtLeast(1)),
                )
            } else {
                Box(Modifier.fillMaxWidth().aspectRatio(4f / 3f), contentAlignment = Alignment.Center) {
                    LineIcon(Lucide.image, size = 28.dp, color = Color.White.copy(alpha = 0.6f))
                }
            }
        }
    }
}

/** The windscreen sticker: a scan opens this vehicle. */
@Composable
private fun QrSticker(dataUri: String?, label: String?, papers: PapersViewModel) {
    val bitmap by produceState<Bitmap?>(null, dataUri) { value = dataUri?.let { papers.qrBitmap(it) } }
    val image = bitmap
    if (image == null) {
        Hint(stringResource(R.string.papers_qr_none))
        return
    }
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
        ) {
            Image(image.asImageBitmap(), contentDescription = stringResource(R.string.papers_folder_qr), modifier = Modifier.fillMaxSize())
        }
        label?.let { Text(it, style = SType.mono(14.sp), color = Saarthi.colors.fg) }
        Text(stringResource(R.string.papers_qr_body), style = SType.small, color = Saarthi.colors.muted)
    }
}
