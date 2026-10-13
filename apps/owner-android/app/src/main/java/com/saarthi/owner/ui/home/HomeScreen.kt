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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.AccountType
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.AlertsApi
import com.saarthi.owner.ui.alerts.look
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
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
import com.saarthi.owner.ui.fleet.FleetHomeScreen

/** Each kind of business opens on its own home. */
@Composable
fun HomeScreen(app: OwnerApp, account: SessionStore.Account, onOpenAlerts: () -> Unit) {
    when (account.accountType) {
        AccountType.FLEET -> FleetHomeScreen(app, account, onOpenAlerts)
        else -> BusinessHomeScreen(app.alerts, account, onOpenAlerts)
    }
}

/** What each business is, in a photograph and a line. */
private data class Intro(@DrawableRes val photo: Int, val eyebrow: String, val line: String)

private fun introFor(type: AccountType): Intro = when (type) {
    AccountType.PERSONAL -> Intro(R.drawable.photo_cta_dusk, "Personal", "Your vehicles, their papers and every trip.")
    AccountType.TRAVEL -> Intro(R.drawable.photo_role_travel, "Travel", "Bookings, vehicles and the road ahead.")
    AccountType.CUSTOMER -> Intro(R.drawable.photo_role_customer, "Customer", "What you need moved, and where it is now.")
    AccountType.SELLER -> Intro(R.drawable.photo_role_seller, "Seller", "Your stock, and the trucks coming to load it.")
    AccountType.ASSOCIATION -> Intro(R.drawable.photo_role_association, "Association", "Your members, and anyone who needs help on the road.")
    else -> Intro(R.drawable.photo_role_fleet, "Saarthi", "Your business on Saarthi.")
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

        GroupLabel("Latest")
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
                            "Nothing new. Alerts about your business show up here.",
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
                LinkButton("See all alerts", onOpenAlerts, style = SType.smallStrong)
            }
        }
    }
}
