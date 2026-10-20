package com.saarthi.owner.ui.drive

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.DeviceLocation
import com.saarthi.owner.data.OPERATOR_OWNER_ROLES
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.drive.DrivingService
import com.saarthi.owner.network.DrivingApi
import com.saarthi.owner.network.HandoverApi
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.costs.FillUpScreen
import com.saarthi.owner.ui.costs.SlipLogScreen
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.orders.HandoverCodeSheet
import com.saarthi.owner.ui.orders.OverrideHandoverSheet
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.tracking.FollowCard
import com.saarthi.owner.ui.tracking.FollowScreen
import com.saarthi.owner.ui.tracking.attempt
import com.saarthi.owner.ui.tracking.ownerFollowSource
import com.saarthi.owner.ui.tracking.rememberFollowed
import com.saarthi.owner.ui.trips.TripScreen
import com.saarthi.owner.ui.trips.stepDoneWord
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

private const val REFRESH_MS = 15_000L
private const val HANDOVER_PREFIX = "HANDOVER_CODE"
private const val HANDOVER_REQUIRED = "HANDOVER_CODE_REQUIRED"

/** A step waiting on the customer's code: the trip, where it was going, and which code. */
private class CodeWait(val tripId: String, val target: String, val purpose: String)

/**
 * Drive — an owner driving their own vehicle, as Humsafar has a driver drive:
 * the trip they are on with the one button its state calls for, the arrival
 * the vehicle's GPS noticed, Google Maps, the trips still to come (the next
 * starting by itself when one ends), fuel, slips and SOS. While a trip runs
 * the phone records its road, with a "Driving" notification saying so.
 */
