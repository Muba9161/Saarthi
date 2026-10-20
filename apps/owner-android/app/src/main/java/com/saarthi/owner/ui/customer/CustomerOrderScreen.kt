package com.saarthi.owner.ui.customer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.HandoverApi
import com.saarthi.owner.network.OrdersApi
import com.saarthi.owner.network.OrdersApi.Companion.STAGE_30_REQUIRED
import com.saarthi.owner.network.OrdersApi.Companion.STAGE_70_REQUIRED
import com.saarthi.owner.network.OrdersApi.Companion.STAGE_PROCUREMENT_PAID
import com.saarthi.owner.network.PaymentsApi
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.Brand
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SaarthiField
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.brandGradient
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.orders.CustomerCodeCard
import com.saarthi.owner.ui.orders.orderStatusLook
import com.saarthi.owner.ui.papers.SlipKind
import com.saarthi.owner.ui.papers.SlipStep
import com.saarthi.owner.ui.papers.WeighSlipText
import com.saarthi.owner.ui.papers.rememberSlipReader
import com.saarthi.owner.ui.payments.PaymentOutcome
import com.saarthi.owner.ui.payments.ReceiptsCard
import com.saarthi.owner.ui.payments.rememberCheckout
import com.saarthi.owner.ui.payments.sentence
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val REFRESH_MS = 20_000L

/**
 * One order from the customer's side — the design's Confirm & pay and
 * Track boards in one place, following the order through its life.
 *
 * Pay 30% and the order is confirmed; follow the vehicle along its road on
 * the map; say what arrived; pay the 70% balance. Only the fleet is ever
 * named — the customer deals with nobody else.
 */
