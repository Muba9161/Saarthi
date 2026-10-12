package com.saarthi.core.data

import com.saarthi.core.domain.haversineMetres
import com.saarthi.core.network.FuelPriceDto
import com.saarthi.core.telemetry.Position
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Today's pump price where the vehicle is, kept current as it moves.
 *
 * The card used to ask once, when Home appeared, and never again. Three ways
 * that went wrong on the road:
 *
 *  * Home opened before the first GPS fix, so there was no position to ask
 *    with and the card said "loading" for the rest of the shift.
 *  * One failed lookup — a slow publisher, a tunnel — was the answer for the
 *    rest of the shift: "No rate for Kanpur" in a city that has one.
 *  * A truck that left Lucknow in the morning showed Lucknow's rate in Kanpur.
 *
 * So the feed waits for a fix, asks, and asks again when the vehicle has moved
 * far enough to be somewhere else, when the answer has gone stale, or — sooner
 * — when there was no answer at all.
 */
class FuelPriceFeed(
    private val scope: CoroutineScope,
    private val positions: Flow<Position?>,
    private val fetch: suspend (Position) -> Result<FuelPriceDto?>,
) {

    private val _price = MutableStateFlow<FuelPriceDto?>(null)
    val price: StateFlow<FuelPriceDto?> = _price.asStateFlow()

    private var job: Job? = null

    /** Start, or ask again now if already running. */
    fun refresh() {
        job?.cancel()
        job = scope.launch { follow() }
    }

    fun stop() {
        job?.cancel()
        job = null
        _price.value = null
    }

    private suspend fun follow() {
        while (true) {
            val at = positions.filterNotNull().first()
            val answer = fetch(at)
            answer.onSuccess { _price.value = it }

            val priced = answer.getOrNull()?.hasAnyRate() == true
            withTimeoutOrNull(if (priced) REFRESH_MS else RETRY_MS) {
                positions.filterNotNull().first { moved(at, it) > MOVED_METRES }
            }
        }
    }

    private fun moved(from: Position, to: Position): Double =
        haversineMetres(from.latitude, from.longitude, to.latitude, to.longitude)

    private fun FuelPriceDto.hasAnyRate(): Boolean =
        diesel != null || petrol != null || cng != null

    private companion object {
        /** Rates revise once a day; this only catches the morning revision. */
        const val REFRESH_MS = 45 * 60_000L

        /** No rate, or no answer: worth another try soon, not every frame. */
        const val RETRY_MS = 3 * 60_000L

        /** Roughly the width of a district town — far enough to be priced elsewhere. */
        const val MOVED_METRES = 8_000.0
    }
}
