package com.saarthi.owner.ui.rides

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.LiveRidesApi
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LiveDot
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.delay

/** Home asks about as often as it refreshes itself. */
private const val HOME_REFRESH_MS = 30_000L

/**
 * Live rides on Home: family sharing a ride with this person, and the person's
 * own rides shared from Humsafar. The server decides which an account gets —
 * a Personal plan sees family's, any account its own — so on the Fleet and
 * Travel homes this is usually empty. Each opens the live view. Draws nothing
 * while nobody is sharing; a failed read stays quiet and the next one tries
 * again.
 */
@Composable
fun LiveRidesOnHome(app: OwnerApp, modifier: Modifier = Modifier) {
    val navigator = LocalNavigator.current
    var rides by remember { mutableStateOf<List<LiveRidesApi.RideSharedWithMe>>(emptyList()) }

    LaunchedEffect(Unit) {
        while (true) {
            runCatching { app.liveRides.sharedWithMe() }.getOrNull()?.let { rides = it }
            delay(HOME_REFRESH_MS)
        }
    }

    if (rides.isEmpty()) return
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        rides.forEach { ride ->
            LiveRideCard(ride) { navigator.push("live-${ride.token}") { LiveRideScreen(app, ride.token) } }
        }
    }
}

/** One shared ride: who is sharing, the vehicle's number, when they were last heard from, and the way in. */
@Composable
private fun LiveRideCard(ride: LiveRidesApi.RideSharedWithMe, onOpen: () -> Unit) {
    val c = Saarthi.colors
    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 22.dp, ring = c.primaryRing)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            IconWell(Lucide.navigation, well = c.successSoft, ink = c.success, size = 40.dp, shape = CircleShape, iconSize = 18.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    ride.ownLabel() ?: stringResource(R.string.rides_live_sharing, ride.shownName()),
                    style = SType.bodyStrong,
                    color = c.fg,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                ride.registrationNumber?.trim()?.ifEmpty { null }?.let { PlateChip(it) }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    LiveDot(c.success, size = 6.dp)
                    Text(liveUpdatedText(ride.position?.recordedAt), style = SType.small, color = c.muted)
                }
            }
        }
        SaarthiButton(stringResource(R.string.rides_live_open), onClick = onOpen, leading = Lucide.navigation, height = 48.dp)
    }
}
