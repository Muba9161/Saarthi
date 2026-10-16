package com.saarthi.owner.ui.orders

import com.saarthi.owner.data.OPERATOR_OWNER_ROLES
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.HandoverApi
import com.saarthi.owner.network.OrdersApi
import com.saarthi.owner.network.OrdersApi.Companion.STAGE_30_PAID
import com.saarthi.owner.network.OrdersApi.Companion.STAGE_30_REQUIRED
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rememberPhoto
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.fleet.RouteStops
import com.saarthi.owner.ui.payments.PaymentOutcome
import com.saarthi.owner.ui.payments.rememberCheckout
import com.saarthi.owner.ui.payments.sentence
import kotlinx.coroutines.launch

/**
 * "Buy & dispatch" — a won material order, from the fleet's side.
 *
 * The customer's 30% comes to the fleet; the fleet pays the seller from it,
 * the seller loads only once paid, and the fleet's own truck collects and
 * delivers. The seller and the customer never deal with each other.
 */
@Composable
fun FleetOrderScreen(app: OwnerApp, initial: OrdersApi.Order) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    val checkout = rememberCheckout()
    var order by remember { mutableStateOf(initial) }
    var finance by remember { mutableStateOf<OrdersApi.Finance?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var handovers by remember { mutableStateOf<List<HandoverApi.Handover>>(emptyList()) }
    var overriding by remember { mutableStateOf<String?>(null) }
    var overrideBusy by remember { mutableStateOf(false) }
    var overrideError by remember { mutableStateOf<String?>(null) }
    val canOverride = app.session.account.value?.membershipRole in OPERATOR_OWNER_ROLES

    LaunchedEffect(initial.id, reload) {
        runCatching { app.orders.get(initial.id) }.getOrNull()?.let { order = it }
        finance = runCatching { app.orders.finance(initial.id) }.getOrNull()
        handovers = order.tripId?.let { trip -> runCatching { app.handover.forTrip(trip) }.getOrNull() }.orEmpty()
    }

    /** The owner confirms the delivery without the customer's code — reason on record. */
    fun overrideDelivery(reason: String) {
        val tripId = order.tripId ?: return
        overrideBusy = true
        overrideError = null
        scope.launch {
            try {
                app.handover.override(tripId, overriding ?: HandoverApi.DELIVERY, reason)
                overriding = null
                message = "Confirmed without the code. The reason is on record and the customer has been told." to NoticeTone.SUCCESS
                reload++
            } catch (failure: Exception) {
                overrideError = failure.readable()
            }
            overrideBusy = false
        }
    }

    val stage = finance?.stage
    val sellerCost = finance?.provider?.procurementAmount ?: finance?.provider?.procurementReference ?: order.materialPrice
    val canPaySeller = stage == STAGE_30_PAID && sellerCost != null

    fun paySeller() {
        busy = true
        message = null
        scope.launch {
            try {
                val session = app.orders.payProcurement(order.id)
                checkout.pay(session) { outcome ->
                    busy = false
                    message = outcome.sentence("Seller paid") to if (outcome == PaymentOutcome.SUCCEEDED) NoticeTone.SUCCESS else NoticeTone.WARNING
                    reload++
                }
            } catch (failure: Exception) {
                busy = false
                message = failure.readable() to NoticeTone.DANGER
            }
        }
    }

    DetailScreen(
        eyebrow = "Order ${order.reference}",
        title = "Buy & dispatch",
        eyebrowColor = c.success,
        footer = if (canPaySeller) {
            {
                SaarthiButton(
                    "Pay ${rupees(sellerCost ?: 0.0)} to the seller",
                    onClick = ::paySeller,
                    busy = busy || checkout.confirming,
                    busyText = "Opening payment…",
                    leading = Lucide.lock,
                )
                Text(
                    "Paid through Cashfree. The seller loads only after it's paid.",
                    style = SType.caption,
                    color = c.subtle,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        } else {
            null
        },
    ) {
        if (finance != null) CustomerPaidBanner(order, finance, Modifier.rise())

        message?.let { (text, tone) -> RevealedNotice(text, tone) }

        Step(
            number = 1,
            // An order from before the 30/70 plan has nothing to pay here — only who supplies it.
            title = if (stage == null) "Material from the seller" else "Pay the seller",
            badge = when (stage) {
                STAGE_30_REQUIRED -> "Waiting for 30%"
                STAGE_30_PAID -> "Due now"
                null -> null
                else -> "Paid"
            },
            badgeTone = if (stage == STAGE_30_PAID) NoticeTone.WARNING else if (stage == STAGE_30_REQUIRED) NoticeTone.INFO else NoticeTone.SUCCESS,
            modifier = Modifier.rise(stagger(1)),
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(c.sunken)
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(order.supplierName ?: "The seller", style = SType.bodyStrong, color = c.fg, maxLines = 2)
                    Text(order.what, style = SType.caption, color = c.muted)
                }
                sellerCost?.let { Text(rupees(it), style = SType.bodyStrong, color = c.fg) }
            }
        }

        Step(
            number = 2,
            title = "Send a truck to load",
            badge = order.assignedTruck?.let { "Assigned" },
            badgeTone = NoticeTone.SUCCESS,
            modifier = Modifier.rise(stagger(2)),
        ) {
            order.assignedTruck?.let { truck ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    val photo = rememberPhoto(R.drawable.vehicle_tipper)
                    if (photo != null) {
                        Image(photo, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.size(width = 70.dp, height = 40.dp))
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        PlateChip(truck.registrationNumber, size = 12.sp)
                        order.assignedDriver?.name?.ifBlank { null }?.let {
                            Text(it, style = SType.caption, color = c.muted)
                        }
                    }
                }
            } ?: Text("The truck named in your bid goes here once the order is confirmed.", style = SType.small, color = c.muted)
            RouteStops(
                from = order.originAddress ?: "Seller's yard",
                fromNote = clockOf(order.pickupAt)?.let { "Load by $it" },
                to = order.destinationAddress ?: "Customer's site",
                toNote = clockOf(order.deliverBy)?.let { "Deliver by $it" },
            )
        }

        handovers.forEach { handover ->
            FleetHandoverCard(
                handover,
                canOverride = canOverride,
                onOverride = {
                    overrideError = null
                    overriding = handover.purpose
                },
                modifier = Modifier.rise(stagger(2)),
            )
        }

        finance?.provider?.let { money ->
            Column(
                Modifier
                    .fillMaxWidth()
                    .rise(stagger(3))
                    .card(radius = 22.dp)
                    .padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Eyebrow(if (money.final) "Your earnings" else "Your earnings · estimate")
                MoneyLine("Agreed with the customer", finance?.agreedAmount)
                MoneyLine("Paid to the seller", money.procurementAmount ?: money.procurementReference)
                MoneyLine("Saarthi commission (${(money.commissionRate * 100).let { if (it % 1.0 == 0.0) it.toInt().toString() else "%.1f".format(it) }}%)", money.commissionAmount)
                MoneyLine("You keep", money.netAfterCommission, strong = true)
            }
        }
    }

    OverrideHandoverSheet(
        purpose = overriding,
        busy = overrideBusy,
        error = overrideError,
        onConfirm = ::overrideDelivery,
        onDismiss = { overriding = null },
    )
}

