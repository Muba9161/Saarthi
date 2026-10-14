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
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.network.HandoverApi
import com.saarthi.owner.network.PaymentsApi
import com.saarthi.owner.network.TravelApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.RevealedNotice
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
        "PENDING_PAYMENT" -> Triple("Pay to book", c.warningBg, c.warning)
        "AWAITING_CONFIRMATION" -> Triple("Being confirmed", c.primaryWash, c.primary)
        "CONFIRMED" -> Triple("Confirmed", c.successBg, c.success)
        "IN_PROGRESS" -> Triple("On the way", c.successBg, c.success)
        "COMPLETED" -> Triple("Completed", c.sunken, c.muted)
        "DECLINED" -> Triple("Declined", c.dangerBg, c.danger)
        "CANCELLED", "REFUNDED" -> Triple("Cancelled", c.dangerBg, c.danger)
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
                    message = outcome.sentence("Booking paid") to
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
                message = "Cancelled. The operator has been told." to NoticeTone.SUCCESS
                onChanged()
            } catch (failure: Exception) {
                message = failure.readable() to NoticeTone.DANGER
            }
            busy = false
        }
    }

    val due = booking.status == "PENDING_PAYMENT"
    DetailScreen(
        eyebrow = "Booking ${booking.reference}",
        title = booking.title,
        footer = if (due) {
            {
                SaarthiButton(
                    "Pay ${booking.totalAmount?.let(::rupees).orEmpty()}".trim(),
                    onClick = ::pay,
                    busy = busy || checkout.confirming,
                    busyText = "Opening payment…",
                    leading = Lucide.lock,
                )
                Text(
                    "Payments are processed securely by Cashfree.",
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
            RevealedNotice("The operator could not take it: $it", NoticeTone.WARNING)
        }

        Row(
            Modifier.fillMaxWidth().rise(stagger(1)).card(radius = 22.dp).padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            val operator = booking.providerName ?: "The operator"
            Avatar(operator, size = 44.dp, background = c.primarySoft, ink = c.primary)
            Column(Modifier.weight(1f)) {
                Text(operator, style = SType.bodyStrong, color = c.fg)
                Text(
                    if (booking.providerPhone != null) "Call them about the trip" else "Their number shows once they confirm",
                    style = SType.caption,
                    color = c.muted,
                )
            }
            booking.providerPhone?.let { phone ->
                CircleButton(Lucide.phone, "Call $operator", { context.dial(phone) }, size = 44.dp, iconSize = 18.dp)
            }
        }

        BookingRouteCard(booking, Modifier.rise(stagger(2)))

        Row(
            Modifier.fillMaxWidth().rise(stagger(3)).card(radius = 22.dp).padding(18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Payment", style = SType.cardTitle, color = c.fg)
                Text(
                    when {
                        due -> "Pay to have the operator hold a vehicle for you"
                        booking.paymentStatus == "SUCCEEDED" -> "Paid"
                        booking.paymentStatus == "REFUNDED" || booking.status == "REFUNDED" -> "Refunded"
                        else -> "Not paid"
                    },
                    style = SType.caption,
                    color = c.muted,
                )
            }
            Text(booking.totalAmount?.let(::rupees) ?: "—", style = SType.headerTitle, color = c.fg)
        }

        ReceiptsCard(receipts, forWhat = booking.title, modifier = Modifier.rise(stagger(4))) { "Booking payment" }

        if (booking.status in TravelApi.CANCELLABLE) {
            LinkButton(
                "Cancel this booking",
                onClick = { cancelling = true },
                color = c.danger,
                enabled = !busy,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
        }
    }

    BottomSheet(visible = cancelling, onDismiss = { cancelling = false }) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Cancel this booking?", style = SType.sheetTitle, color = c.fg)
            Text(
                if (booking.paymentStatus == "SUCCEEDED") "The operator is told why. A refund follows the cancellation terms." else "The operator is told why.",
                style = SType.body,
                color = c.muted,
            )
            NotesField(reason, { reason = it.take(500) }, label = "Why are you cancelling?", minHeight = 80.dp)
            SaarthiButton("Cancel booking", onClick = ::cancel, tone = ButtonTone.DANGER_OUTLINE, enabled = reason.trim().length >= 3 && !busy)
        }
    }
}

private const val REFRESH_MS = 15_000L
