package com.saarthi.driver.ui.shift.trips

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.core.domain.TerminalState
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.Hint
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SegmentedControl
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.shift.headerClearance
import com.saarthi.driver.ui.shift.tabBarClearance
import kotlinx.coroutines.delay

/**
 * How long an empty list is treated as "still loading".
 *
 * `loadTrips` reports neither completion nor failure, and an empty answer
 * leaves the list as it was — so an empty list cannot say by itself whether it
 * is empty or not yet here. A list that arrives sooner replaces the skeleton at
 * once; after this the empty, offline or error state is shown.
 */
private const val FIRST_ANSWER_GRACE_MS = 2_000L

/** The design's segmented filter, in its order. */
private enum class TripFilter(@StringRes val label: Int) {
    ALL(R.string.trips_filter_all),
    FINISHED(R.string.trips_filter_finished),
    OPEN(R.string.trips_filter_open),
}

/**
 * Trips, decluttered: how far Saarthi has measured, the trip holding the
 * vehicle, the driver's own trips waiting behind it, and the trips finished —
 * with a filter between them and a way to add one.
 *
 * The fleet's trip always comes first and is highlighted: the server queues a
 * driver's trip behind it, and the screen shows that order rather than leaving
 * a driver to guess which of two trips to drive.
 *
 * Fetched when the tab appears, not polled: history does not change while a
 * driver is looking at it, and the trip holding the vehicle comes from the
 * dispatch the cockpit already keeps current. The header and the tab bar are
 * the shell's; this only leaves room for them.
 */
@Composable
fun TripsTab(
    cockpit: TerminalViewModel,
    onAddTrip: () -> Unit,
    onStart: (tripId: String) -> Unit,
    onStop: () -> Unit,
    onRemove: (tripId: String) -> Unit,
    onProblem: (String?) -> Unit,
) {
    val state by cockpit.uiState.collectAsState()
    val trips by cockpit.trips.collectAsState()
    val dispatch by cockpit.dispatch.collectAsState()
    val queue by cockpit.tripQueue.queue.collectAsState()
    val saving by cockpit.tripQueue.saving.collectAsState()
    var filter by rememberSaveable { mutableStateOf(TripFilter.ALL) }
    // An order the driver said "not now" to is not offered again; a different one is.
    var declined by rememberSaveable { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var settled by remember { mutableStateOf(false) }

    LaunchedEffect(attempt) {
        settled = false
        cockpit.loadTrips()
        delay(FIRST_ANSWER_GRACE_MS)
        settled = true
    }

    val active = state.state == TerminalState.TRIP_ACTIVE
    val sessionStartedAt = state.server?.session?.tripStartedAt
    val registration = state.registration
    val board = remember(trips, active, dispatch, sessionStartedAt, registration, queue) {
        tripsBoard(trips, active, dispatch, sessionStartedAt, registration, queue)
    }
    val fleetWaiting = board.current?.let { it.fromFleet && it.stage == TripStage.UP_NEXT } == true
    val controls = TripControls(
        window = when {
            active -> StartWindow.AFTER_CURRENT
            fleetWaiting -> StartWindow.FLEET_FIRST
            state.state.checklistOutstanding -> StartWindow.CHECK_FIRST
            else -> StartWindow.OPEN
        },
        onStart = onStart,
        onStop = onStop,
        onMove = { id, by -> cockpit.tripQueue.move(id, by, onProblem) },
        onRemove = onRemove,
        saving = saving,
    )
    val suggestion = queue?.suggestion?.takeIf { it.order.joinToString() != declined }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = headerClearance(), bottom = tabBarClearance()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val c = Saarthi.colors
        val retry = { attempt += 1 }
        SaarthiButton(
            stringResource(R.string.trips_add),
            onAddTrip,
            Modifier.rise(distance = TripsRise),
            tone = ButtonTone.SECONDARY,
            leading = Lucide.plus,
            height = 48.dp,
        )
        if (suggestion != null && board.queued.size > 1) {
            ShorterOrderCard(
                suggestion = suggestion,
                stops = suggestion.order.mapNotNull { id -> board.queued.firstOrNull { it.id == id }?.destination },
                saving = saving,
                onUse = { cockpit.tripQueue.acceptSuggestion(onProblem) },
                onDismiss = { declined = suggestion.order.joinToString() },
                modifier = Modifier.rise(distance = TripsRise),
            )
        }
        when {
            !board.isEmpty -> TripsBoardContent(
                board = board,
                filter = filter,
                onFilter = { filter = it },
                controls = controls,
                checkDue = state.state.checklistOutstanding,
            )
            trips.isEmpty() && state.offline -> TripsStateCard(
                Lucide.cloudOff,
                well = c.warningSoft,
                ink = c.warning,
                title = stringResource(R.string.trips_offline_title),
                body = stringResource(R.string.trips_offline_body),
                modifier = Modifier.rise(distance = TripsRise),
                onRetry = retry,
            )
            trips.isEmpty() && !settled -> TripsSkeleton()
            trips.isEmpty() && state.error != null -> TripsStateCard(
                Lucide.alertTriangle,
                well = c.dangerSoft,
                ink = c.danger,
                title = stringResource(R.string.trips_error_title),
                body = stringResource(R.string.trips_error_body),
                modifier = Modifier.rise(distance = TripsRise),
                onRetry = retry,
            )
            else -> TripsStateCard(
                Lucide.route,
                well = c.primarySoft,
                ink = c.primary,
                title = stringResource(R.string.trips_empty_title),
                body = stringResource(R.string.trips_empty_body),
                modifier = Modifier.rise(distance = TripsRise),
            )
        }
    }
}