@Composable
private fun CustomerPaidBanner(order: OrdersApi.Order, finance: OrdersApi.Finance?, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val paid = finance != null && finance.stage != STAGE_30_REQUIRED
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(if (paid) c.successWash else c.warningWash)
            .border(1.dp, if (paid) c.successGlow else c.warningRing, RoundedCornerShape(20.dp))
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconWell(if (paid) Lucide.check else Lucide.clock, well = if (paid) c.successSoft else c.warningSoft, ink = if (paid) c.success else c.warning, size = 36.dp, shape = CircleShape, iconSize = 16.dp)
        Column(Modifier.weight(1f)) {
            Text(
                if (paid) "${order.customerName ?: "The customer"} paid 30%" else "Waiting for ${order.customerName ?: "the customer"}'s 30%",
                style = SType.bodyStrong,
                color = c.fg,
            )
            val received = finance?.confirmationAmount
            val after = finance?.agreedAmount?.let { agreed -> received?.let { agreed - it } }
            Text(
                listOfNotNull(received?.let { "${rupees(it)} ${if (paid) "received" else "due"}" }, after?.let { "${rupees(it)} after delivery" }).joinToString(" · "),
                style = SType.caption,
                color = c.muted,
            )
        }
    }
}

@Composable
private fun Step(
    number: Int,
    title: String,
    badge: String?,
    badgeTone: NoticeTone,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val c = Saarthi.colors
    val (ground, ink) = when (badgeTone) {
        NoticeTone.WARNING -> c.warningBg to c.warning
        NoticeTone.SUCCESS -> c.successBg to c.success
        NoticeTone.DANGER -> c.dangerBg to c.danger
        NoticeTone.INFO -> c.primaryWash to c.primary
    }
    Column(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier
                    .size(28.dp)
                    .clip(CircleShape)
                    .background(c.primary),
                contentAlignment = Alignment.Center,
            ) {
                Text(number.toString(), style = SType.smallStrong, color = c.onPrimary)
            }
            Text(title, style = SType.cardTitle, color = c.fg, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            badge?.let {
                Box(
                    Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(ground)
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                ) {
                    Text(it, style = SType.captionStrong, color = ink)
                }
            }
        }
        content()
    }
}

@Composable
private fun MoneyLine(label: String, amount: Double?, strong: Boolean = false) {
    val c = Saarthi.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = if (strong) SType.bodyStrong else SType.small, color = if (strong) c.fg else c.muted, modifier = Modifier.weight(1f))
        Text(amount?.let(::rupees) ?: "—", style = if (strong) SType.bodyStrong else SType.smallStrong, color = c.fg)
    }
}
