package com.saarthi.owner.ui.customer

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
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
import com.saarthi.owner.network.RequirementsApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rememberPhoto
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.Avatar
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NotesField
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.jobs.Pill
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.launch

/** The share of a delivered price paid up front to confirm. */
private const val ADVANCE_SHARE = 0.30

/**
 * The bids on one request — the design's Customer · Bids.
 *
 * Each price is one delivered price from one fleet; the customer chooses a
 * fleet, never a seller. Choosing creates the order, and the 30% that
 * confirms it is paid on the next screen.
 */
@Composable
fun CustomerBidsScreen(app: OwnerApp, request: RequirementsApi.Requirement, onChanged: () -> Unit) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var bids by remember { mutableStateOf<Loadable<List<RequirementsApi.Bid>>>(Loadable.Loading) }
    var choosing by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }
    val material = request.kind == RequirementsApi.KIND_MATERIAL
    var status by remember { mutableStateOf(request.status) }
    val awardable = status in setOf("OPEN", "BIDDING", "PARTIALLY_AWARDED")
    var withdrawing by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    // Choosing turns every other bid down, so it is asked once more, with room for a note.
    var confirming by remember { mutableStateOf<RequirementsApi.Bid?>(null) }
    var awardNote by remember { mutableStateOf("") }

    LaunchedEffect(request.id) {
        bids = try {
            Loadable.Ready(app.requirements.bids(request.id).filter { !it.expired && it.status != "WITHDRAWN" }.sortedBy { it.price })
        } catch (failure: Exception) {
            Loadable.Failed(failure.readable())
        }
    }

    fun choose(bid: RequirementsApi.Bid) {
        confirming = null
        choosing = bid.id
        message = null
        scope.launch {
            try {
                val result = app.requirements.award(request.id, bid.id, awardNote.trim().ifBlank { null })
                onChanged()
                // A cab or tour becomes a booking to pay for; open it straight away.
                result?.bookingId?.let { bookingId ->
                    val booking = runCatching { app.travel.get(bookingId) }.getOrNull()
                    if (booking != null) {
                        navigator.replace("booking-$bookingId") { CustomerBookingScreen(app, booking, onChanged) }
                        return@launch
                    }
                }
                val orderId = result?.orderId
                if (orderId != null) {
                    val order = app.orders.get(orderId)
                    if (order != null) {
                        navigator.replace("order-$orderId") { CustomerOrderScreen(app, order, onChanged) }
                        return@launch
                    }
                }
                choosing = null
                message = (result?.nextStep?.ifBlank { null } ?: "${bid.bidderName} has the job.") to NoticeTone.SUCCESS
            } catch (failure: Exception) {
                choosing = null
                message = failure.readable() to NoticeTone.DANGER
            }
        }
    }

    /** Take the request down. Every offer on it is turned down and the bidders are told [reason]. */
    fun withdraw() {
        withdrawing = false
        busy = true
        message = null
        scope.launch {
            try {
                app.requirements.cancel(request.id, reason.trim())
                status = "CANCELLED"
                onChanged()
                message = "Withdrawn. Every fleet that bid has been told why." to NoticeTone.SUCCESS
            } catch (failure: Exception) {
                message = failure.readable() to NoticeTone.DANGER
            }
            busy = false
        }
    }

    val hours = request.hoursLeft().takeIf { awardable }
    val count = (bids as? Loadable.Ready)?.value?.size ?: request.bidCount
    DetailScreen(
        eyebrow = listOfNotNull(request.what, request.destinationAddress?.substringBefore(',')).joinToString(" · "),
        title = if (count == 1) "1 bid" else "$count bids",
        trailing = { hours?.let { Pill("$it h left", c.warningBg, c.warning) } },
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .rise()
                .clip(RoundedCornerShape(20.dp))
                .background(c.successWash)
                .border(1.dp, c.successGlow, RoundedCornerShape(20.dp))
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            IconWell(Lucide.shieldCheck, well = c.successSoft, ink = c.success, size = 36.dp, shape = CircleShape, iconSize = 16.dp)
            Text(
                if (material) {
                    "Each price includes the material and delivery. Pay 30% to confirm, 70% after delivery."
                } else {
                    "Each price is the whole job from that fleet. Choose one to confirm it."
                },
                style = SType.body,
                color = c.fg,
                modifier = Modifier.weight(1f),
            )
        }
        message?.let { (text, tone) -> RevealedNotice(text, tone) }

        when (val shown = bids) {
            Loadable.Loading -> SkeletonCards(count = 2)
            is Loadable.Failed -> NoticeCard(shown.message, NoticeTone.WARNING, icon = Lucide.cloudOff)
            is Loadable.Ready -> {
                if (shown.value.isEmpty() && awardable) {
                    NoticeCard(
                        "No bids yet. Fleets near the site are checking — you'll get an alert when one arrives.",
                        NoticeTone.INFO,
                        icon = Lucide.clock,
                    )
                }
                shown.value.forEachIndexed { index, bid ->
                    BidCard(
                        bid = bid,
                        lowest = index == 0,
                        material = material,
                        awardable = awardable && bid.status in setOf("OFFERED", "SHORTLISTED"),
                        busy = choosing == bid.id,
                        anyBusy = choosing != null,
                        modifier = Modifier.rise(stagger(index + 1)),
                    ) {
                        awardNote = ""
                        confirming = bid
                    }
                }
            }
        }
        if (awardable) {
            LinkButton(
                "Withdraw this request",
                onClick = { withdrawing = true },
                color = c.danger,
                enabled = !busy && choosing == null,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
        }
    }

    BottomSheet(visible = confirming != null, onDismiss = { confirming = null }) {
        confirming?.let { bid ->
            val firstName = bid.bidderName.substringBefore(' ')
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("Choose $firstName for ${rupees(bid.price)}?", style = SType.sheetTitle, color = c.fg)
                Text(
                    if (material) {
                        "You pay 30% (${rupees(bid.price * ADVANCE_SHARE)}) to confirm and the rest after delivery. Every other bid on this request is turned down."
                    } else {
                        "Every other bid on this request is turned down and those fleets are told."
                    },
                    style = SType.body,
                    color = c.muted,
                )
                NotesField(awardNote, { awardNote = it.take(1000) }, label = "A note for $firstName (optional)", minHeight = 72.dp)
                SaarthiButton("Choose $firstName", onClick = { choose(bid) }, enabled = choosing == null)
                LinkButton("Not yet", onClick = { confirming = null }, modifier = Modifier.align(Alignment.CenterHorizontally))
            }
        }
    }

    BottomSheet(visible = withdrawing, onDismiss = { withdrawing = false }) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Withdraw this request?", style = SType.sheetTitle, color = c.fg)
            Text("Every offer on it will be turned down and the fleets told why.", style = SType.body, color = c.muted)
            NotesField(reason, { reason = it.take(500) }, label = "Why are you withdrawing it?", minHeight = 80.dp)
            SaarthiButton(
                "Withdraw",
                onClick = ::withdraw,
                tone = ButtonTone.DANGER_OUTLINE,
                enabled = reason.trim().length >= 5 && !busy,
            )
        }
    }
}

