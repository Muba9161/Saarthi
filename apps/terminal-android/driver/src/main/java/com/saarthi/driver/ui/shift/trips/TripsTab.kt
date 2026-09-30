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
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.Hint
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
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
 * Trips, decluttered: how far Saarthi has measured, the trip on the road now,
 * and the trips finished — with a filter between them and nothing else.
 *
 * Fetched when the tab appears, not polled: history does not change while a
 * driver is looking at it, and the trip under way comes from the dispatch the
 * cockpit already keeps current. The header and the tab bar are the shell's;
 * this only leaves room for them.
 */
@Composable
fun TripsTab(cockpit: TerminalViewModel) {
    val state by cockpit.uiState.collectAsState()
    val trips by cockpit.trips.collectAsState()
    val dispatch by cockpit.dispatch.collectAsState()
    var filter by rememberSaveable { mutableStateOf(TripFilter.ALL) }
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
    val board = remember(trips, active, dispatch, sessionStartedAt, registration) {
        tripsBoard(trips, active, dispatch, sessionStartedAt, registration)
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = headerClearance(), bottom = tabBarClearance()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val c = Saarthi.colors
        val retry = { attempt += 1 }
        when {
            !board.isEmpty -> TripsBoardContent(board, filter, onFilter = { filter = it })
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
private fun TripsBoardContent(board: TripsBoard, filter: TripFilter, onFilter: (TripFilter) -> Unit) {
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

    val open = board.open
    if (filter == TripFilter.OPEN || (filter == TripFilter.ALL && open != null)) {
        SectionLabel(R.string.trips_section_open, delayMs = 120)
        if (open != null) {
            OpenTripCard(open, Modifier.rise(140, TripsRise))
        } else {
            Hint(stringResource(R.string.trips_none_open), Modifier.rise(140, TripsRise))
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
