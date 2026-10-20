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
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.Toast
import com.saarthi.owner.ui.sharing.InvitationsOnHome
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.trips.TripsScreen
import com.saarthi.owner.ui.costs.CostAccess
import com.saarthi.owner.ui.drive.DriveCard
import com.saarthi.owner.ui.costs.RunningCostsCard
import com.saarthi.owner.ui.costs.RunningCostsScreen
import com.saarthi.owner.ui.sos.SosAlertScreen
import com.saarthi.owner.ui.sos.SosCard
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
fun FleetHomeScreen(app: OwnerApp, account: SessionStore.Account, onOpenAlerts: () -> Unit, onOpenMap: () -> Unit) {
    val model = viewModel { FleetHomeModel(app.fleet, app.toll, app.fuel, app.alerts, app.returnLoads, app.sos, account) }
    val state by model.state.collectAsStateWithLifecycle()
    val acting by model.acting.collectAsStateWithLifecycle()
    val message by model.message.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val costs = remember(account) { CostAccess(account) }
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
                            stringResource(if (live) R.string.fleet_main_live else R.string.fleet_main_quiet),
                            background = if (live) c.successBg else c.warningBg,
                            ink = if (live) c.success else c.warning,
                            live = live,
                        )
                        Text(
                            if (live) pluralStringResource(R.plurals.fleet_main_reporting, data.reporting, data.reporting) else stringResource(R.string.fleet_main_none_reported),
                            style = SType.small,
                            color = c.muted,
                            maxLines = 1,
                        )
                    }
                    InvitationsOnHome(app, account, Modifier.rise())
                    DriveCard(app, account, Modifier.rise())
                    data.sos.forEach { incident ->
                        SosCard(incident, Modifier.rise()) {
                            navigator.push("sos-${incident.id}") { SosAlertScreen(app.sos, account, incident) }
                        }
                    }
                    FleetNowCard(data, modifier = Modifier.rise(stagger(1)), onOpenMap = onOpenMap)
                    NeedsYouNow(
                        home = data,
                        acting = acting,
                        canApprove = account.can("terminal.approve"),
                        onApprove = model::approve,
                        onReview = { id ->
                            data.approvals.firstOrNull { it.id == id }?.let { waiting ->
                                navigator.push("approval-$id") { DriverApprovalScreen(app, waiting, canApprove = account.can("terminal.approve")) { model.refresh(silent = true) } }
                            }
                        },
                        onOpenAlerts = onOpenAlerts,
                        modifier = Modifier.rise(stagger(2)),
                    )
                    MorningTiles(
                        data,
                        modifier = Modifier.rise(stagger(3)),
                        onTrips = if (account.can("trips.read")) {
                            { navigator.push("trips") { TripsScreen(app, account) } }
                        } else {
                            null
                        },
                        onExpenses = if (costs.tabs.isNotEmpty()) {
                            { navigator.push("costs") { RunningCostsScreen(app, account) } }
                        } else {
                            null
                        },
                    )
                    RunningCostsCard(
                        costs,
                        onOpen = { navigator.push("costs") { RunningCostsScreen(app, account) } },
                        modifier = Modifier.rise(stagger(3)),
                    )
                    if (data.emptySoon.isNotEmpty()) {
                        BackhaulCard(data.emptySoon, Modifier.rise(stagger(4))) {
                            navigator.push("return-loads") { ReturnLoadsScreen(app) }
                        }
                    }
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
    }
}