@Composable
fun CustomerOrderScreen(app: OwnerApp, initial: OrdersApi.Order, onChanged: () -> Unit) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    val checkout = rememberCheckout()
    var order by remember { mutableStateOf(initial) }
    var finance by remember { mutableStateOf<OrdersApi.Finance?>(null) }
    var trip by remember { mutableStateOf<TripsApi.Trip?>(null) }
    var tripError by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var arrivedText by remember { mutableStateOf(initial.quantity?.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() }.orEmpty()) }

    var receipts by remember { mutableStateOf<List<PaymentsApi.Receipt>>(emptyList()) }
    var handover by remember { mutableStateOf<HandoverApi.Handover?>(null) }

    LaunchedEffect(initial.id, reload) {
        while (true) {
            runCatching { app.orders.get(initial.id) }.getOrNull()?.let { order = it }
            finance = runCatching { app.orders.finance(initial.id) }.getOrNull()
            // A receipt for each payment that went through, fetched again only when another does.
            val settled = finance?.payments?.count { it.status == "SUCCEEDED" } ?: 0
            if (settled != receipts.size) {
                receipts = runCatching { app.payments.receipts(orderId = initial.id) }.getOrDefault(receipts)
            }
            // A failed read keeps the last trip on the map and says so only when there is none.
            order.tripId?.let { id ->
                runCatching { app.trips.get(id) }
                    .onSuccess { trip = it ?: trip; tripError = null }
                    .onFailure { if (it is CancellationException) throw it else tripError = it.readable() }
            }
            // The delivery code exists once the goods set off.
            if (order.tripId != null) handover = runCatching { app.handover.forOrder(initial.id) }.getOrNull() ?: handover
            delay(REFRESH_MS)
        }
    }

    val stage = finance?.stage
    val payNow: Double? = when (stage) {
        STAGE_30_REQUIRED -> finance?.confirmationAmount
        // Never "Pay ₹0": a balance the delivered quantity has already covered needs nothing.
        STAGE_70_REQUIRED -> finance?.balanceDue?.takeIf { it > 0 }
        else -> null
    }
    // The web's rule exactly: only a marketplace order whose seller has been paid
    // takes the delivered quantity. A freight-only order has no finance plan at
    // all, and the server refuses the step anywhere else.
    val awaitingDeliveryWord = order.status == "DELIVERED" && stage == STAGE_PROCUREMENT_PAID
    // A load sold by weight is read off the weighbridge slip, in the order's own unit.
    val weighed = order.unit == "TON" || order.unit == "KG"
    val weighSlip = rememberSlipReader(WeighSlipText::netKg, null, onProblem = { message = it to NoticeTone.DANGER }) { kg ->
        kg?.let { arrivedText = weightIn(it, order.unit).take(8) }
    }

    fun pay() {
        busy = true
        message = null
        scope.launch {
            try {
                val session = if (stage == STAGE_30_REQUIRED) app.orders.payConfirmation(order.id) else app.orders.payFinal(order.id)
                checkout.pay(session) { outcome ->
                    busy = false
                    message = outcome.sentence(Words.get(if (stage == STAGE_30_REQUIRED) R.string.customer_order_confirmed_paid else R.string.customer_order_balance_paid)) to
                        if (outcome == PaymentOutcome.SUCCEEDED) NoticeTone.SUCCESS else NoticeTone.WARNING
                    onChanged()
                    reload++
                }
            } catch (failure: Exception) {
                busy = false
                message = failure.readable() to NoticeTone.DANGER
            }
        }
    }

    fun confirmArrived() {
        val quantity = arrivedText.toDoubleOrNull() ?: return
        busy = true
        message = null
        scope.launch {
            try {
                app.orders.confirmDelivery(order.id, quantity, null)
                busy = false
                onChanged()
                reload++
            } catch (failure: Exception) {
                busy = false
                message = failure.readable() to NoticeTone.DANGER
            }
        }
    }

    DetailScreen(
        eyebrow = listOfNotNull(stringResource(R.string.customer_order_eyebrow, order.reference), order.fleetName).joinToString(" · "),
        title = stringResource(if (stage == STAGE_30_REQUIRED) R.string.customer_order_confirm_pay else R.string.customer_your_order),
        footer = when {
            payNow != null -> {
                {
                    SaarthiButton(
                        stringResource(R.string.customer_pay_amount, rupees(payNow)),
                        onClick = ::pay,
                        busy = busy || checkout.confirming,
                        busyText = stringResource(R.string.customer_opening_payment),
                        leading = Lucide.lock,
                    )
                    Text(
                        stringResource(R.string.customer_payments_by_cashfree),
                        style = SType.caption,
                        color = c.subtle,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            awaitingDeliveryWord -> {
                {
                    SaarthiButton(stringResource(R.string.customer_order_confirm_arrived), onClick = ::confirmArrived, busy = busy, enabled = (arrivedText.toDoubleOrNull() ?: 0.0) > 0)
                }
            }
            else -> null
        },
    ) {
        if (payNow != null && finance != null) {
            PayPanel(order, finance!!, stage == STAGE_30_REQUIRED, Modifier.rise())
        }
        message?.let { (text, tone) -> RevealedNotice(text, tone) }

        if (order.status == "CANCELLED" || order.status == "FAILED") {
            NoticeCard(
                order.cancellationReason?.ifBlank { null }?.let { stringResource(R.string.customer_order_cancelled_reason, it) }
                    ?: stringResource(R.string.customer_order_cancelled),
                NoticeTone.DANGER,
                icon = Lucide.ban,
                modifier = Modifier.rise(),
            )
        }

        OrderSummary(order, finance, Modifier.rise(stagger(1)))

        handover?.let { CustomerCodeCard(it, Modifier.rise(stagger(1))) }

        OrderRouteCard(order, trip, tripError, Modifier.rise(stagger(1)))

        if (awaitingDeliveryWord) {
            Column(Modifier.fillMaxWidth().card(radius = 22.dp).padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.customer_order_what_arrived), style = SType.cardTitle, color = c.fg)
                Text(
                    stringResource(R.string.customer_order_balance_note),
                    style = SType.small,
                    color = c.muted,
                )
                if (weighed) SlipStep(weighSlip, SlipKind.WEIGH_SLIP, good = { it != null })
                SaarthiField(
                    value = arrivedText,
                    onValueChange = { arrivedText = it.filter { ch -> ch.isDigit() || ch == '.' }.take(8) },
                    label = stringResource(R.string.customer_order_quantity_delivered, com.saarthi.owner.network.RequirementsApi.unitWord(order.unit)),
                    leading = Lucide.box,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
            }
        }

        // A delivered order is rated once, by the customer — and it counts towards the driver's score.
        if (order.status == "DELIVERED" || order.status == "COMPLETED") {
            val given = order.rating
            if (given == null) {
                RateCard(
                    title = stringResource(R.string.customer_order_rate_title),
                    prompt = stringResource(R.string.customer_order_rate_prompt),
                    maxWords = 1000,
                    onRate = { stars, words ->
                        app.orders.rate(order.id, stars, words)
                        app.orders.get(order.id)?.let { order = it }
                        onChanged()
                    },
                    modifier = Modifier.rise(stagger(2)),
                )
            } else {
                RatedLine(stringResource(R.string.customer_order_rated, given.rating), given.rating, given.comment, Modifier.rise(stagger(2)))
            }
        }

        OrderVehicleCard(order, trip, Modifier.rise(stagger(2)))

        Timeline(order, finance, trip, Modifier.rise(stagger(2)))

        OrderDetailsCard(order, finance, Modifier.rise(stagger(3)))

        ReceiptsCard(receipts, forWhat = order.what, modifier = Modifier.rise(stagger(3))) { receipt ->
            when (finance?.payments?.firstOrNull { it.reference == receipt.reference }?.stage) {
                "CONFIRMATION_30" -> Words.get(R.string.customer_order_receipt_advance, ADVANCE_PERCENT)
                "FINAL_70" -> Words.get(R.string.customer_order_balance_after_delivery)
                else -> Words.get(R.string.customer_payment)
            }
        }
    }
}

/** The amount due now, against the whole price. */
@Composable
private fun PayPanel(order: OrdersApi.Order, finance: OrdersApi.Finance, advance: Boolean, modifier: Modifier = Modifier) {
    val total = finance.finalAmount ?: finance.agreedAmount ?: order.totalPrice ?: 0.0
    val now = if (advance) finance.confirmationAmount ?: 0.0 else finance.balanceDue ?: 0.0
    val share = if (total > 0) (now / total).toFloat().coerceIn(0f, 1f) else 0.3f
    Column(
        modifier
            .fillMaxWidth()
            .shadow(16.dp, RoundedCornerShape(28.dp), spotColor = Color(0xBF021D40), ambientColor = Color.Transparent)
            .brandGradient(RoundedCornerShape(28.dp))
            .padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Eyebrow(
            if (advance) stringResource(R.string.customer_order_pay_now_advance, ADVANCE_PERCENT) else stringResource(R.string.customer_order_balance_after_delivery),
            color = Color.White.copy(alpha = 0.78f),
        )
        Text(rupees(now), style = SType.figure.copy(fontSize = 44.sp, lineHeight = 48.sp), color = Color.White)
        Text(stringResource(R.string.customer_order_of_total, rupees(total), order.what), style = SType.small, color = Color.White.copy(alpha = 0.85f))
        Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.weight(share.coerceAtLeast(0.05f)).height(6.dp).clip(CircleShape).background(Brand.saffron))
            Box(Modifier.weight((1f - share).coerceAtLeast(0.05f)).height(6.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.3f)))
        }
        Row(Modifier.fillMaxWidth()) {
            Text(
                if (advance) stringResource(R.string.customer_order_advance_now, ADVANCE_PERCENT) else stringResource(R.string.customer_order_balance_now),
                style = SType.captionStrong,
                color = Color.White,
                modifier = Modifier.weight(1f),
            )
            if (advance) Text(stringResource(R.string.customer_order_after_delivery, rupees(total - now)), style = SType.caption, color = Color.White.copy(alpha = 0.8f))
        }
    }
}

