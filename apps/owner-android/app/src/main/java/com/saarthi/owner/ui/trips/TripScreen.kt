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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.OPERATOR_OWNER_ROLES
import com.saarthi.owner.network.HandoverApi
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.Words
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
import com.saarthi.owner.ui.map.RouteMapScreen
import com.saarthi.owner.ui.map.TripRouteMap
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.orders.HandoverCodeSheet
import com.saarthi.owner.ui.orders.OverrideHandoverSheet
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

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

    val scope = rememberCoroutineScope()
    val account = app.session.account.value
    val canManage = account?.can(TripsApi.CAN_MANAGE) == true
    val canOverride = account?.membershipRole in OPERATOR_OWNER_ROLES
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }
    var reassigning by remember { mutableStateOf(false) }
    // The step waiting on the customer's code, and which code it needs.
    var codeFor by remember { mutableStateOf<Pair<String, String>?>(null) }
    var codeError by remember { mutableStateOf<String?>(null) }
    var overriding by remember { mutableStateOf<String?>(null) }
    var overrideError by remember { mutableStateOf<String?>(null) }

    /**
     * Move the trip to [status]. A step that needs the customer's handover code
     * asks for it, as the driver's app does, and a wrong one says so.
     */
    fun step(status: String, code: String? = null) {
        busy = true
        notice = null
        codeError = null
        scope.launch {
            try {
                app.trips.transition(trip.id, status, code)
                codeFor = null
                notice = stepDoneWord(status) to NoticeTone.SUCCESS
                reload++
            } catch (refused: OwnerApi.Failure.Refused) {
                when {
                    refused.code == HANDOVER_REQUIRED ->
                        codeFor = status to (if (status == "COMPLETED") HandoverApi.DELIVERY else HandoverApi.PICKUP)
                    refused.code?.startsWith(HANDOVER_PREFIX) == true -> codeError = refused.message
                    else -> notice = refused.message to NoticeTone.DANGER
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                notice = error.readable() to NoticeTone.DANGER
            } finally {
                busy = false
            }
        }
    }

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

    DetailScreen(
        eyebrow = if (trip.reference.isBlank()) stringResource(R.string.net_trips_trip) else stringResource(R.string.net_trips_trip_reference, trip.reference),
        title = trip.betweenPlaces(),
    ) {
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
                actions = {
                    if (canManage && !trip.closed) {
                        TripActions(
                            trip,
                            busy = busy,
                            onStep = { step(it) },
                            onReassign = { reassigning = true },
                            onCancel = { step("CANCELLED") },
                            modifier = Modifier.rise(stagger(1)),
                        )
                    }
                    // Outside the card, so "Trip completed." stays once the card has gone.
                    notice?.let { (text, tone) -> NoticeCard(text, tone) }
                },
            )
        }
    }

    // Beside the page, not in it, so they rise over the whole screen.
    ReassignTripSheet(app, trip, visible = reassigning, onDismiss = { reassigning = false }) {
        reassigning = false
        notice = Words.get(R.string.net_trips_crew_updated) to NoticeTone.SUCCESS
        reload++
    }
    val waiting = codeFor
    HandoverCodeSheet(
        purpose = waiting?.second ?: HandoverApi.DELIVERY,
        visible = waiting != null && overriding == null,
        busy = busy,
        error = codeError,
        canOverride = canOverride,
        onSubmit = { code -> waiting?.let { step(it.first, code) } },
        onNoCode = {
            overrideError = null
            overriding = waiting?.second
        },
        onDismiss = {
            codeFor = null
            codeError = null
        },
    )
    OverrideHandoverSheet(
        purpose = overriding,
        busy = busy,
        error = overrideError,
        onConfirm = { reason ->
            val purpose = overriding ?: return@OverrideHandoverSheet
            val pending = codeFor
            busy = true
            overrideError = null
            scope.launch {
                try {
                    app.handover.override(trip.id, purpose, reason)
                    overriding = null
                    codeFor = null
                    busy = false
                    // The code is cleared; the step it held up can go ahead.
                    pending?.let { step(it.first) }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Exception) {
                    overrideError = error.readable()
                    busy = false
                }
            }
        },
        onDismiss = { overriding = null },
    )
}

