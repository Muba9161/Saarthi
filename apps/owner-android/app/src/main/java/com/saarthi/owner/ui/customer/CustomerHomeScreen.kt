package com.saarthi.owner.ui.customer

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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.RequirementsApi
import com.saarthi.owner.ui.common.FacesAlignment
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.shell.ShellActions
import kotlinx.coroutines.delay

private const val REFRESH_MS = 45_000L

/**
 * The customer's front door — the design's Customer · Home.
 *
 * One question, four ways to answer it, and the requests and orders already
 * in hand. Verified fleets source and deliver; the customer deals only with
 * the fleet it chooses.
 */
@Composable
fun CustomerHomeScreen(app: OwnerApp, actions: ShellActions) {
    val model = viewModel { CustomerModel(app.requirements, app.orders, app.travel) }
    val state by model.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val c = Saarthi.colors

    LaunchedEffect(Unit) {
        while (true) {
            delay(REFRESH_MS)
            model.refresh(silent = true)
        }
    }

    val post = { kind: String ->
        model.startPost(kind)
        actions.selectTab("post")
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = headerClearance(), bottom = tabBarClearance()),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(206.dp)
                .rise()
                .clip(RoundedCornerShape(28.dp))
                .pressable(scale = 0.98f) { post(RequirementsApi.KIND_MATERIAL) },
        ) {
            Image(
                painterResource(R.drawable.photo_role_customer),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                alignment = FacesAlignment,
                modifier = Modifier.fillMaxSize(),
            )
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Brush.horizontalGradient(listOf(Color(0xF2021D40), Color(0xB3021D40), Color(0x33021D40)))),
            )
            Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Eyebrow("One front door", color = Color(0xFFFE8A4B))
                Text("What do you need moved?", style = SType.title, color = Color.White)
                Text(
                    "Post once. Verified fleets source it and quote one delivered price.",
                    style = SType.small,
                    color = Color.White.copy(alpha = 0.82f),
                    modifier = Modifier.padding(end = 60.dp),
                )
            }
        }

        Row(Modifier.fillMaxWidth().rise(stagger(1)), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            KindTile("Material", Lucide.box, c.accentSoft, c.accent, Modifier.weight(1f)) { post(RequirementsApi.KIND_MATERIAL) }
            KindTile("Freight", Lucide.truck, c.primarySoft, c.primary, Modifier.weight(1f)) { post(RequirementsApi.KIND_FREIGHT) }
            KindTile("Cab", Lucide.car, c.infoSoft, c.info, Modifier.weight(1f)) { post(RequirementsApi.KIND_CAB) }
            KindTile("Tour", Lucide.bus, c.successSoft, c.success, Modifier.weight(1f)) { post(RequirementsApi.KIND_TOUR) }
        }

        Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Your orders", style = SType.section, color = c.fg, modifier = Modifier.weight(1f))
            (state as? Loadable.Ready)?.value?.let { book ->
                LinkButton("All ${book.requests.size + book.orders.size}", { actions.selectTab("orders") }, style = SType.smallStrong)
            }
        }

        when (val shown = state) {
            Loadable.Loading -> SkeletonCards(count = 2)
            is Loadable.Failed -> FailedCard(shown.message, { model.refresh() })
            is Loadable.Ready -> {
                val book = shown.value
                if (book.openRequests.isEmpty() && book.orders.isEmpty()) {
                    Text(
                        "Nothing yet. Post what you need and fleets near you will bid.",
                        style = SType.small,
                        color = c.muted,
                    )
                }
                book.openRequests.take(3).forEach { request ->
                    RequestRow(request) {
                        navigator.push("bids-${request.id}") { CustomerBidsScreen(app, request) { model.refresh(silent = true) } }
                    }
                }
                book.orders.filter { it.open }.take(3).forEach { order ->
                    CustomerOrderRow(order) {
                        navigator.push("order-${order.id}") { CustomerOrderScreen(app, order) { model.refresh(silent = true) } }
                    }
                }
            }
        }
    }
}

@Composable
private fun KindTile(label: String, icon: String, well: Color, ink: Color, modifier: Modifier, onClick: () -> Unit) {
    val c = Saarthi.colors
    Column(
        modifier
            .card(radius = 20.dp)
            .pressable(scale = 0.95f, label = "Post $label", onClick = onClick)
            .padding(vertical = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        IconWell(icon, well = well, ink = ink, size = 42.dp, radius = 14.dp, iconSize = 20.dp)
        Text(label, style = SType.smallStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
