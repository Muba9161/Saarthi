package com.saarthi.owner.ui.customer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.HandoverApi
import com.saarthi.owner.network.PaymentsApi
import com.saarthi.owner.network.TravelApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.dial
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.Avatar
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.NotesField
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.orders.CustomerCodeCard
import com.saarthi.owner.ui.payments.PaymentOutcome
import com.saarthi.owner.ui.payments.ReceiptsCard
import com.saarthi.owner.ui.payments.rememberCheckout
import com.saarthi.owner.ui.payments.sentence
import com.saarthi.owner.ui.travel.BookingHero
import com.saarthi.owner.ui.travel.BookingRouteCard
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A booking's state in the customer's words. */
@Composable
internal fun customerBookingLook(status: String): Triple<String, Color, Color> {
    val c = Saarthi.colors
    return when (status) {
        "PENDING_PAYMENT" -> Triple(stringResource(R.string.customer_status_pay_to_book), c.warningBg, c.warning)
        "AWAITING_CONFIRMATION" -> Triple(stringResource(R.string.customer_status_being_confirmed), c.primaryWash, c.primary)
        "CONFIRMED" -> Triple(stringResource(R.string.customer_status_confirmed), c.successBg, c.success)
        "IN_PROGRESS" -> Triple(stringResource(R.string.customer_status_on_the_way), c.successBg, c.success)
        "COMPLETED" -> Triple(stringResource(R.string.customer_status_completed), c.sunken, c.muted)
        "DECLINED" -> Triple(stringResource(R.string.customer_status_declined), c.dangerBg, c.danger)
        "CANCELLED", "REFUNDED" -> Triple(stringResource(R.string.customer_status_cancelled), c.dangerBg, c.danger)
        else -> Triple(status.lowercase().replace('_', ' '), c.sunken, c.muted)
    }
}

/**
 * A cab or tour booking, from the customer's side: pay for it to hold the
 * vehicle, see who is coming once the operator confirms, or cancel it.
 */