@Composable
fun DriveScreen(app: OwnerApp, account: SessionStore.Account, vehicle: VehiclesApi.Vehicle, driverId: String) {
    val context = LocalContext.current
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var reload by remember { mutableIntStateOf(0) }
    var trips by remember { mutableStateOf<Loadable<List<TripsApi.Trip>>>(Loadable.Loading) }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }
    var codeWait by remember { mutableStateOf<CodeWait?>(null) }
    var codeError by remember { mutableStateOf<String?>(null) }
    var overriding by remember { mutableStateOf<String?>(null) }
    var overrideError by remember { mutableStateOf<String?>(null) }
    var sosOpen by remember { mutableStateOf(false) }
    var sosError by remember { mutableStateOf<String?>(null) }
    var ending by remember { mutableStateOf<TripsApi.Trip?>(null) }
    var endingShortKm by remember { mutableStateOf<Double?>(null) }
    val recording by DrivingService.running.collectAsStateWithLifecycle()
    val paused by DrivingService.pausedByDriver.collectAsStateWithLifecycle()
    var allowed by remember { mutableStateOf(DeviceLocation.allowed(context)) }
    val followed = rememberFollowed("drive-${vehicle.id}", remember(vehicle.id) { ownerFollowSource(app, vehicle.id) })

    val list = (trips as? Loadable.Ready)?.value.orEmpty()
    val current = list.firstOrNull { it.status in TripWalk.MOVING || it.status in TripWalk.AT_SITE }
    val upcoming = list.filter { it.status in TripWalk.NOT_STARTED }

    fun record() = DrivingService.start(context, vehicle.id, driverId, formatPlate(vehicle.registrationNumber))
    val askLocation = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        allowed = DeviceLocation.allowed(context)
        if (allowed && current != null) record()
    }
    fun allow() = askLocation.launch(locationAsk())

    LaunchedEffect(reload) {
        while (true) {
            trips = try {
                Loadable.Ready(app.driving.myTrips(driverId))
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                (trips as? Loadable.Ready) ?: Loadable.Failed(failure.readable())
            }
            delay(REFRESH_MS)
        }
    }
    // A trip under way records its road, unless the driver stopped it from the notification.
    LaunchedEffect(current?.id, allowed, paused, recording) {
        if (current != null && allowed && !paused && !recording) record()
    }

    suspend fun here(): Pair<Double, Double>? =
        if (DeviceLocation.allowed(context)) attempt { DeviceLocation.current(context) }?.let { it.latitude to it.longitude } else null

    /** Walk a trip to [target] from where it stands now, carrying the customer's code on the last step. */
    fun go(tripId: String, target: String, code: String? = null, note: String? = null, then: (() -> Unit)? = null) {
        busy = true
        notice = null
        codeError = null
        scope.launch {
            try {
                val trip = app.trips.get(tripId) ?: error(Words.get(R.string.costs_drive_trip_unreadable))
                val steps = TripWalk.path(trip.status, target) ?: error(Words.get(R.string.costs_drive_trip_moved_on))
                val at = here()
                steps.forEachIndexed { index, status ->
                    val last = index == steps.lastIndex
                    app.trips.transition(trip.id, status, handoverCode = code.takeIf { last }, note = note.takeIf { last }, latitude = at?.first, longitude = at?.second)
                }
                codeWait = null
                notice = stepDoneWord(target) to NoticeTone.SUCCESS
                reload++
                then?.invoke()
            } catch (refused: OwnerApi.Failure.Refused) {
                when {
                    refused.code == HANDOVER_REQUIRED ->
                        codeWait = CodeWait(tripId, target, if (target == "COMPLETED") HandoverApi.DELIVERY else HandoverApi.PICKUP)
                    refused.code?.startsWith(HANDOVER_PREFIX) == true -> codeError = refused.message
                    else -> notice = refused.message to NoticeTone.DANGER
                }
                reload++
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                notice = failure.readable() to NoticeTone.DANGER
            } finally {
                busy = false
            }
        }
    }

    /** Complete [trip], then start the next one straight away — no second slide for what was always next. */
    fun complete(trip: TripsApi.Trip, note: String? = null) {
        val next = upcoming.firstOrNull()
        go(trip.id, "COMPLETED", note = note) { next?.let { go(it.id, "STARTED") } }
    }

    DetailScreen(eyebrow = formatPlate(vehicle.registrationNumber), title = stringResource(R.string.costs_drive_title)) {
        GpsRow(recording, paused, allowed, underway = current != null, onAllow = ::allow, onResume = ::record)

        when (val shown = trips) {
            Loadable.Loading -> SkeletonCards(count = 2)
            is Loadable.Failed -> FailedCard(shown.message, { reload++ })
            is Loadable.Ready -> {
                current?.let { trip ->
                    val reached = trip.status in TripWalk.MOVING && trip.stops.any { it.type == "DESTINATION" && it.reachedAt != null }
                    if (reached) ArrivalPrompt(trip.destinationAddress, busy) { go(trip.id, "ARRIVED") }
                    DriveTripCard(
                        trip,
                        current = true,
                        busy = busy,
                        startBlockedBy = null,
                        onStart = {},
                        onArrived = { go(trip.id, "ARRIVED") },
                        onComplete = { complete(trip) },
                        onEndHere = {
                            ending = trip
                            endingShortKm = null
                            scope.launch {
                                val at = here()
                                val destination = trip.destinationLatitude?.let { lat -> trip.destinationLongitude?.let { lng -> lat to lng } }
                                endingShortKm = if (at != null && destination != null) TripWalk.metresBetween(at, destination) / 1000 else null
                            }
                        },
                        onMaps = { openGoogleMaps(context, app.driving, scope, trip) },
                        onOpen = { navigator.push("trip-${trip.id}") { TripScreen(app, trip) } },
                    )
                }
                notice?.let { (text, tone) -> NoticeCard(text, tone) }

                FollowCard(
                    followed,
                    onExpand = { navigator.push("drive-map-${vehicle.id}") { FollowScreen(rememberFollowed("drive-full-${vehicle.id}", remember { ownerFollowSource(app, vehicle.id) })) } },
                )

                DriveTools(
                    onFuel = { navigator.push("drive-fuel") { FillUpScreen(app, vehicle, onSaved = {}) } },
                    onSlip = { navigator.push("drive-slip") { SlipLogScreen(app, vehicle, onSaved = {}) } },
                    onSos = if (account.can(DrivingApi.CAN_SOS)) {
                        { sosError = null; sosOpen = true }
                    } else {
                        null
                    },
                )

                if (upcoming.isNotEmpty()) GroupLabel(stringResource(R.string.costs_drive_up_next))
                upcoming.forEachIndexed { index, trip ->
                    DriveTripCard(
                        trip,
                        current = false,
                        busy = busy,
                        startBlockedBy = when {
                            current != null ->
                                if (current.reference.isBlank()) stringResource(R.string.costs_drive_starts_after_this)
                                else stringResource(R.string.costs_drive_starts_after_ref, current.reference)
                            index > 0 -> stringResource(R.string.costs_drive_starts_after_above)
                            else -> null
                        },
                        onStart = {
                            if (!allowed) allow()
                            go(trip.id, "STARTED") { if (DeviceLocation.allowed(context)) record() }
                        },
                        onArrived = {},
                        onComplete = {},
                        onEndHere = {},
                        onMaps = {},
                        onOpen = { navigator.push("trip-${trip.id}") { TripScreen(app, trip) } },
                    )
                }
                if (current == null && upcoming.isEmpty()) Hint(stringResource(R.string.costs_drive_no_trips))
            }
        }
    }

    // Beside the page, not in it, so they rise over the whole screen.
    val waiting = codeWait
    HandoverCodeSheet(
        purpose = waiting?.purpose ?: HandoverApi.DELIVERY,
        visible = waiting != null && overriding == null,
        busy = busy,
        error = codeError,
        canOverride = account.membershipRole in OPERATOR_OWNER_ROLES,
        onSubmit = { code ->
            waiting?.let { wait ->
                if (wait.target == "COMPLETED") {
                    val next = upcoming.firstOrNull()
                    go(wait.tripId, wait.target, code) { next?.let { go(it.id, "STARTED") } }
                } else {
                    go(wait.tripId, wait.target, code) { if (DeviceLocation.allowed(context)) record() }
                }
            }
        },
        onNoCode = {
            overrideError = null
            overriding = waiting?.purpose
        },
        onDismiss = {
            codeWait = null
            codeError = null
        },
    )
    OverrideHandoverSheet(
        purpose = overriding,
        busy = busy,
        error = overrideError,
        onConfirm = { reason ->
            val purpose = overriding ?: return@OverrideHandoverSheet
            val pending = codeWait ?: return@OverrideHandoverSheet
            busy = true
            overrideError = null
            scope.launch {
                try {
                    app.handover.override(pending.tripId, purpose, reason)
                    overriding = null
                    codeWait = null
                    busy = false
                    // The code is cleared; the step it held up goes ahead.
                    go(pending.tripId, pending.target)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    overrideError = failure.readable()
                    busy = false
                }
            }
        },
        onDismiss = { overriding = null },
    )
    val endingTrip = ending
    EndHereSheet(
        visible = endingTrip != null,
        destination = endingTrip?.destinationAddress.orEmpty(),
        kmShort = endingShortKm,
        busy = busy,
        onConfirm = {
            val trip = endingTrip ?: return@EndHereSheet
            ending = null
            scope.launch {
                val at = here()
                val destination = trip.destinationLatitude?.let { lat -> trip.destinationLongitude?.let { lng -> lat to lng } }
                complete(trip, TripWalk.endedEarlyNote(at, destination, trip.destinationAddress.substringBefore(',')))
            }
        },
        onDismiss = { ending = null },
    )
    SosSheet(
        visible = sosOpen,
        busy = busy,
        error = sosError,
        onSend = { kind, words ->
            busy = true
            sosError = null
            scope.launch {
                try {
                    val at = here() ?: error(Words.get(R.string.costs_drive_sos_no_location))
                    app.sos.raise(kind, at.first, at.second, words)
                    sosOpen = false
                    notice = Words.get(R.string.costs_drive_sos_sent) to NoticeTone.WARNING
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    sosError = failure.readable()
                } finally {
                    busy = false
                }
            }
        },
        onDismiss = { sosOpen = false },
    )
}

/** Location to record the road, and on newer phones the right to show the "Driving" notification. */
private fun locationAsk(): Array<String> = buildList {
    addAll(DeviceLocation.PERMISSIONS)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
}.toTypedArray()

/**
 * Google Maps to the trip's destination — the destination only, as Humsafar
 * hands it over — and the trip told, so a stretch off the planned route that
 * still heads there is drawn as another road, not a deviation.
 */
private fun openGoogleMaps(context: Context, driving: DrivingApi, scope: kotlinx.coroutines.CoroutineScope, trip: TripsApi.Trip) {
    val lat = trip.destinationLatitude ?: return
    val lng = trip.destinationLongitude ?: return
    val uri = Uri.parse(String.format(Locale.US, "https://www.google.com/maps/dir/?api=1&destination=%.6f,%.6f&travelmode=driving&dir_action=navigate", lat, lng))
    val maps = Intent(Intent.ACTION_VIEW, uri).setPackage(GOOGLE_MAPS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    // Without the Maps app the link opens in whatever can show it.
    runCatching { context.startActivity(maps) }.onFailure { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
    scope.launch { attempt { driving.handOff(trip.id, toGoogleMaps = true) } }
}

private const val GOOGLE_MAPS = "com.google.android.apps.maps"
