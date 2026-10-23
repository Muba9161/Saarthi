package com.saarthi.owner.ui.rides

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.network.LiveRidesApi
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.ago
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.isNow
import com.saarthi.owner.ui.design.Avatar
import com.saarthi.owner.ui.design.LiveDot
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable

/*
 * Rides being shared with this person, wherever they are listed: the
 * Vehicles list's "Shared with me" and the card on Home.
 */

/** "Updated just now", "Updated 4 min ago" — or "No location yet" before the first fix. */
fun liveUpdatedText(recordedAt: String?): String = when {
    recordedAt.isNullOrBlank() -> Words.get(R.string.rides_live_no_location)
    isNow(recordedAt) -> Words.get(R.string.rides_live_updated_now)
    else -> ago(recordedAt).ifEmpty { null }?.let { Words.get(R.string.rides_live_updated_ago, it) }
        ?: Words.get(R.string.rides_live_no_location)
}

/** The rider's name as the lists show it; somebody with no name on record is "Someone". */
internal fun LiveRidesApi.RideSharedWithMe.shownName(): String =
    riderName.trim().ifEmpty { Words.get(R.string.rides_someone) }

/** "Your ride (from Humsafar)" for the person's own ride; null for anybody else's. */
internal fun LiveRidesApi.RideSharedWithMe.ownLabel(): String? =
    if (mine) Words.get(R.string.rides_live_yours) else null

/** One shared ride as a row: who, the vehicle's number, when last heard from, and a live dot. */
@Composable
fun LiveRideRow(ride: LiveRidesApi.RideSharedWithMe, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val name = ride.shownName()
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .pressable(scale = 0.98f, label = stringResource(R.string.fleet_open_named, name), onClick = onOpen)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Avatar(name, size = 48.dp, background = c.successSoft, ink = c.success)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(ride.ownLabel() ?: name, style = SType.rowTitle, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(
                    ride.registrationNumber?.trim()?.ifEmpty { null }?.let(::formatPlate),
                    liveUpdatedText(ride.position?.recordedAt),
                ).joinToString(" · "),
                style = SType.small,
                color = c.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        LiveDot(c.success)
    }
}