/** The server's refusals for a step held up by the customer's handover code. */
private const val HANDOVER_PREFIX = "HANDOVER_CODE"
private const val HANDOVER_REQUIRED = "HANDOVER_CODE_REQUIRED"

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TripDetail(
    trip: TripsApi.Trip,
    travelled: Travelled,
    staleNote: String?,
    onRetryTrail: () -> Unit,
    actions: @Composable () -> Unit,
) {
    val c = Saarthi.colors
    val look = tripStatusLook(trip.status)

    FlowRow(Modifier.fillMaxWidth().rise(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        StatusPill(look.word, background = look.ground, ink = look.ink, live = trip.underway)
        if (trip.late && !trip.closed) StatusPill(stringResource(R.string.net_trips_late), background = c.warningBg, ink = c.warning, dot = false)
        if (trip.adHoc) StatusPill(stringResource(R.string.net_trips_service_run), background = c.sunken, ink = c.muted, dot = false)
        if (trip.driverCreated) StatusPill(stringResource(R.string.net_trips_added_by_driver), background = c.primaryWash, ink = c.primary, dot = false)
        if (trip.navigationHandoff == "GOOGLE_MAPS") StatusPill("Google Maps", background = c.sunken, ink = c.muted, dot = false)
    }

    // A refresh failed after a good read: say so, keep showing what was read.
    staleNote?.let { NoticeCard(stringResource(R.string.net_trips_showing_last_update, it), NoticeTone.WARNING) }

    actions()

    val history = (travelled as? Travelled.Ready)?.history
    val runs = remember(history) { history?.points?.let(::travelledRuns).orEmpty() }
    // No stored path to draw: shade the plan by how far the vehicle has come instead.
    val (route, trail) = remember(trip, runs) { if (runs.isNotEmpty()) trip.routePoints to runs else trip.coveredAlongPlan() }
    val alongPlan = runs.isEmpty() && trail.isNotEmpty()
    val navigator = LocalNavigator.current
    val vehicle = trip.mapVehicle()
    // With a stored path drawn over the whole plan, the plan behind the vehicle is dimmed as on the web.
    val coveredTo = vehicle?.takeIf { runs.isNotEmpty() && trip.underway }?.let { it.latitude to it.longitude }
    val routeLabel = if (alongPlan) stringResource(R.string.net_trips_still_to_go) else stringResource(R.string.net_trips_planned_route)
    val trailLabels = if (alongPlan) mapOf(TrailTone.ON_ROUTE to stringResource(R.string.net_trips_covered)) else TRAIL_LABELS

    TripRouteMap(
        route = route,
        trail = trail,
        pickup = trip.pickupPoint,
        drop = trip.dropPoint,
        vehicle = vehicle,
        routeLabel = routeLabel,
        trailLabels = trailLabels,
        routeCoveredTo = coveredTo,
        onExpand = {
            navigator.push("trip-map-${trip.id}") {
                RouteMapScreen(
                    title = listOf(trip.reference, trip.destinationAddress.ifBlank { null }?.let { stringResource(R.string.net_trips_to_place, it) }).filterNotNull().joinToString(" · "),
                    route = route,
                    trail = trail,
                    pickup = trip.pickupPoint,
                    drop = trip.dropPoint,
                    vehicle = vehicle,
                    routeLabel = routeLabel,
                    trailLabels = trailLabels,
                    routeCoveredTo = coveredTo,
                )
            }
        },
        modifier = Modifier.rise(stagger(1)),
    ) {
        when (travelled) {
            Travelled.Loading -> Text(stringResource(R.string.net_trips_path_loading), style = SType.caption, color = c.muted)
            is Travelled.Ready -> Text(
                when {
                    runs.isNotEmpty() -> km(travelled.history.totalDistanceKm.takeIf { it > 0 })
                        ?.let { stringResource(R.string.net_trips_path_gps_recorded, it) }
                        ?: stringResource(R.string.net_trips_path_gps)
                    trip.actualStartAt == null && !trip.closed -> stringResource(R.string.net_trips_path_after_start)
                    route.size < 2 && trail.isEmpty() -> stringResource(R.string.net_trips_path_ends_only)
                    else -> stringResource(R.string.net_trips_path_planned_only)
                },
                style = SType.caption,
                color = c.muted,
            )
            is Travelled.Unavailable -> Text(stringResource(R.string.net_trips_path_unavailable, travelled.message), style = SType.caption, color = c.muted)
            is Travelled.Failed -> NoticeCard(
                stringResource(R.string.net_trips_path_failed, travelled.message),
                NoticeTone.WARNING,
                trailing = { LinkButton(stringResource(R.string.net_trips_retry), onRetryTrail, style = SType.smallStrong) },
            )
        }
        RouteStops(
            from = trip.originAddress,
            fromNote = clockOf(trip.actualStartAt)?.let { stringResource(R.string.net_trips_left_at, it) },
            to = trip.destinationAddress,
            toNote = clockOf(trip.actualArrivalAt)?.let { stringResource(R.string.net_trips_arrived_at, it) }
                ?: trip.remainingKm?.takeIf { trip.underway }?.let { stringResource(R.string.net_trips_km_to_go, km(it).orEmpty()) },
            eta = clockOf(trip.etaAt)?.takeIf { trip.underway },
        )
    }

    tripFacts(trip).takeIf { it.isNotEmpty() }?.let { facts ->
        TripSection(stringResource(R.string.net_trips_journey), Modifier.rise(stagger(2))) { Facts(facts) }
    }

    TripCrewCard(trip, Modifier.rise(stagger(2)))

    if (trip.price != null || trip.expenses != null) TripMoneyCard(trip, Modifier.rise(stagger(3)))

    if (trip.hasDrivingRecord) TripDrivingCard(trip, Modifier.rise(stagger(3)))

    if (trip.stops.isNotEmpty()) TripStopsCard(trip.stops, Modifier.rise(stagger(4)))

    trip.notes?.ifBlank { null }?.let { notes ->
        TripSection(stringResource(R.string.net_trips_notes), Modifier.rise(stagger(4))) { Text(notes, style = SType.body, color = c.fg) }
    }

    if (trip.events.isNotEmpty()) TripEventsCard(trip.events, Modifier.rise(stagger(4)))
}
