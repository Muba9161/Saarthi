package com.saarthi.owner.ui.papers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.shell.LocalNavigator

/** One vehicle's papers, opened from its Papers card. */
@Composable
fun VehiclePapersScreen(app: OwnerApp, vehicle: VehiclesApi.Vehicle) {
    DetailScreen(eyebrow = formatPlate(vehicle.registrationNumber), title = stringResource(R.string.papers_title), spacing = 12.dp) {
        PapersWallet(app, vehicle)
    }
}

/**
 * A vehicle's papers wallet: every folder, with the worst news on top.
 *
 * Filed exactly as the web's Documents tab files them, and including what the
 * RTO register holds, so a vehicle whose papers came from the register rather
 * than a scanner no longer reads as having none. A failed read says so and
 * offers a retry; it is never drawn as an empty wallet.
 */
@Composable
fun PapersWallet(app: OwnerApp, vehicle: VehiclesApi.Vehicle, modifier: Modifier = Modifier) {
    val navigator = LocalNavigator.current
    var attempt by remember { mutableIntStateOf(0) }
    var state by remember(vehicle.id) { mutableStateOf<Loadable<PapersApi.Wallet>>(Loadable.Loading) }

    LaunchedEffect(vehicle.id, attempt) {
        // A re-read after an upload keeps what is on screen until the new answer lands.
        val shown = state as? Loadable.Ready
        if (shown == null) state = Loadable.Loading
        state = try {
            Loadable.Ready(app.papers.wallet(vehicle.id))
        } catch (failure: Exception) {
            shown ?: Loadable.Failed(failure.readable())
        }
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when (val shown = state) {
            Loadable.Loading -> SkeletonCards()
            is Loadable.Failed -> FailedCard(shown.message, { attempt++ })
            is Loadable.Ready -> {
                val wallet = shown.value
                val standing = wallet.standing()
                if (standing.attention > 0) {
                    NoticeCard(
                        if (standing.expired > 0) {
                            pluralStringResource(R.plurals.papers_wallet_expired, standing.expired, standing.expired)
                        } else {
                            pluralStringResource(R.plurals.papers_wallet_expiring, standing.attention, standing.attention)
                        },
                        if (standing.expired > 0) NoticeTone.DANGER else NoticeTone.WARNING,
                        Modifier.rise(),
                        icon = Lucide.alertTriangle,
                    )
                }
                Eyebrow(stringResource(R.string.papers_wallet_folders), Modifier.padding(start = 4.dp, top = 4.dp).rise(stagger(1)))
                FolderGrid(
                    wallet,
                    onOpen = { folder ->
                        navigator.push("paper-folder-${vehicle.id}-${folder.id}") {
                            PaperFolderScreen(app, vehicle, wallet, folder.id, onChanged = { attempt++ })
                        }
                    },
                    modifier = Modifier.rise(stagger(2)),
                )
            }
        }
    }
}
