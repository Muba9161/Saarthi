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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
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
import com.saarthi.owner.ui.common.Words
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

/** The advance and the balance as whole percentages, for the words that name them. */
internal const val ADVANCE_PERCENT = 30
internal const val BALANCE_PERCENT = 70

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
                message = (result?.nextStep?.ifBlank { null } ?: Words.get(R.string.customer_bid_has_job, bid.bidderName)) to NoticeTone.SUCCESS
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
                message = Words.get(R.string.customer_bids_withdrawn) to NoticeTone.SUCCESS
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
        title = pluralStringResource(R.plurals.customer_bids, count, count),
        trailing = { hours?.let { Pill(stringResource(R.string.customer_bids_hours_left, it), c.warningBg, c.warning) } },
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
                    stringResource(R.string.customer_bids_material_note, ADVANCE_PERCENT, BALANCE_PERCENT)
                } else {
                    stringResource(R.string.customer_bids_job_note)
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
                        stringResource(R.string.customer_bids_none_yet),
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
                stringResource(R.string.customer_bids_withdraw_request),
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
                Text(stringResource(R.string.customer_bids_choose_for, firstName, rupees(bid.price)), style = SType.sheetTitle, color = c.fg)
                Text(
                    if (material) {
                        stringResource(R.string.customer_bids_choose_material_note, ADVANCE_PERCENT, rupees(bid.price * ADVANCE_SHARE))
                    } else {
                        stringResource(R.string.customer_bids_choose_note)
                    },
                    style = SType.body,
                    color = c.muted,
                )
                NotesField(awardNote, { awardNote = it.take(1000) }, label = stringResource(R.string.customer_bids_note_for, firstName), minHeight = 72.dp)
                SaarthiButton(stringResource(R.string.customer_bids_choose, firstName), onClick = { choose(bid) }, enabled = choosing == null)
                LinkButton(stringResource(R.string.customer_bids_not_yet), onClick = { confirming = null }, modifier = Modifier.align(Alignment.CenterHorizontally))
            }
        }
    }

    BottomSheet(visible = withdrawing, onDismiss = { withdrawing = false }) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(stringResource(R.string.customer_bids_withdraw_title), style = SType.sheetTitle, color = c.fg)
            Text(stringResource(R.string.customer_bids_withdraw_note), style = SType.body, color = c.muted)
            NotesField(reason, { reason = it.take(500) }, label = stringResource(R.string.customer_bids_withdraw_reason), minHeight = 80.dp)
            SaarthiButton(
                stringResource(R.string.customer_bids_withdraw),
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
                    Text(stringResource(R.string.customer_bid_rating, "%.1f".format(it), bid.bidderRatingCount), style = SType.caption, color = c.muted)
                }
            }
            when {
                won -> Pill(stringResource(R.string.customer_bid_chosen), c.successBg, c.success)
                lowest -> Pill(stringResource(R.string.customer_bid_lowest), c.primaryWash, c.primary)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(rupees(bid.price), style = SType.figure.copy(fontSize = 30.sp), color = c.fg)
                Text(
                    clockOf(bid.estimatedArrivalAt)?.let { stringResource(if (material) R.string.customer_bid_delivered_at else R.string.customer_bid_arrives_at, it) } ?: bid.message?.take(60) ?: "",
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
                if (material) {
                    stringResource(R.string.customer_bid_choose_and_pay, bid.bidderName.substringBefore(' '), rupees(bid.price * ADVANCE_SHARE))
                } else {
                    stringResource(R.string.customer_bids_choose, bid.bidderName.substringBefore(' '))
                },
                onClick = onChoose,
                tone = if (lowest) ButtonTone.PRIMARY else ButtonTone.SECONDARY,
                busy = busy,
                busyText = stringResource(R.string.customer_bid_confirming),
                enabled = !anyBusy,
                height = 52.dp,
            )
        }
    }
}
