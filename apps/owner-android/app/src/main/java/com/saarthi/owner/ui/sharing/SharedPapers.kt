package com.saarthi.owner.ui.sharing

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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.network.SharingApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.papers.FolderGrid
import com.saarthi.owner.ui.papers.PaperFileRow
import com.saarthi.owner.ui.papers.PaperOpening
import com.saarthi.owner.ui.papers.RC_FOLDER
import com.saarthi.owner.ui.papers.ReadOnlyPhotos
import com.saarthi.owner.ui.papers.RegisterLine
import com.saarthi.owner.ui.papers.StatusTag
import com.saarthi.owner.ui.papers.VirtualRcCard
import com.saarthi.owner.ui.papers.filesIn
import com.saarthi.owner.ui.papers.folderStatus
import com.saarthi.owner.ui.papers.openPaper
import com.saarthi.owner.ui.papers.paperFile
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** The way from a shared vehicle to its papers. */
@Composable
internal fun SharedPapersCard(onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .pressable(scale = 0.99f, label = stringResource(R.string.people_shared_papers_open), onClick = onOpen)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(Lucide.fileText, well = c.primarySoft, ink = c.primary, size = 40.dp, radius = 12.dp, iconSize = 18.dp)
        Column(Modifier.weight(1f)) {
            Eyebrow(stringResource(R.string.people_papers))
            Text(stringResource(R.string.people_shared_papers_card_line), style = SType.rowTitle, color = c.fg)
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}

/**
 * A shared vehicle's papers, for the person it is shared with: the same
 * folders the owner and driver see, to open and look at. Nothing can be
 * uploaded or changed here, the RC is masked, and the QR sticker stays with
 * the owner.
 */
@Composable
fun SharedPapersScreen(app: OwnerApp, vehicle: SharingApi.SharedVehicle) {
    val navigator = LocalNavigator.current
    var attempt by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Loadable<PapersApi.Wallet>>(Loadable.Loading) }

    LaunchedEffect(vehicle.shareId, attempt) {
        state = Loadable.Loading
        state = try {
            Loadable.Ready(app.sharing.papers(vehicle.shareId))
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            Loadable.Failed(failure.readable())
        }
    }

    DetailScreen(eyebrow = formatPlate(vehicle.registrationNumber), title = stringResource(R.string.people_papers), spacing = 12.dp) {
        when (val shown = state) {
            Loadable.Loading -> SkeletonCards()
            is Loadable.Failed -> FailedCard(shown.message, { attempt++ })
            is Loadable.Ready -> {
                NoticeCard(stringResource(R.string.people_shared_papers_notice), NoticeTone.INFO)
                FolderGrid(
                    shown.value,
                    onOpen = { folder ->
                        navigator.push("shared-paper-${vehicle.shareId}-${folder.id}") {
                            SharedFolderScreen(app, vehicle, shown.value, folder.id)
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun SharedFolderScreen(app: OwnerApp, vehicle: SharingApi.SharedVehicle, wallet: PapersApi.Wallet, folderId: String) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val folder = wallet.folders.firstOrNull { it.id == folderId }
    var opening by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }

    DetailScreen(eyebrow = formatPlate(vehicle.registrationNumber), title = folder?.label ?: stringResource(R.string.people_papers), spacing = 12.dp) {
        if (folder == null) {
            Hint(stringResource(R.string.people_shared_folder_gone))
            return@DetailScreen
        }
        folder.folderStatus?.let { StatusTag(it) }
        if (folder.kind == PapersApi.KIND_PHOTOS) {
            ReadOnlyPhotos(wallet.photos) { id, thumbnail -> app.sharing.photo(vehicle.shareId, id, thumbnail) }
            return@DetailScreen
        }
        val rc = wallet.rc
        if (folder.id == RC_FOLDER && rc != null) VirtualRcCard(rc)
        folder.registerValidUntil?.let { RegisterLine(it) }
        val files = wallet.filesIn(folder)
        if (files.isEmpty() && folder.registerValidUntil == null && !(folder.id == RC_FOLDER && rc != null)) {
            Hint(stringResource(R.string.people_shared_folder_empty))
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
                            app.sharing.downloadPaper(vehicle.shareId, paper.id, file)
                            if (openPaper(context, file, paper.mimeType) == PaperOpening.NO_VIEWER) Words.get(R.string.people_paper_no_viewer) to NoticeTone.WARNING else null
                        } catch (failure: Exception) {
                            if (failure is CancellationException) throw failure
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
}
