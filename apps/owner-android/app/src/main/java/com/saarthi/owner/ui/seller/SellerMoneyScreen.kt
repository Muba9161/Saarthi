package com.saarthi.owner.ui.seller

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.design.Eyebrow
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
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

/**
 * "Money" — what fleets have paid the seller, and what they still owe.
 *
 * Payments land in the bank account the seller connected on the web; this
 * screen shows that account but never asks for one.
 */
@Composable
fun SellerMoneyScreen(app: OwnerApp) {
    val model = viewModel { SellerModel(app.orders, app.materials) }
    val state by model.state.collectAsStateWithLifecycle()
    val c = Saarthi.colors

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
                val month = LocalDate.now().month.getDisplayName(TextStyle.FULL, Locale.getDefault())
                val payout = book.payout
                Column(
                    Modifier
                        .fillMaxWidth()
                        .rise()
                        .shadow(16.dp, RoundedCornerShape(28.dp), spotColor = Color(0xBF021D40), ambientColor = Color.Transparent)
                        .brandGradient(RoundedCornerShape(28.dp))
                        .padding(22.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Eyebrow(stringResource(R.string.market_seller_money_received_in, month), Modifier.weight(1f), color = Color.White.copy(alpha = 0.75f))
                        StatusPill(
                            if (payout?.usable == true) stringResource(R.string.market_seller_money_bank_verified) else stringResource(R.string.market_seller_money_bank_not_connected),
                            background = Color.White.copy(alpha = 0.14f),
                            ink = Color.White,
                            dotColor = if (payout?.usable == true) Color(0xFF4ADE80) else Color(0xFFF2952C),
                            ring = Color.White.copy(alpha = 0.2f),
                        )
                    }
                    Text(rupees(book.receivedThisMonth()), style = SType.figure.copy(fontSize = 40.sp, lineHeight = 44.sp), color = Color.White)
                    Text(
                        listOfNotNull(
                            payout?.let { listOfNotNull(it.bankName, it.maskedAccount).joinToString(" ").ifBlank { null } }?.let { stringResource(R.string.market_seller_money_to_bank, it) },
                            book.received.mapNotNull { it.order.fleetName }.distinct().size.let { fleets ->
                                pluralStringResource(R.plurals.market_seller_money_orders_from_fleets, fleets, book.received.size, fleets)
                            },
                        ).joinToString(" · "),
                        style = SType.small,
                        color = Color.White.copy(alpha = 0.82f),
                    )
                    if (payout?.usable != true) {
                        Text(
                            stringResource(R.string.market_seller_money_connect_bank),
                            style = SType.caption,
                            color = Color(0xFFFE8A4B),
                        )
                    }
                }

                val awaiting = book.awaitingPayment
                Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.Bottom) {
                    Text(stringResource(R.string.market_seller_money_awaiting), style = SType.section, color = c.fg, modifier = Modifier.weight(1f))
                    Text(rupees(awaiting.sumOf { it.amount ?: 0.0 }), style = SType.section, color = c.fg)
                }
                if (awaiting.isEmpty()) {
                    Text(stringResource(R.string.market_seller_money_nothing_owed), style = SType.small, color = c.muted)
                } else {
                    MoneyList(awaiting, paid = false, modifier = Modifier.rise(stagger(1)))
                }

                Text(stringResource(R.string.market_seller_received), style = SType.section, color = c.fg, modifier = Modifier.padding(top = 4.dp))
                if (book.received.isEmpty()) {
                    Text(stringResource(R.string.market_seller_money_received_empty), style = SType.small, color = c.muted)
                } else {
                    MoneyList(book.received, paid = true, modifier = Modifier.rise(stagger(2)))
                }
            }
        }
    }
}

@Composable
private fun MoneyList(orders: List<SellerOrder>, paid: Boolean, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(modifier.fillMaxWidth().card(radius = 22.dp)) {
        orders.forEachIndexed { index, seller ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .bottomRule(c.border, show = index < orders.lastIndex)
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                IconWell(
                    if (paid) Lucide.check else Lucide.clock,
                    well = if (paid) c.successSoft else c.warningSoft,
                    ink = if (paid) c.success else c.warning,
                    size = 36.dp,
                    radius = 12.dp,
                    iconSize = 16.dp,
                )
                Column(Modifier.weight(1f)) {
                    Text(seller.order.fleetName ?: stringResource(R.string.market_seller_a_fleet), style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        listOfNotNull(seller.order.what, clockOf(seller.order.pickupAt)).joinToString(" · "),
                        style = SType.caption,
                        color = c.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(seller.amount?.let(::rupees) ?: "—", style = SType.bodyStrong, color = c.fg)
            }
        }
    }
}
