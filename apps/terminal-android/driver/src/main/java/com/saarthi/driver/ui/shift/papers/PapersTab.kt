package com.saarthi.driver.ui.shift.papers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.core.network.PaperFolderDto
import com.saarthi.core.network.PapersWalletDto
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.shift.headerClearance
import com.saarthi.driver.ui.shift.tabBarClearance

/**
 * Papers — every document a checkpoint might ask for, filed in the same
 * folders the fleet sees on the web, and held on this phone.
 *
 * The vehicle's folders first (RC, insurance, fitness, permit, PUC, road tax,
 * photographs, the QR sticker), then the driver's own (licence, identity and
 * address proofs and the rest). A folder holds what the RTO register says about
 * the paper as well as any file uploaded into it, so a vehicle whose papers came
 * from the register rather than a scanner no longer looks as if it has none.
 *
 * The wallet is refreshed when the tab appears and kept on the phone whole;
 * opening a paper only ever reads the saved copy, because the places an officer
 * asks for a permit are the places with no signal.
 */
@Composable
fun PapersTab(cockpit: TerminalViewModel) {
    val papers: PapersViewModel = viewModel()
    val ui by papers.ui.collectAsState()
    var openId by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { papers.refresh() }

    val wallet = ui.wallet
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = headerClearance(), bottom = tabBarClearance()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val c = Saarthi.colors
        Text(
            stringResource(R.string.papers_lead),
            style = SType.lead,
            color = c.muted,
            modifier = Modifier.rise(distance = PapersRise),
        )
        when {
            wallet != null -> WalletContent(wallet, onOpen = { openId = it.id })
            ui.problem != null -> PapersStateCard(
                Lucide.alertTriangle,
                well = c.dangerSoft,
                ink = c.danger,
                title = stringResource(R.string.papers_error_title),
                body = ui.problem.orEmpty(),
                modifier = Modifier.rise(distance = PapersRise),
                onRetry = papers::refresh,
            )
            else -> PapersSkeleton()
        }
        if (wallet != null) ui.problem?.let { PaperNotice(it, Modifier.rise(distance = PapersRise)) }
    }

    PaperFolderSheet(
        folder = wallet?.folders?.firstOrNull { it.id == openId },
        wallet = wallet,
        cockpit = cockpit,
        papers = papers,
        onClose = { openId = null },
    )
}

@Composable
private fun WalletContent(wallet: PapersWalletDto, onOpen: (PaperFolderDto) -> Unit) {
    val attention = wallet.folders.filter { it.folderStatus?.needsAttention == true }
    if (attention.isNotEmpty()) {
        AttentionBanner(
            count = attention.size,
            anyExpired = attention.any { it.folderStatus == FolderStatus.EXPIRED },
            modifier = Modifier.rise(60, PapersRise),
        )
    }

    val hasRecord: (PaperFolderDto) -> Boolean = wallet::hasRegisterRecord
    val (vehicle, yours) = wallet.folders.partition { it.isVehicle }

    Eyebrow(stringResource(R.string.papers_owner_vehicle), Modifier.padding(start = 4.dp, top = 6.dp).rise(90, PapersRise))
    FolderGrid(vehicle, hasRecord, onOpen, Modifier.rise(120, PapersRise))

    if (yours.isNotEmpty()) {
        Eyebrow(stringResource(R.string.papers_owner_yours), Modifier.padding(start = 4.dp, top = 10.dp).rise(160, PapersRise))
        FolderGrid(yours, hasRecord, onOpen, Modifier.rise(190, PapersRise))
    }
}
