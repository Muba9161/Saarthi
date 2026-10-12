package com.saarthi.core.data

import com.saarthi.core.domain.RoutePath
import com.saarthi.core.domain.RouteState
import com.saarthi.core.domain.RouteTrail
import com.saarthi.core.domain.TrailPoint
import com.saarthi.core.domain.haversineMetres
import com.saarthi.core.network.TerminalTripDto
import com.saarthi.core.network.TrailPointDto
import com.saarthi.core.telemetry.Position
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * The path this vehicle has covered, for the map in its own cab.
 *
 * Two sources, merged: the server's stored path, which survives the app being
 * killed and is coloured by the same judgement the fleet's web map uses, and
 * the fixes this phone has taken since the last time it asked — coloured here,
 * by the same rule, so the line keeps growing under the marker between asks.
 * Each fresh copy from the server replaces the local guesses it now covers.
 */
class CoveredPathFeed(
    private val scope: CoroutineScope,
    private val positions: Flow<Position?>,
    private val dispatch: StateFlow<TerminalTripDto?>,
    private val fetch: suspend () -> Result<List<TrailPointDto>>,
) {

    private val _trail = MutableStateFlow<List<TrailPoint>>(emptyList())
    val trail: StateFlow<List<TrailPoint>> = _trail.asStateFlow()

    /** Server points, then local fixes newer than the last of them. */
    private var stored: List<TrailPoint> = emptyList()
    private var storedUntilMs: Long = 0
    private val local = ArrayDeque<Pair<Long, TrailPoint>>()

    /** The trip's plan as a line, rebuilt only when the trip or its plan changes. */
    private var routeKey: String? = null
    private var route: RoutePath? = null

    private var job: Job? = null

    /** Start following, once. Calling again while running does nothing. */
    fun start() {
        if (job?.isActive == true) return
        job = scope.launch {
            launch { reseed() }
            launch { follow() }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
        stored = emptyList()
        storedUntilMs = 0
        local.clear()
        _trail.value = emptyList()
    }

    private suspend fun reseed() {
        while (true) {
            fetch().onSuccess { points ->
                stored = points.map { TrailPoint(it.latitude, it.longitude, RouteState.parse(it.routeState)) }
                storedUntilMs = points.lastOrNull()?.let { epochMs(it.recordedAt) } ?: 0
                while (local.isNotEmpty() && local.first().first <= storedUntilMs) local.removeFirst()
                publish()
            }
            delay(RESEED_MS)
        }
    }

    private suspend fun follow() {
        positions.filterNotNull().collect { fix ->
            val last = local.lastOrNull()?.second ?: stored.lastOrNull()
            if (last != null && haversineMetres(last.latitude, last.longitude, fix.latitude, fix.longitude) < MIN_STEP_METRES) {
                return@collect
            }
            val trip = dispatch.value
            val onPlan = RouteTrail.next(
                tripUnderway = trip?.underway == true,
                route = routeFor(trip),
                latitude = fix.latitude,
                longitude = fix.longitude,
                previous = last?.state,
            )
            val state = if (onPlan == RouteState.OFF_ROUTE && trip?.navigationHandoff != null && headingThere(trip, fix)) {
                RouteState.ALTERNATE
            } else {
                onPlan
            }
            local.addLast(fix.at to TrailPoint(fix.latitude, fix.longitude, state))
            while (local.size > MAX_LOCAL_POINTS) local.removeFirst()
            publish()
        }
    }

    /** No further from the destination than this phone's own fix from a few minutes ago. */
    private fun headingThere(trip: TerminalTripDto, fix: Position): Boolean {
        val earlier = local.lastOrNull { it.first <= fix.at - RouteTrail.ALTERNATE_LOOKBACK_MS }?.second
        fun toGo(latitude: Double, longitude: Double) =
            haversineMetres(latitude, longitude, trip.destinationLatitude, trip.destinationLongitude)
        return RouteTrail.stillHeadingThere(
            earlier?.let { toGo(it.latitude, it.longitude) },
            toGo(fix.latitude, fix.longitude),
        )
    }

    private fun routeFor(trip: TerminalTripDto?): RoutePath? {
        if (trip == null || !trip.underway) return null
        val key = "${trip.id}:${trip.plannedRoute.size}"
        if (key != routeKey) {
            routeKey = key
            route = RoutePath.of(trip.plannedRoute)
        }
        return route
    }

    private fun publish() {
        val merged = stored + local.map { it.second }
        _trail.value = if (merged.size > MAX_POINTS) merged.takeLast(MAX_POINTS) else merged
    }

    private fun epochMs(iso: String): Long =
        runCatching { Instant.parse(iso).toEpochMilli() }.getOrDefault(0)

    private companion object {
        /** Often enough that a long stop does not leave the line stale for long. */
        const val RESEED_MS = 3 * 60_000L

        /** Closer than this to the last point and a fix adds nothing a driver could see. */
        const val MIN_STEP_METRES = 10.0

        const val MAX_LOCAL_POINTS = 1_500
        const val MAX_POINTS = 3_000
    }
}
