package com.saarthi.owner.ui.fleet

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.plural
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.Toast
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import kotlinx.coroutines.delay

/** How often a fleet's home reads itself again while it is on screen. */
private const val REFRESH_MS = 30_000L

/**
 * The fleet's home — the design's "Fleet · Home", laid out as the driver
 * app's Home is: is the fleet reporting, how much of it is on the road, the
 * one thing that needs the owner now, and the three numbers checked every
 * morning. Scrolls under the shell's header and tab bar.
 */
@Composable
fun FleetHomeScreen(app: OwnerApp, account: SessionStore.Account, onOpenAlerts: () -> Unit) {
    val model = viewModel { FleetHomeModel(app.fleet, app.alerts, account) }
    val state by model.state.collectAsStateWithLifecycle()
    val acting by model.acting.collectAsStateWithLifecycle()
    val message by model.message.collectAsStateWithLifecycle()
    var reviewing by rememberSaveable { mutableStateOf<String?>(null) }
    val c = Saarthi.colors

    LaunchedEffect(Unit) {
        while (true) {
            delay(REFRESH_MS)
            model.refresh(silent = true)
        }
    }
    LaunchedEffect(message) {
        if (message != null) {
            delay(3_500)
            model.clearMessage()
        }
    }

    val home = (state as? Loadable.Ready)?.value
    val bottom = tabBarClearance()

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, top = headerClearance(), bottom = bottom),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            when (val shown = state) {
                Loadable.Loading -> SkeletonCards()
                is Loadable.Failed -> FailedCard(shown.message, onRetry = { model.refresh() })
                is Loadable.Ready -> {
                    val data = shown.value
                    val live = data.reporting > 0
                    Row(
                        Modifier.rise(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        StatusPill(
                            if (live) "Live" else "Quiet",
                            background = if (live) c.successBg else c.warningBg,
                            ink = if (live) c.success else c.warning,
                            live = live,
                        )
                        Text(
                            if (live) "${plural(data.reporting, "vehicle")} reporting to you" else "No vehicle has reported lately",
                            style = SType.small,
                            color = c.muted,
                            maxLines = 1,
                        )
                    }
                    FleetNowCard(data, modifier = Modifier.rise(stagger(1)))
                    NeedsYouNow(
                        home = data,
                        acting = acting,
                        onApprove = model::approve,
                        onReview = { reviewing = it },
                        onOpenAlerts = onOpenAlerts,
                        modifier = Modifier.rise(stagger(2)),
                    )
                    MorningTiles(data, modifier = Modifier.rise(stagger(3)))
                }
            }
        }

        message?.let {
            Toast(
                it,
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(start = 20.dp, end = 20.dp, bottom = bottom),
            )
        }

        ReviewSheet(
            approval = home?.approvals?.firstOrNull { it.id == reviewing },
            busy = acting != null,
            onApprove = { id ->
                model.approve(id)
                reviewing = null
            },
            onReject = { id, reason ->
                model.reject(id, reason)
                reviewing = null
            },
            onDismiss = { reviewing = null },
        )
    }
}