@Composable
fun CustomerBookingScreen(app: OwnerApp, initial: TravelApi.Booking, onChanged: () -> Unit) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val checkout = rememberCheckout()
    var booking by remember { mutableStateOf(initial) }
    var reload by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var cancelling by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }
    var receipts by remember { mutableStateOf<List<PaymentsApi.Receipt>>(emptyList()) }
    var handover by remember { mutableStateOf<HandoverApi.Handover?>(null) }

    // Re-read while the screen is open, so the customer sees the operator
    // confirm and the ride start without leaving it.
    LaunchedEffect(initial.id, reload) {
        while (true) {
            runCatching { app.travel.get(initial.id) }.getOrNull()?.let { booking = it }
            // Nothing to print until something is paid.
            if (booking.status != "PENDING_PAYMENT" && receipts.isEmpty()) {
                receipts = runCatching { app.payments.receipts(bookingId = initial.id) }.getOrDefault(emptyList())
            }
            // The pickup code exists once the operator confirms.
            if (booking.status in setOf("CONFIRMED", "IN_PROGRESS", "COMPLETED")) {
                handover = runCatching { app.handover.forBooking(initial.id) }.getOrNull() ?: handover
            }
            if (!booking.open) break
            delay(REFRESH_MS)
        }
    }

    fun pay() {
        busy = true
        message = null
        scope.launch {
            try {
                val session = app.travel.pay(booking.id)
                if (session == null) {
                    // Paid already — a checkout opened earlier went through.
                    busy = false
                    reload++
                    onChanged()
                    return@launch
                }
                checkout.pay(session) { outcome ->
                    busy = false
                    message = outcome.sentence(Words.get(R.string.customer_booking_paid)) to
                        if (outcome == PaymentOutcome.SUCCEEDED) NoticeTone.SUCCESS else NoticeTone.WARNING
                    reload++
                    onChanged()
                }
            } catch (failure: Exception) {
                busy = false
                message = failure.readable() to NoticeTone.DANGER
            }
        }
    }

    fun cancel() {
        cancelling = false
        busy = true
        message = null
        scope.launch {
            try {
                app.travel.cancel(booking.id, reason.trim())?.let { booking = it }
                message = Words.get(R.string.customer_booking_cancelled_told) to NoticeTone.SUCCESS
                onChanged()
            } catch (failure: Exception) {
                message = failure.readable() to NoticeTone.DANGER
            }
            busy = false
        }
    }

    val due = booking.status == "PENDING_PAYMENT"
    DetailScreen(
        eyebrow = stringResource(R.string.customer_booking_eyebrow, booking.reference),
        title = booking.title,
        footer = if (due) {
            {
                SaarthiButton(
                    booking.totalAmount?.let { stringResource(R.string.customer_pay_amount, rupees(it)) } ?: stringResource(R.string.customer_pay),
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
        } else {
            null
        },
    ) {
        BookingHero(booking, customerBookingLook(booking.status).first, Modifier.rise())

        handover?.let { CustomerCodeCard(it, Modifier.rise(stagger(1))) }

        message?.let { (text, tone) -> RevealedNotice(text, tone) }
        booking.declineReason?.takeIf { booking.status == "DECLINED" }?.let {
            RevealedNotice(stringResource(R.string.customer_booking_declined_reason, it), NoticeTone.WARNING)
        }

        // A finished trip is rated once, by the customer who booked it.
        if (booking.status == "COMPLETED") {
            val given = booking.rating
            if (given == null) {
                RateCard(
                    title = stringResource(R.string.customer_booking_rate_title),
                    prompt = stringResource(R.string.customer_booking_rate_prompt),
                    maxWords = 2000,
                    onRate = { stars, words ->
                        app.travelPackages.rate(booking.id, stars, words)?.let { booking = it }
                        onChanged()
                    },
                    modifier = Modifier.rise(stagger(1)),
                )
            } else {
                RatedLine(stringResource(R.string.customer_booking_rated, given.toInt()), given.toInt(), comment = null, modifier = Modifier.rise(stagger(1)))
            }
        }

        Row(
            Modifier.fillMaxWidth().rise(stagger(1)).card(radius = 22.dp).padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            val operator = booking.providerName ?: stringResource(R.string.customer_the_operator)
            Avatar(operator, size = 44.dp, background = c.primarySoft, ink = c.primary)
            Column(Modifier.weight(1f)) {
                Text(operator, style = SType.bodyStrong, color = c.fg)
                Text(
                    stringResource(if (booking.providerPhone != null) R.string.customer_booking_call_about else R.string.customer_booking_number_after_confirm),
                    style = SType.caption,
                    color = c.muted,
                )
            }
            booking.providerPhone?.let { phone ->
                CircleButton(Lucide.phone, stringResource(R.string.customer_call, operator), { context.dial(phone) }, size = 44.dp, iconSize = 18.dp)
            }
        }

        BookingRouteCard(booking, Modifier.rise(stagger(2)))

        Row(
            Modifier.fillMaxWidth().rise(stagger(3)).card(radius = 22.dp).padding(18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.customer_payment), style = SType.cardTitle, color = c.fg)
                Text(
                    when {
                        due -> stringResource(R.string.customer_booking_pay_to_hold)
                        booking.paymentStatus == "SUCCEEDED" -> stringResource(R.string.customer_paid)
                        booking.paymentStatus == "REFUNDED" || booking.status == "REFUNDED" -> stringResource(R.string.customer_refunded)
                        else -> stringResource(R.string.customer_not_paid)
                    },
                    style = SType.caption,
                    color = c.muted,
                )
            }
            Text(booking.totalAmount?.let(::rupees) ?: "—", style = SType.headerTitle, color = c.fg)
        }

        ReceiptsCard(receipts, forWhat = booking.title, modifier = Modifier.rise(stagger(4))) { Words.get(R.string.customer_booking_payment) }

        if (booking.status in TravelApi.CANCELLABLE) {
            LinkButton(
                stringResource(R.string.customer_booking_cancel_link),
                onClick = { cancelling = true },
                color = c.danger,
                enabled = !busy,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
        }
    }

    BottomSheet(visible = cancelling, onDismiss = { cancelling = false }) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(stringResource(R.string.customer_booking_cancel_title), style = SType.sheetTitle, color = c.fg)
            Text(
                stringResource(if (booking.paymentStatus == "SUCCEEDED") R.string.customer_booking_cancel_note_paid else R.string.customer_booking_cancel_note),
                style = SType.body,
                color = c.muted,
            )
            NotesField(reason, { reason = it.take(500) }, label = stringResource(R.string.customer_booking_cancel_reason), minHeight = 80.dp)
            SaarthiButton(stringResource(R.string.customer_booking_cancel), onClick = ::cancel, tone = ButtonTone.DANGER_OUTLINE, enabled = reason.trim().length >= 3 && !busy)
        }
    }
}

private const val REFRESH_MS = 15_000L
