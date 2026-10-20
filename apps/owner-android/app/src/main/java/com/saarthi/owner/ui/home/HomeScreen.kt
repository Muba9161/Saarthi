package com.saarthi.owner.ui.home

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.AccountType
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.AlertsApi
import com.saarthi.owner.ui.alerts.look
import com.saarthi.owner.ui.common.FacesAlignment
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.common.ago
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.bottomRule
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.shell.TabHeader
import com.saarthi.owner.ui.shell.TabSpec

/**
 * The tabs of a business whose own screens are still to come: its home, with
 * who it is and the latest of what Saarthi has told it.
 */
fun businessTabs(app: OwnerApp, account: SessionStore.Account): List<TabSpec> = listOf(
    TabSpec(
        key = "home",
        label = Words.get(R.string.fleet_tab_home),
        icon = Lucide.home,
        header = TabHeader(account.organizationName, Words.get(R.string.fleet_greeting, account.firstName)),
        content = { actions -> BusinessHomeScreen(app.alerts, account, actions.openAlerts) },
    ),
)

/** What each business is, in a photograph and a line. */
private data class Intro(@DrawableRes val photo: Int, val eyebrow: String, val line: String)

private fun introFor(type: AccountType): Intro = when (type) {
    AccountType.PERSONAL -> Intro(R.drawable.photo_cta_dusk, Words.get(R.string.fleet_home_intro_personal_eyebrow), Words.get(R.string.fleet_home_intro_personal_line))
    AccountType.TRAVEL -> Intro(R.drawable.photo_role_travel, Words.get(R.string.fleet_home_intro_travel_eyebrow), Words.get(R.string.fleet_home_intro_travel_line))
    AccountType.CUSTOMER -> Intro(R.drawable.photo_role_customer, Words.get(R.string.fleet_home_intro_customer_eyebrow), Words.get(R.string.fleet_home_intro_customer_line))
    AccountType.SELLER -> Intro(R.drawable.photo_role_seller, Words.get(R.string.fleet_home_intro_seller_eyebrow), Words.get(R.string.fleet_home_intro_seller_line))
    AccountType.ASSOCIATION -> Intro(R.drawable.photo_role_association, Words.get(R.string.fleet_home_intro_association_eyebrow), Words.get(R.string.fleet_home_intro_association_line))
    else -> Intro(R.drawable.photo_role_fleet, "Saarthi", Words.get(R.string.fleet_home_intro_other_line))
}

/**
 * The home for a business whose own screens are still to come: who it is,
 * and the latest of what Saarthi has told it.
 */
@Composable
private fun BusinessHomeScreen(alerts: AlertsApi, account: SessionStore.Account, onOpenAlerts: () -> Unit) {
    val c = Saarthi.colors
    val intro = introFor(account.accountType)
    val state by produceState<Loadable<List<AlertsApi.Alert>>>(Loadable.Loading) {
        value = try {
            Loadable.Ready(alerts.page(pageSize = 6).items)
        } catch (error: Exception) {
            Loadable.Failed(error.readable())
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = headerClearance(), bottom = tabBarClearance()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {

        Box(
            Modifier
                .fillMaxWidth()
                .height(200.dp)
                .rise()
                .clip(RoundedCornerShape(28.dp)),
        ) {
            Image(
                painter = painterResource(intro.photo),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                alignment = FacesAlignment,
                modifier = Modifier.fillMaxSize(),
            )
            Column(
                Modifier
                    .fillMaxSize()
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xD9021D40))))
                    .padding(20.dp),
                verticalArrangement = Arrangement.Bottom,
            ) {
                Eyebrow(intro.eyebrow, color = Color.White.copy(alpha = 0.8f))
                Text(intro.line, style = SType.sheetTitle, color = Color.White)
            }
        }

        GroupLabel(stringResource(R.string.fleet_home_latest))
        when (val shown = state) {
            Loadable.Loading -> SkeletonCards(count = 1)
            is Loadable.Failed -> FailedCard(shown.message, onRetry = onOpenAlerts)
            is Loadable.Ready -> {
                val items = shown.value
                Column(
                    Modifier
                        .fillMaxWidth()
                        .rise(stagger(1))
                        .card(radius = 22.dp),
                ) {
                    if (items.isEmpty()) {
                        Text(
                            stringResource(R.string.fleet_home_nothing_new),
                            style = SType.small,
                            color = c.muted,
                            modifier = Modifier.padding(18.dp),
                        )
                    }
                    items.forEachIndexed { index, alert ->
                        val look = alert.look()
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .bottomRule(c.border, show = index < items.lastIndex)
                                .padding(horizontal = 16.dp, vertical = 14.dp),
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            IconWell(look.icon, well = look.well, ink = look.ink, size = 40.dp, radius = 12.dp, iconSize = 18.dp)
                            Column(Modifier.weight(1f)) {
                                Text(alert.title, style = SType.rowTitle, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                alert.body?.let {
                                    Text(it, style = SType.small, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            Text(ago(alert.createdAt), style = SType.caption, color = c.subtle)
                        }
                    }
                }
                LinkButton(stringResource(R.string.fleet_home_see_all_alerts), onOpenAlerts, style = SType.smallStrong)
            }
        }
    }
}
