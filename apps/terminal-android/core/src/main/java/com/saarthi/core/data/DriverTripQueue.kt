package com.saarthi.core.data

import com.saarthi.core.network.TripQueueDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The driver's own trips waiting to start, and the moves that reorder them.
 *
 * The server owns the order — and re-links a chained trip's start when the
 * order changes — so every move is saved at once and the screen takes the
 * server's answer. The new order is shown before that answer arrives, because
 * a card that jumps back for a second after being moved reads as a refusal.
 */
class DriverTripQueue(
    private val scope: CoroutineScope,
    private val shift: ShiftRepository,
    /**
     * After the server changed which trip is next — reordered, or one removed —
     * so the screens showing the trip holding the vehicle (Home's "Your trip")
     * re-read it instead of waiting for the next poll.
     */
    private val onChanged: () -> Unit = {},
) {

    private val _queue = MutableStateFlow<TripQueueDto?>(null)
    val queue: StateFlow<TripQueueDto?> = _queue.asStateFlow()

    private val _saving = MutableStateFlow(false)
    val saving: StateFlow<Boolean> = _saving.asStateFlow()

    fun load() {
        scope.launch { shift.tripQueue().onSuccess { _queue.value = it } }
    }

    /** Move one trip [by] places — -1 up, +1 down. [onProblem] hears the server's refusal, if any. */
    fun move(tripId: String, by: Int, onProblem: (String?) -> Unit) {
        val ids = _queue.value?.trips?.map { it.id }?.toMutableList() ?: return
        val from = ids.indexOf(tripId)
        val to = from + by
        if (from < 0 || to !in ids.indices) return
        ids.add(to, ids.removeAt(from))
        order(ids, onProblem)
    }

    /** Run them in the shorter order the server suggested. */
    fun acceptSuggestion(onProblem: (String?) -> Unit) {
        val order = _queue.value?.suggestion?.order ?: return
        order(order, onProblem)
    }

    /** Take one of the driver's own trips off their queue. */
    fun remove(tripId: String, onDone: (Result<Unit>) -> Unit) {
        if (_saving.value) return
        _saving.value = true
        scope.launch {
            val result = shift.removeTrip(tripId)
            result.onSuccess {
                _queue.value = it
                onChanged()
            }
            _saving.value = false
            onDone(result.map { })
        }
    }

    private fun order(ids: List<String>, onProblem: (String?) -> Unit) {
        if (_saving.value) return
        _saving.value = true
        _queue.update { queue ->
            queue?.copy(
                trips = ids.mapNotNull { id -> queue.trips.firstOrNull { it.id == id } }
                    .mapIndexed { index, trip -> trip.copy(position = index + 1) },
                suggestion = null,
            )
        }
        scope.launch {
            shift.orderTrips(ids)
                .onSuccess {
                    _queue.value = it
                    onChanged()
                }
                .onFailure { problem ->
                    load()
                    onProblem(problem.message)
                }
            _saving.value = false
        }
    }
}
