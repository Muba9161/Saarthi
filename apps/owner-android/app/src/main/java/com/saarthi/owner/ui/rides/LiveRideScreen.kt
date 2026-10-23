package com.saarthi.owner.ui.rides

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.LiveRidesApi
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.map.MapVehicle
import com.saarthi.owner.ui.map.VehicleMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/** Read again every ten seconds while sharing, as a followed vehicle is. */
private const val REFRESH_MS = 10_000L

/** A link that is not there, or not even shaped like one. */
private val MISSING = setOf(400, 404)

private val MAP_HEIGHT: Dp = 240.dp

/**
 * A ride somebody shares with this person, opened from the alert or the push
 * that told them — in the app rather than a browser. Who is sharing and the
 * vehicle's number, then the rider on the map with when they were last
 * heard from, read again until the ride ends. An ended ride says so and shows
 * nobody's whereabouts; a link that does not exist says that instead.
 */
@Composable
fun LiveRideScreen(app: OwnerApp, token: String) {
    var state by remember(token) { mutableStateOf<Loadable<LiveRidesApi.LiveRide>>(Loadable.Loading) }
    var missing by remember(token) { mutableStateOf(false) }
    var attempt by remember(token) { mutableIntStateOf(0) }

    LaunchedEffect(token, attempt) {
        while (true) {
            try {
                val ride = app.liveRides.get(token) ?: error("The live ride could not be read.")
                state = Loadable.Ready(ride)
                if (ride.phase() == LivePhase.ENDED) break
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                if (failure is OwnerApi.Failure.Refused && failure.status in MISSING) {
                    missing = true
                    break
                }
                // Once the ride is on screen a failed read keeps it, and the next pass tries again.
                if (state !is Loadable.Ready) {
                    state = Loadable.Failed(failure.readable())
                    break
                }
            }
            delay(REFRESH_MS)
        }
    }

    val ride = (state as? Loadable.Ready)?.value
    val name = ride?.riderName?.trim()?.ifEmpty { null } ?: stringResource(R.string.rides_someone)
    DetailScreen(
        eyebrow = stringResource(R.string.people_shared_with_you),
        title = if (ride != null && !missing) name else stringResource(R.string.rides_live_title),
    ) {
        if (missing) {
            NoticeCard(stringResource(R.string.rides_live_missing), NoticeTone.INFO, Modifier.rise(), icon = Lucide.ban)
            return@DetailScreen
        }
        when (val current = state) {
            Loadable.Loading -> SkeletonCards(count = 2)
            is Loadable.Failed -> FailedCard(current.message, onRetry = {
                state = Loadable.Loading
                attempt++
            })
            is Loadable.Ready -> {
                val phase = current.value.phase()
                RiderCard(current.value, name, phase, Modifier.rise())
                when (phase) {
                    LivePhase.LIVE -> {
                        val marker = remember(current.value) { current.value.mapMarker() }
                        val here = current.value.position
                        if (marker != null && here != null) LiveMapCard(marker, here, Modifier.rise(stagger(1)))
                    }
                    LivePhase.WAITING -> WaitingCard(name, Modifier.rise(stagger(1)))
                    LivePhase.ENDED -> Unit
                }
            }
        }
    }
}

/** Who is sharing — or has stopped — with the vehicle's number, and a live mark while it lasts. */
@Composable
private fun RiderCard(ride: LiveRidesApi.LiveRide, name: String, phase: LivePhase, modifier: Modifier) {
    val c = Saarthi.colors
    val ended = phase == LivePhase.ENDED
    val plate = ride.registrationNumber?.trim()?.ifEmpty { null }
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(
            if (ended) Lucide.flag else Lucide.navigation,
            well = if (ended) c.sunken else c.primarySoft,
            ink = if (ended) c.muted else c.primary,
            size = 44.dp,
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                if (ended) stringResource(R.string.rides_live_ended, name) else stringResource(R.string.rides_live_sharing, name),
                style = SType.bodyStrong,
                color = c.fg,
            )
            if (plate != null || !ended) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    plate?.let { PlateChip(it) }
                    if (!ended) StatusPill(stringResource(R.string.fleet_main_live), background = c.successSoft, ink = c.success, live = true)
                }
            }
        }
    }
}

/**
 * The rider on the map, labelled with their name and the vehicle's number,
 * the camera going back to them each time they move; under it, when they
 * were last heard from and how fast they were going.
 */
@Composable
private fun LiveMapCard(marker: MapVehicle, here: LiveRidesApi.Position, modifier: Modifier) {
    val c = Saarthi.colors
    var focus by remember { mutableIntStateOf(0) }
    LaunchedEffect(marker.latitude, marker.longitude) { focus++ }
    Column(modifier.fillMaxWidth().card(radius = 22.dp)) {
        Box(Modifier.fillMaxWidth().height(MAP_HEIGHT).clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp))) {
            VehicleMap(
                vehicles = listOf(marker),
                selectedId = marker.id,
                onSelect = {},
                focusRequest = focus,
                modifier = Modifier.fillMaxSize(),
            )
            CircleButton(
                Lucide.crosshair,
                stringResource(R.string.rides_live_recentre),
                onClick = { focus++ },
                modifier = Modifier.align(Alignment.TopEnd).padding(10.dp),
                size = 40.dp,
                iconSize = 16.dp,
            )
        }
        Text(here.updatedLine(), style = SType.small, color = c.muted, modifier = Modifier.padding(16.dp))
    }
}

/** Where the map will be, until the rider's phone sends its first position. */
@Composable
private fun WaitingCard(name: String, modifier: Modifier) {
    val c = Saarthi.colors
    Box(
        modifier.fillMaxWidth().height(MAP_HEIGHT).clip(RoundedCornerShape(22.dp)).background(c.sunken),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            LineIcon(Lucide.mapPin, size = 24.dp, color = c.muted)
            Text(stringResource(R.string.rides_live_waiting, name), style = SType.small, color = c.muted, textAlign = TextAlign.Center)
        }
    }
}

/** "Updated 2 min ago · 42 km/h" — the speed only when the phone sent one. */
private fun LiveRidesApi.Position.updatedLine(): String {
    val speed = speedKph?.let { "${it.coerceAtLeast(0.0).roundToInt()} ${Words.get(R.string.market_follow_unit_kph)}" }
    return listOfNotNull(liveUpdatedText(recordedAt), speed).joinToString(" · ")
}