/** What was ordered, between where, for how much, and which fleet has it. */
@Composable
private fun OrderSummary(order: OrdersApi.Order, finance: OrdersApi.Finance?, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val look = orderStatusLook(order.status)
    val price = finance?.agreedAmount ?: order.totalPrice
    Column(modifier.fillMaxWidth().card(radius = 22.dp).padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(order.what, style = SType.cardTitle, color = c.fg, modifier = Modifier.weight(1f))
            StatusPill(look.word, background = look.ground, ink = look.ink)
        }
        listOfNotNull(order.originAddress?.substringBefore(','), order.destinationAddress?.substringBefore(','))
            .distinct()
            .takeIf { it.isNotEmpty() }
            ?.let { Text(it.joinToString(" → "), style = SType.small, color = c.muted) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                order.fleetName ?: stringResource(R.string.customer_order_no_fleet),
                style = SType.small,
                color = if (order.fleetName != null) c.fg else c.muted,
                modifier = Modifier.weight(1f),
            )
            price?.let { Text(rupees(it), style = SType.bodyStrong, color = c.fg) }
        }
    }
}

/** Where the order stands, step by step, with the trip's own times where it has them. */
@Composable
private fun Timeline(order: OrdersApi.Order, finance: OrdersApi.Finance?, trip: TripsApi.Trip?, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val stage = finance?.stage
    // An order with no payment plan in the app was confirmed when it was placed.
    val paid30 = if (finance == null) order.status !in setOf("DRAFT", "REQUESTED", "QUOTED") else stage != STAGE_30_REQUIRED
    val loaded = order.status in setOf("IN_TRANSIT", "DELIVERED", "COMPLETED")
    val moving = order.status == "IN_TRANSIT"
    val delivered = order.status in setOf("DELIVERED", "COMPLETED")
    val steps = buildList {
        add(
            Triple(
                if (finance == null) stringResource(R.string.customer_status_confirmed) else stringResource(R.string.customer_order_step_confirmed_paid, ADVANCE_PERCENT),
                finance?.confirmationAmount?.let { rupees(it) },
                paid30,
            ),
        )
        add(
            Triple(
                // A freight order carries the customer's own goods, not material bought through Saarthi.
                stringResource(if (order.materialName != null) R.string.customer_order_step_material_loaded else R.string.customer_order_step_loaded),
                clockOf(trip?.actualStartAt)?.let { stringResource(R.string.customer_order_left_pickup_at, it) }
                    ?: clockOf(order.pickupAt)?.let { if (loaded) it else stringResource(R.string.customer_order_planned_for, it) },
                loaded,
            ),
        )
        add(
            Triple(
                stringResource(R.string.customer_order_step_on_the_way),
                clockOf(trip?.etaAt)?.takeIf { moving && trip?.underway == true }?.let { stringResource(R.string.customer_order_arriving_about, it) },
                moving || delivered,
            ),
        )
        add(
            Triple(
                if (finance == null) stringResource(R.string.customer_order_step_delivered) else stringResource(R.string.customer_order_step_delivered_pay, BALANCE_PERCENT),
                listOfNotNull(
                    clockOf(trip?.actualArrivalAt)?.takeIf { delivered }?.let { stringResource(R.string.customer_arrived_at, it) },
                    finance?.balanceDue?.takeIf { it > 0 }?.let { stringResource(R.string.customer_order_balance_once_confirmed, rupees(it)) },
                ).joinToString(" · ").ifBlank { null },
                delivered,
            ),
        )
    }
    Column(modifier.fillMaxWidth().card(radius = 22.dp).padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        steps.forEach { (title, note, done) ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(
                    Modifier
                        .padding(top = 3.dp)
                        .size(14.dp)
                        .clip(CircleShape)
                        .background(if (done) c.success else c.track),
                )
                Column(Modifier.weight(1f)) {
                    Text(title, style = SType.bodyStrong, color = if (done) c.fg else c.muted)
                    note?.let { Text(it, style = SType.caption, color = c.muted) }
                }
            }
        }
    }
}

/** A weighed load in the order's unit — tonnes to three places, kilograms whole. */
private fun weightIn(kg: Double, unit: String?): String =
    if (unit == "TON") java.math.BigDecimal(kg / 1000).setScale(3, java.math.RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
    else kg.toLong().toString()
