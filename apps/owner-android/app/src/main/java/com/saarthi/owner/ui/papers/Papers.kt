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
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.plural
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
    DetailScreen(eyebrow = formatPlate(vehicle.registrationNumber), title = "Papers", spacing = 12.dp) {
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
        state = Loadable.Loading
        state = try {
            Loadable.Ready(app.papers.wallet(vehicle.id))
        } catch (failure: Exception) {
            Loadable.Failed(failure.readable())
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
                            "${plural(standing.expired, "paper")} expired or turned down. Renew ${if (standing.expired == 1) "it" else "them"} before a check post stops this vehicle."
                        } else {
                            "${plural(standing.attention, "paper")} running out soon. Renew before ${if (standing.attention == 1) "it lapses" else "they lapse"}."
                        },
                        if (standing.expired > 0) NoticeTone.DANGER else NoticeTone.WARNING,
                        Modifier.rise(),
                        icon = Lucide.alertTriangle,
                    )
                }
                Eyebrow("Folders", Modifier.padding(start = 4.dp, top = 4.dp).rise(stagger(1)))
                FolderGrid(
                    wallet,
                    onOpen = { folder ->
                        navigator.push("paper-folder-${vehicle.id}-${folder.id}") {
                            PaperFolderScreen(app, vehicle, wallet, folder.id)
                        }
                    },
                    modifier = Modifier.rise(stagger(2)),
                )
            }
        }
    }
}
