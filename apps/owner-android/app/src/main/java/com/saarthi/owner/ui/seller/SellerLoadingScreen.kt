package com.saarthi.owner.ui.seller

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.rememberPhoto
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.bottomRule
import com.saarthi.owner.ui.design.brandGradient
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.orders.orderStatusLook
import com.saarthi.owner.ui.shell.LocalNavigator

/** Every order fleets have placed with the seller, coming first. */
@Composable
fun SellerLoadingScreen(app: OwnerApp) {
    val model = viewModel { SellerModel(app.orders, app.materials) }
    val state by model.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val c = Saarthi.colors
    val top = headerClearance()
    val bottom = tabBarClearance()

    when (val shown = state) {
        Loadable.Loading -> SkeletonCards(modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = top))
        is Loadable.Failed -> FailedCard(shown.message, { model.refresh() }, Modifier.padding(start = 20.dp, end = 20.dp, top = top))
        is Loadable.Ready -> {
            val book = shown.value
            val coming = book.comingToLoad
            val rest = book.orders.filter { it.order.fleetName != null && it !in coming }
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = top, bottom = bottom),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (coming.isEmpty() && rest.isEmpty()) {
                    item { Text("When a fleet buys from you, its order shows up here.", style = SType.small, color = c.muted) }
                }
                if (coming.isNotEmpty()) item { GroupLabel("Coming to load") }
                items(coming, key = { it.order.id }) { seller ->
                    LoadRow(seller) { navigator.push("load-${seller.order.id}") { SellerOrderScreen(app, seller) { model.refresh(silent = true) } } }
                }
                if (rest.isNotEmpty()) item { GroupLabel("Other orders") }
                items(rest, key = { it.order.id }) { seller ->
                    LoadRow(seller) { navigator.push("load-${seller.order.id}") { SellerOrderScreen(app, seller) { model.refresh(silent = true) } } }
                }
            }
        }
    }
}

/**
 * One order at the seller's gate — the design's "Load the truck".
 *
 * Whether the fleet has paid, which truck is collecting, and what to load.
 * The fleet handles the delivery from here; the customer is never named.
 */
@Composable
fun SellerOrderScreen(app: OwnerApp, seller: SellerOrder, onChanged: () -> Unit) {
    val c = Saarthi.colors
    val order = seller.order
    val look = orderStatusLook(order.status)
    DetailScreen(
        eyebrow = listOfNotNull("Order ${order.reference}", order.fleetName).joinToString(" · "),
        title = "Load the truck",
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(190.dp)
                .rise()
                .shadow(16.dp, RoundedCornerShape(28.dp), spotColor = Color(0xBF021D40), ambientColor = Color.Transparent)
                .brandGradient(RoundedCornerShape(28.dp)),
        ) {
            val photo = rememberPhoto(R.drawable.vehicle_tipper)
            if (photo != null) {
                Image(photo, null, contentScale = ContentScale.Fit, modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp).size(width = 150.dp, height = 80.dp))
            }
            Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.SpaceBetween) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Eyebrow(if (order.status == "PICKUP") "At your gate" else "Collecting", Modifier.weight(1f), color = Color.White.copy(alpha = 0.75f))
                    StatusPill(look.word, background = Color.White.copy(alpha = 0.14f), ink = Color.White, ring = Color.White.copy(alpha = 0.2f))
                }
                Text(
                    order.assignedTruck?.registrationNumber?.let(::formatPlate) ?: "Truck to be named",
                    style = SType.plate(30.sp, 0.03.em),
                    color = Color.White,
                    maxLines = 1,
                )
                Text(
                    listOfNotNull(order.assignedDriver?.name?.let { "Driver $it" }, clockOf(order.pickupAt)?.let { "due $it" }).joinToString(" · "),
                    style = SType.small,
                    color = Color.White.copy(alpha = 0.8f),
                )
            }
        }

        Column(Modifier.fillMaxWidth().rise(stagger(1)).card(radius = 22.dp)) {
            val fleet = order.fleetName ?: "the fleet"
            Check(
                done = seller.paid || seller.outsideApp,
                title = when {
                    seller.paid -> "Paid by $fleet"
                    seller.outsideApp -> "Sold to $fleet"
                    else -> "Waiting for $fleet to pay"
                },
                note = listOfNotNull(
                    seller.amount?.let(::rupees),
                    when {
                        seller.paid -> null
                        seller.outsideApp -> "not paid through Saarthi"
                        else -> "load only once it is paid"
                    },
                ).joinToString(" · "),
                divider = true,
            )
            Check(
                done = order.assignedTruck != null,
                title = order.assignedTruck?.let { "Truck ${formatPlate(it.registrationNumber)} is collecting" } ?: "The fleet names its truck",
                note = "Check the plate matches before loading",
                divider = true,
            )
            Check(
                done = order.status in setOf("IN_TRANSIT", "DELIVERED", "COMPLETED"),
                title = "Load ${order.what}",
                note = order.originAddress?.let { "At $it" },
                divider = false,
            )
        }
        Text(
            "${order.fleetName ?: "The fleet"} handles the delivery from here.",
            style = SType.caption,
            color = c.subtle,
        )
    }
}

@Composable
private fun Check(done: Boolean, title: String, note: String?, divider: Boolean) {
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .bottomRule(c.border, show = divider)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(
            if (done) Lucide.check else Lucide.clock,
            well = if (done) c.successSoft else c.warningSoft,
            ink = if (done) c.success else c.warning,
            size = 34.dp,
            shape = CircleShape,
            iconSize = 16.dp,
        )
        Column(Modifier.weight(1f)) {
            Text(title, style = SType.bodyStrong, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
            note?.ifBlank { null }?.let { Text(it, style = SType.caption, color = c.muted) }
        }
    }
}
