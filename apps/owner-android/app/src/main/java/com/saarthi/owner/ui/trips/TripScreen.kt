package com.saarthi.owner.ui.trips

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.km
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.fleet.RouteStops
import com.saarthi.owner.ui.map.TRAIL_LABELS
import com.saarthi.owner.ui.map.TrailTone
import com.saarthi.owner.ui.map.TripRouteMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

private const val REFRESH_MS = 20_000L

/** A trip still on the road redraws its driven path every this many refreshes. */
private const val TRAIL_EVERY = 3

/** The driven path, as far as it could be read. */
private sealed interface Travelled {
    data object Loading : Travelled
    data class Ready(val history: TripsApi.TrackHistory) : Travelled

    /** Refused by the plan or a permission: not a fault, and the server says why. */
    data class Unavailable(val message: String) : Travelled
    data class Failed(val message: String) : Travelled
}

/**
 * One trip from the vehicle's side, the web's trip page on a phone: the map
 * with the path the vehicle drove over its planned road, then the figures,
 * the money, how it was driven, who was on it, its stops and its record.
 *
 * A trip still on the road is read again while the screen is open; a closed
 * one is read once.
 */
@Composable
fun TripScreen(app: OwnerApp, initial: TripsApi.Trip) {
    var trip by remember { mutableStateOf(initial) }
    var detail by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var travelled by remember { mutableStateOf<Travelled>(Travelled.Loading) }
    var reload by remember { mutableIntStateOf(0) }

    suspend fun readTrail(current: TripsApi.Trip) {
        val truckId = current.truck?.id ?: run {
            travelled = Travelled.Ready(TripsApi.TrackHistory())
            return
        }
        travelled = try {
            Travelled.Ready(app.trips.travelled(truckId, current.id))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (refused: OwnerApi.Failure.Refused) {
            if (refused.status == 403) Travelled.Unavailable(refused.message) else Travelled.Failed(refused.message)
        } catch (error: Exception) {
            Travelled.Failed(error.readable())
        }
    }

    LaunchedEffect(initial.id, reload) {
        var cycle = 0
        while (true) {
            try {
                app.trips.get(initial.id)?.let {
                    trip = it
                    detail = true
                    failure = null
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                failure = error.readable()
            }
            if (cycle == 0 || (trip.underway && cycle % TRAIL_EVERY == 0)) readTrail(trip)
            if (trip.closed) break
            cycle++
            delay(REFRESH_MS)
        }
    }

    DetailScreen(eyebrow = listOf("Trip", trip.reference).filter { it.isNotBlank() }.joinToString(" "), title = trip.betweenPlaces()) {
        when {
            // The list's summary lacks the route, stops and record: wait for the full read.
            !detail && failure != null -> FailedCard(failure!!, onRetry = { reload++ }, modifier = Modifier.rise())
            !detail -> SkeletonCards(count = 2, modifier = Modifier.rise())
            else -> TripDetail(
                trip,
                travelled,
                staleNote = failure,
                onRetryTrail = {
                    travelled = Travelled.Loading
                    reload++
                },
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TripDetail(trip: TripsApi.Trip, travelled: Travelled, staleNote: String?, onRetryTrail: () -> Unit) {
    val c = Saarthi.colors
    val look = tripStatusLook(trip.status)

    FlowRow(Modifier.fillMaxWidth().rise(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        StatusPill(look.word, background = look.ground, ink = look.ink, live = trip.underway)
        if (trip.late && !trip.closed) StatusPill("Late", background = c.warningBg, ink = c.warning, dot = false)
        if (trip.adHoc) StatusPill("Service run", background = c.sunken, ink = c.muted, dot = false)
        if (trip.driverCreated) StatusPill("Added by driver", background = c.primaryWash, ink = c.primary, dot = false)
        if (trip.navigationHandoff == "GOOGLE_MAPS") StatusPill("Google Maps", background = c.sunken, ink = c.muted, dot = false)
    }

    // A refresh failed after a good read: say so, keep showing what was read.
    staleNote?.let { NoticeCard("Showing the last update. $it", NoticeTone.WARNING) }

    val history = (travelled as? Travelled.Ready)?.history
    val runs = remember(history) { history?.points?.let(::travelledRuns).orEmpty() }
    // No stored path to draw: shade the plan by how far the vehicle has come instead.
    val (route, trail) = remember(trip, runs) { if (runs.isNotEmpty()) trip.routePoints to runs else trip.coveredAlongPlan() }
    val alongPlan = runs.isEmpty() && trail.isNotEmpty()

    TripRouteMap(
        route = route,
        trail = trail,
        pickup = trip.pickupPoint,
        drop = trip.dropPoint,
        vehicle = trip.mapVehicle(),
        routeLabel = if (alongPlan) "Still to go" else "Planned route",
        trailLabels = if (alongPlan) mapOf(TrailTone.ON_ROUTE to "Covered") else TRAIL_LABELS,
        modifier = Modifier.rise(stagger(1)),
    ) {
        when (travelled) {
            Travelled.Loading -> Text("Loading the driven path…", style = SType.caption, color = c.muted)
            is Travelled.Ready -> Text(
                when {
                    runs.isNotEmpty() -> "The driven path from the vehicle's GPS" +
                        (km(travelled.history.totalDistanceKm.takeIf { it > 0 })?.let { ", $it recorded." } ?: ".")
                    trip.actualStartAt == null && !trip.closed -> "The driven path appears here once the trip starts."
                    route.size < 2 && trail.isEmpty() -> "No route or GPS path is stored for this trip. Only its ends are marked."
                    else -> "No GPS path is stored for this trip, so the planned route is shown."
                },
                style = SType.caption,
                color = c.muted,
            )
            is Travelled.Unavailable -> Text("${travelled.message} The planned route is shown instead.", style = SType.caption, color = c.muted)
            is Travelled.Failed -> NoticeCard(
                "Couldn't load the driven path. ${travelled.message}",
                NoticeTone.WARNING,
                trailing = { LinkButton("Retry", onRetryTrail, style = SType.smallStrong) },
            )
        }
        RouteStops(
            from = trip.originAddress,
            fromNote = clockOf(trip.actualStartAt)?.let { "Left $it" },
            to = trip.destinationAddress,
            toNote = clockOf(trip.actualArrivalAt)?.let { "Arrived $it" }
                ?: trip.remainingKm?.takeIf { trip.underway }?.let { "${km(it)} to go" },
            eta = clockOf(trip.etaAt)?.takeIf { trip.underway },
        )
    }

    tripFacts(trip).takeIf { it.isNotEmpty() }?.let { facts ->
        TripSection("Journey", Modifier.rise(stagger(2))) { Facts(facts) }
    }

    TripCrewCard(trip, Modifier.rise(stagger(2)))

    if (trip.price != null || trip.expenses != null) TripMoneyCard(trip, Modifier.rise(stagger(3)))

    if (trip.hasDrivingRecord) TripDrivingCard(trip, Modifier.rise(stagger(3)))

    if (trip.stops.isNotEmpty()) TripStopsCard(trip.stops, Modifier.rise(stagger(4)))

    trip.notes?.ifBlank { null }?.let { notes ->
        TripSection("Notes", Modifier.rise(stagger(4))) { Text(notes, style = SType.body, color = c.fg) }
    }

    if (trip.events.isNotEmpty()) TripEventsCard(trip.events, Modifier.rise(stagger(4)))
}