@Composable
private fun BidCard(
    bid: RequirementsApi.Bid,
    lowest: Boolean,
    material: Boolean,
    awardable: Boolean,
    busy: Boolean,
    anyBusy: Boolean,
    modifier: Modifier = Modifier,
    onChoose: () -> Unit,
) {
    val c = Saarthi.colors
    val won = bid.status == "ACCEPTED"
    Column(
        modifier
            .fillMaxWidth()
            .card(radius = 24.dp, ring = if (lowest && awardable) c.primary else if (won) c.success else c.ring)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(bid.bidderName, size = 44.dp, background = c.successSoft, ink = c.success)
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(bid.bidderName, style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (bid.bidderVerified) LineIcon(Lucide.shieldCheck, size = 15.dp, color = c.success)
                }
                bid.bidderRating?.let {
                    Text("★ ${"%.1f".format(it)} · ${bid.bidderRatingCount} ratings", style = SType.caption, color = c.muted)
                }
            }
            when {
                won -> Pill("Chosen", c.successBg, c.success)
                lowest -> Pill("Lowest", c.primaryWash, c.primary)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(rupees(bid.price), style = SType.figure.copy(fontSize = 30.sp), color = c.fg)
                Text(
                    clockOf(bid.estimatedArrivalAt)?.let { "${if (material) "Delivered" else "Arrives"} $it" } ?: bid.message?.take(60) ?: "",
                    style = SType.caption,
                    color = c.muted,
                    maxLines = 2,
                )
            }
            val photo = rememberPhoto(if (material) R.drawable.vehicle_tipper else R.drawable.vehicle_truck)
            if (photo != null) {
                Image(photo, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.size(width = 100.dp, height = 54.dp))
            }
        }
        if (awardable) {
            SaarthiButton(
                if (material) "Choose ${bid.bidderName.substringBefore(' ')} · pay ${rupees(bid.price * ADVANCE_SHARE)} now" else "Choose ${bid.bidderName.substringBefore(' ')}",
                onClick = onChoose,
                tone = if (lowest) ButtonTone.PRIMARY else ButtonTone.SECONDARY,
                busy = busy,
                busyText = "Confirming…",
                enabled = !anyBusy,
                height = 52.dp,
            )
        }
    }
}