/**
 * The summary, the filter and the two sections, in the design's order.
 *
 * Under "All" a section with nothing in it is left out; picking that section
 * on the filter says plainly that it is empty instead of showing a blank.
 */
@Composable
private fun TripsBoardContent(
    board: TripsBoard,
    filter: TripFilter,
    onFilter: (TripFilter) -> Unit,
    controls: TripControls,
    checkDue: Boolean,
) {
    if (board.finished.isNotEmpty()) TripsSummary(board)

    SegmentedControl(
        options = TripFilter.entries.map { stringResource(it.label) },
        selected = filter.ordinal,
        onSelect = { onFilter(TripFilter.entries[it]) },
        height = 36.dp,
        radius = 14.dp,
        textStyle = SType.chip,
        modifier = Modifier.rise(80, TripsRise),
    )

    if (filter == TripFilter.OPEN || (filter == TripFilter.ALL && board.hasOpen)) {
        val current = board.current
        // A heading over nothing is left out: with only the driver's queue, its own heading leads.
        if (current != null || board.queued.isEmpty()) {
            SectionLabel(
                if (current?.stage == TripStage.UP_NEXT) R.string.trips_section_next else R.string.trips_section_open,
                delayMs = 120,
            )
        }
        if (current != null) {
            OpenTripCard(current, Modifier.rise(140, TripsRise)) {
                when {
                    current.stage == TripStage.UNDER_WAY -> StopAction(controls.onStop)
                    current.id != null -> QueuedActions(
                        // Before the safety check, Start opens it — see the shell.
                        canStart = true,
                        onStart = { controls.onStart(current.id) },
                        onUp = null,
                        onDown = null,
                    )
                }
            }
            if (current.stage == TripStage.UP_NEXT && checkDue) {
                StartWindowHint(StartWindow.CHECK_FIRST, Modifier.rise(145, TripsRise))
            }
        } else if (board.queued.isEmpty()) {
            Hint(stringResource(R.string.trips_none_open), Modifier.rise(140, TripsRise))
        }
        if (board.queued.isNotEmpty()) {
            SectionLabel(
                if (current == null) R.string.trips_section_yours else R.string.trips_section_queued,
                delayMs = 150,
            )
            StartWindowHint(controls.window, Modifier.rise(155, TripsRise))
            board.queued.forEachIndexed { index, trip ->
                val id = trip.id ?: return@forEachIndexed
                key(id) {
                    OpenTripCard(trip, Modifier.rise(160, TripsRise)) {
                        QueuedActions(
                            canStart = controls.window == StartWindow.OPEN || controls.window == StartWindow.CHECK_FIRST,
                            onStart = { controls.onStart(id) },
                            onUp = if (index > 0 && !controls.saving) ({ controls.onMove(id, -1) }) else null,
                            onDown = if (index < board.queued.lastIndex && !controls.saving) ({ controls.onMove(id, 1) }) else null,
                            onRemove = if (!controls.saving) ({ controls.onRemove(id) }) else null,
                        )
                    }
                }
            }
        }
    }

    if (filter == TripFilter.FINISHED || (filter == TripFilter.ALL && board.finished.isNotEmpty())) {
        SectionLabel(R.string.trips_section_finished, delayMs = 180)
        if (board.finished.isNotEmpty()) {
            FinishedList(board.finished, Modifier.rise(200, TripsRise))
        } else {
            Hint(stringResource(R.string.trips_none_finished), Modifier.rise(200, TripsRise))
        }
    }
}

/** "UNDER WAY", "FINISHED" — set a little apart from what is above. */
@Composable
private fun SectionLabel(@StringRes text: Int, delayMs: Int) {
    Eyebrow(
        stringResource(text),
        Modifier
            .padding(start = 4.dp, end = 4.dp, top = 8.dp)
            .rise(delayMs, TripsRise),
    )
}
