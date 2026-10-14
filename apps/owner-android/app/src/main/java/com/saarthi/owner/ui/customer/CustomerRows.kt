package com.saarthi.owner.ui.customer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.network.OrdersApi
import com.saarthi.owner.network.RequirementsApi
import com.saarthi.owner.ui.common.plural
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.orders.OrderRow

/** The icon and colours a kind of request is drawn with. */
@Composable
internal fun kindIcon(kind: String): Triple<String, androidx.compose.ui.graphics.Color, androidx.compose.ui.graphics.Color> {
    val c = Saarthi.colors
    return when (kind) {
        RequirementsApi.KIND_MATERIAL -> Triple(Lucide.box, c.accentSoft, c.accent)
        RequirementsApi.KIND_FREIGHT -> Triple(Lucide.truck, c.primarySoft, c.primary)
        RequirementsApi.KIND_CAB -> Triple(Lucide.car, c.infoSoft, c.info)
        else -> Triple(Lucide.bus, c.successSoft, c.success)
    }
}

/** A posted request: what, where, and how many bids — or, once closed, how it ended. */
@Composable
fun RequestRow(request: RequirementsApi.Requirement, modifier: Modifier = Modifier, onOpen: () -> Unit) {
    val c = Saarthi.colors
    val (icon, well, ink) = kindIcon(request.kind)
    val hasBids = request.bidCount > 0
    // A closed request says how it ended; an open one, how many bids it has.
    val ended = when (request.status) {
        "CANCELLED" -> "Cancelled"
        "EXPIRED" -> "No bids taken"
        "AWARDED", "PARTIALLY_AWARDED" -> "Awarded"
        "FULFILLED" -> "Done"
        else -> null
    }
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp, ring = if (hasBids && ended == null) c.primaryRing else c.ring)
            .pressable(scale = 0.98f, onClick = onOpen)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(icon, well = well, ink = ink, size = 44.dp, radius = 14.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(request.what, style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                Box(
                    Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (hasBids && ended == null) c.primaryWash else c.sunken)
                        .padding(horizontal = 8.dp, vertical = 2.dp),
                ) {
                    Text(
                        ended ?: if (hasBids) plural(request.bidCount, "bid") else "Waiting",
                        style = SType.captionStrong,
                        color = if (hasBids && ended == null) c.primary else c.muted,
                    )
                }
            }
            Text(
                listOfNotNull(
                    request.destinationAddress?.substringBefore(',') ?: request.originAddress.substringBefore(','),
                    request.lowestBid?.let { "from ${rupees(it)}" },
                ).joinToString(" · "),
                style = SType.caption,
                color = c.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}

/** An order, from the customer's side — the fleet, never the seller. */
@Composable
fun CustomerOrderRow(order: OrdersApi.Order, modifier: Modifier = Modifier, onOpen: () -> Unit) {
    OrderRow(order, counterparty = order.fleetName, amount = order.totalPrice, onOpen = onOpen, modifier = modifier)
}
