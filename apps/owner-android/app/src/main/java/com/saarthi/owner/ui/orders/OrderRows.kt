package com.saarthi.owner.ui.orders

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.network.OrdersApi
import com.saarthi.owner.ui.common.rememberPhoto
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable

/** An order's status as a word and its colours. */
data class StatusLook(val word: String, val ground: Color, val ink: Color)

@Composable
fun orderStatusLook(status: String): StatusLook {
    val c = Saarthi.colors
    return when (status) {
        "DRAFT", "REQUESTED", "QUOTED" -> StatusLook(stringResource(R.string.market_order_status_awaiting), c.warningBg, c.warning)
        "CONFIRMED" -> StatusLook(stringResource(R.string.market_order_status_confirmed), c.primaryWash, c.primary)
        "ASSIGNED" -> StatusLook(stringResource(R.string.market_order_status_assigned), c.primaryWash, c.primary)
        "PICKUP" -> StatusLook(stringResource(R.string.market_order_status_loading), c.warningBg, c.warning)
        "IN_TRANSIT" -> StatusLook(stringResource(R.string.market_order_status_on_the_way), c.successBg, c.success)
        "DELIVERED" -> StatusLook(stringResource(R.string.market_order_status_delivered), c.successBg, c.success)
        "COMPLETED" -> StatusLook(stringResource(R.string.market_order_status_completed), c.sunken, c.muted)
        "CANCELLED", "FAILED" -> StatusLook(stringResource(R.string.market_order_status_cancelled), c.dangerBg, c.danger)
        else -> StatusLook(status.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }, c.sunken, c.muted)
    }
}

/**
 * One order in a list: what, for whom, where it stands.
 *
 * [counterparty] is whoever this side deals with — the customer for a fleet,
 * the fleet for a customer or a seller; never the side it must not see.
 */
@Composable
fun OrderRow(order: OrdersApi.Order, counterparty: String?, amount: Double?, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val look = orderStatusLook(order.status)
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .pressable(scale = 0.98f, onClick = onOpen)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier
                .size(width = 72.dp, height = 50.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(c.sunken),
            contentAlignment = Alignment.Center,
        ) {
            val photo = rememberPhoto(R.drawable.vehicle_tipper)
            if (photo != null) {
                Image(photo, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.padding(4.dp))
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(order.what, style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(counterparty, order.reference.ifBlank { null }).joinToString(" · "),
                style = SType.caption,
                color = c.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(look.ground)
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                ) {
                    Text(look.word, style = SType.captionStrong, color = look.ink, maxLines = 1)
                }
                amount?.let { Text(rupees(it), style = SType.smallStrong, color = c.fg) }
            }
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}
