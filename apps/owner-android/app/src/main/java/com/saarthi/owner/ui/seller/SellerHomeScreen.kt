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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
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
                                stringResource(R.string.market_seller_paid_awaiting, paidCount, coming.size - paidCount),
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
                                Eyebrow(stringResource(R.string.market_seller_coming_to_load), color = Color.White.copy(alpha = 0.78f))
                                Text(
                                    if (coming.isEmpty()) stringResource(R.string.market_seller_no_trucks_due) else pluralStringResource(R.plurals.market_seller_trucks, coming.size, coming.size),
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
                                    Text(stringResource(R.string.market_seller_load), style = SType.bodyStrong, color = Brand.navy)
                                    LineIcon(Lucide.arrowRight, size = 16.dp, color = Brand.navy, stroke = 2.2f)
                                }
                            }
                        }
                    }
                }

                Row(Modifier.fillMaxWidth().rise(stagger(1)), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    val fleets = book.orders.filter { it.order.open }.mapNotNull { it.order.fleetName }.distinct().size
                    Tile(Lucide.box, c.primarySoft, c.primary, stringResource(R.string.market_seller_orders), book.orders.count { it.order.open }.toString(), pluralStringResource(R.plurals.market_seller_from_fleets, fleets, fleets), Modifier.weight(1f)) {
                        actions.selectTab("loading")
                    }
                    Tile(Lucide.receipt, c.successSoft, c.success, stringResource(R.string.market_seller_received), rupeesShort(book.receivedThisMonth()), stringResource(R.string.market_seller_more_due, book.awaitingPayment.size), Modifier.weight(1f)) {
                        actions.selectTab("money")
                    }
                    val low = book.listings.count { it.low }
                    Tile(
                        if (low > 0) Lucide.alertTriangle else Lucide.check,
                        if (low > 0) c.warningSoft else c.successSoft,
                        if (low > 0) c.warning else c.success,
                        stringResource(R.string.market_seller_stock),
                        if (low == 0) stringResource(R.string.market_seller_stock_fine) else stringResource(R.string.market_seller_stock_low, low),
                        stringResource(R.string.market_seller_see_stock),
                        Modifier.weight(1f),
                        if (low > 0) c.warning else c.fg,
                    ) {
                        actions.selectTab("stock")
                    }
                }

                Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.market_seller_coming_to_load), style = SType.section, color = c.fg, modifier = Modifier.weight(1f))
                    LinkButton(stringResource(R.string.market_seller_all_orders), { actions.selectTab("loading") }, style = SType.smallStrong)
                }
                if (coming.isEmpty()) {
                    Text(stringResource(R.string.market_seller_home_empty), style = SType.small, color = c.muted)
                }
                coming.take(4).forEach { seller ->
                    LoadRow(seller) { navigator.push("load-${seller.order.id}") { SellerOrderScreen(app, seller) { model.refresh(silent = true) } } }
                }
                Text(
                    stringResource(R.string.market_seller_home_footnote),
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
            Text(order.fleetName ?: stringResource(R.string.market_seller_a_fleet), style = SType.caption, color = c.muted, maxLines = 1)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                when {
                    seller.paid -> Pill(seller.amount?.let { stringResource(R.string.market_seller_paid_amount, rupees(it)) } ?: stringResource(R.string.market_seller_paid), c.successBg, c.success)
                    seller.outsideApp -> Pill(seller.amount?.let(::rupees) ?: stringResource(R.string.market_seller_sold), c.sunken, c.muted)
                    else -> Pill(stringResource(R.string.market_seller_payment_due), c.warningBg, c.warning)
                }
                (if (seller.comingToLoad) clockOf(order.pickupAt)?.let { stringResource(R.string.market_seller_truck_at, it) } else dayOf(order.pickupAt)?.let { stringResource(R.string.market_seller_picked_up, it) })?.let {
                    Text(it, style = SType.caption, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                }
            }
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}
