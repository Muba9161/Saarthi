package com.saarthi.owner.ui.seller

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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.ui.common.FacesAlignment
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.dayOf
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.rememberPhoto
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.design.Brand
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.jobs.Pill
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.shell.ShellActions
import kotlinx.coroutines.delay

private const val REFRESH_MS = 45_000L

/**
 * The seller's home — the design's Seller · Home.
 *
 * Which fleets' trucks are coming to load and whether each has paid, the
 * three numbers a yard checks, and the way to the stock fleets see. Fleets
 * buy and send their own trucks; the seller loads, and never delivers.
 */
@Composable
fun SellerHomeScreen(app: OwnerApp, actions: ShellActions) {
    val model = viewModel { SellerModel(app.orders, app.materials) }
    val state by model.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val c = Saarthi.colors

    LaunchedEffect(Unit) {
        while (true) {
            delay(REFRESH_MS)
            model.refresh(silent = true)
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = headerClearance(), bottom = tabBarClearance()),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        when (val shown = state) {
            Loadable.Loading -> SkeletonCards()
            is Loadable.Failed -> FailedCard(shown.message, { model.refresh() })
            is Loadable.Ready -> {
                val book = shown.value
                val coming = book.comingToLoad
                val paidCount = coming.count { it.paid }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(206.dp)
                        .rise()
                        .clip(RoundedCornerShape(28.dp)),
                ) {
                    Image(painterResource(R.drawable.photo_role_seller), null, contentScale = ContentScale.Crop, alignment = FacesAlignment, modifier = Modifier.fillMaxSize())
                    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x33021D40), Color(0xF2021D40)))))
                    Column(Modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.SpaceBetween) {
                        if (coming.isNotEmpty()) {
                            StatusPill(
                                "$paidCount paid · ${coming.size - paidCount} awaiting payment",
                                background = Color.White.copy(alpha = 0.16f),
                                ink = Color.White,
                                dotColor = Brand.live,
                                live = true,
                                ring = Color.White.copy(alpha = 0.2f),
                            )
                        } else {
                            Box(Modifier.size(1.dp))
                        }
                        Row(verticalAlignment = Alignment.Bottom) {
                            Column(Modifier.weight(1f)) {
                                Eyebrow("Coming to load", color = Color.White.copy(alpha = 0.78f))
                                Text(
                                    if (coming.isEmpty()) "No trucks due" else "${coming.size} truck${if (coming.size == 1) "" else "s"}",
                                    style = SType.title.copy(fontSize = 30.sp),
                                    color = Color.White,
                                )
                            }
                            if (coming.isNotEmpty()) {
                                Row(
                                    Modifier
                                        .height(44.dp)
                                        .clip(CircleShape)
                                        .background(Color.White)
                                        .pressable { actions.selectTab("loading") }
                                        .padding(horizontal = 16.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    Text("Load", style = SType.bodyStrong, color = Brand.navy)
                                    LineIcon(Lucide.arrowRight, size = 16.dp, color = Brand.navy, stroke = 2.2f)
                                }
                            }
                        }
                    }
                }

                Row(Modifier.fillMaxWidth().rise(stagger(1)), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    val fleets = book.orders.filter { it.order.open }.mapNotNull { it.order.fleetName }.distinct().size
                    Tile(Lucide.box, c.primarySoft, c.primary, "Orders", book.orders.count { it.order.open }.toString(), "from $fleets fleet${if (fleets == 1) "" else "s"}", Modifier.weight(1f)) {
                        actions.selectTab("loading")
                    }
                    Tile(Lucide.receipt, c.successSoft, c.success, "Received", rupeesShort(book.receivedThisMonth()), "${book.awaitingPayment.size} more due", Modifier.weight(1f)) {
                        actions.selectTab("money")
                    }
                    val low = book.listings.count { it.low }
                    Tile(
                        if (low > 0) Lucide.alertTriangle else Lucide.check,
                        if (low > 0) c.warningSoft else c.successSoft,
                        if (low > 0) c.warning else c.success,
                        "Stock",
                        if (low == 0) "All fine" else "$low low",
                        "see stock",
                        Modifier.weight(1f),
                        if (low > 0) c.warning else c.fg,
                    ) {
                        actions.selectTab("stock")
                    }
                }

                Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Coming to load", style = SType.section, color = c.fg, modifier = Modifier.weight(1f))
                    LinkButton("All orders", { actions.selectTab("loading") }, style = SType.smallStrong)
                }
                if (coming.isEmpty()) {
                    Text("When a fleet buys from you, its truck shows up here.", style = SType.small, color = c.muted)
                }
                coming.take(4).forEach { seller ->
                    LoadRow(seller) { navigator.push("load-${seller.order.id}") { SellerOrderScreen(app, seller) { model.refresh(silent = true) } } }
                }
                Text(
                    "Fleets buy from you and send their own trucks. You load; they deliver.",
                    style = SType.caption,
                    color = c.subtle,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
    }
}

/** ₹2.84L, ₹37k — the short form a tile has room for. */
internal fun rupeesShort(amount: Double): String = when {
    amount >= 1_00_00_000 -> "₹%.1fCr".format(amount / 1_00_00_000)
    amount >= 1_00_000 -> "₹%.1fL".format(amount / 1_00_000)
    amount >= 1_000 -> "₹%.0fk".format(amount / 1_000)
    else -> rupees(amount)
}

@Composable
private fun Tile(
    icon: String,
    well: Color,
    ink: Color,
    label: String,
    value: String,
    caption: String,
    modifier: Modifier,
    valueColor: Color = Saarthi.colors.fg,
    onClick: () -> Unit,
) {
    val c = Saarthi.colors
    Column(
        modifier
            .card()
            .pressable(onClick = onClick)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        IconWell(icon, well = well, ink = ink, size = 30.dp, radius = 10.dp, iconSize = 16.dp)
        Eyebrow(label, maxLines = 1)
        Text(value, style = SType.headerTitle.copy(fontSize = 19.sp), color = valueColor, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(caption, style = SType.caption, color = c.subtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** One fleet's truck coming for its order: paid or not, and when. */
@Composable
internal fun LoadRow(seller: SellerOrder, onOpen: () -> Unit) {
    val c = Saarthi.colors
    val order = seller.order
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 22.dp, ring = if (seller.paid) c.primaryRing else c.ring)
            .pressable(scale = 0.98f, onClick = onOpen)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        val photo = rememberPhoto(R.drawable.vehicle_tipper)
        Box(Modifier.size(width = 70.dp, height = 48.dp).clip(RoundedCornerShape(12.dp)).background(c.sunken), contentAlignment = Alignment.Center) {
            if (photo != null) Image(photo, null, contentScale = ContentScale.Fit, modifier = Modifier.padding(4.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(order.what, style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(order.fleetName ?: "A fleet", style = SType.caption, color = c.muted, maxLines = 1)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                when {
                    seller.paid -> Pill("Paid ${seller.amount?.let(::rupees) ?: ""}".trim(), c.successBg, c.success)
                    seller.outsideApp -> Pill(seller.amount?.let(::rupees) ?: "Sold", c.sunken, c.muted)
                    else -> Pill("Payment due", c.warningBg, c.warning)
                }
                (if (seller.comingToLoad) clockOf(order.pickupAt)?.let { "truck at $it" } else dayOf(order.pickupAt)?.let { "picked up $it" })?.let {
                    Text(it, style = SType.caption, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                }
            }
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}
