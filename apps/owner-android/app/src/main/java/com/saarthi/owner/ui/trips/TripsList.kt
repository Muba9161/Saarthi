package com.saarthi.owner.ui.trips

import androidx.annotation.StringRes
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.InlineSpinner
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SaarthiField
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The list's filters, as the web's trips page offers them. */
private enum class TripFilter(@StringRes val label: Int, val statuses: List<String>) {
    RUNNING(R.string.net_trips_filter_running, TripsApi.ACTIVE),
    COMPLETED(R.string.net_trips_filter_completed, listOf("COMPLETED")),
    CANCELLED(R.string.net_trips_filter_cancelled, listOf("CANCELLED")),
    ALL(R.string.net_trips_filter_all, emptyList()),
}

/** How long typing must pause before the list is asked again. */
private const val SEARCH_PAUSE_MS = 350L

/** Every trip of the business, opened from Home's trips figure. */
@Composable
fun TripsScreen(app: OwnerApp, account: SessionStore.Account) {
    DetailScreen(eyebrow = stringResource(R.string.net_trips_fleet), title = stringResource(R.string.net_trips_trips), spacing = 12.dp) {
        TripsListContent(app, account)
    }
}

/**
 * The business's trips, newest first, a page at a time: running ones first by
 * default, a search over references and places, and — for an account that may
 * — a new trip. Laid out as plain content, for a page or a tab to scroll.
 */
@Composable
fun TripsListContent(app: OwnerApp, account: SessionStore.Account) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var filter by rememberSaveable { mutableStateOf(TripFilter.RUNNING) }
    var search by rememberSaveable { mutableStateOf("") }
    var reload by remember { mutableIntStateOf(0) }
    var trips by remember { mutableStateOf<List<TripsApi.Trip>?>(null) }
    var page by remember { mutableIntStateOf(1) }
    var more by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val canManage = account.can(TripsApi.CAN_MANAGE)

    LaunchedEffect(filter, search, reload) {
        if (search.isNotEmpty()) delay(SEARCH_PAUSE_MS)
        failure = null
        try {
            val first = app.trips.list(page = 1, search = search, statuses = filter.statuses)
            trips = first.items
            page = 1
            more = first.pagination.hasNextPage
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            failure = error.readable()
        }
    }

    fun loadMore() {
        loadingMore = true
        scope.launch {
            try {
                val next = app.trips.list(page = page + 1, search = search, statuses = filter.statuses)
                trips = trips.orEmpty() + next.items.filter { item -> trips.orEmpty().none { it.id == item.id } }
                page += 1
                more = next.pagination.hasNextPage
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                failure = error.readable()
            } finally {
                loadingMore = false
            }
        }
    }

    fun open(trip: TripsApi.Trip) = navigator.push("trip-${trip.id}") { TripScreen(app, trip) }

    if (canManage) {
        SaarthiButton(
            stringResource(R.string.net_trips_new_trip),
            onClick = {
                navigator.push("new-trip") {
                    NewTripScreen(app, account, vehicle = null) { created ->
                        reload++
                        navigator.replace("trip-${created.id}") { TripScreen(app, created) }
                    }
                }
            },
            leading = Lucide.plus,
        )
    }
    SaarthiField(
        value = search,
        onValueChange = { search = it.take(120) },
        leading = Lucide.search,
        placeholder = stringResource(R.string.net_trips_search_placeholder),
    )
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TripFilter.entries.forEach { option ->
            ChoiceChip(stringResource(option.label), selected = filter == option, onClick = { filter = option })
        }
    }

    val shown = trips
    when {
        shown == null && failure != null -> FailedCard(failure!!, onRetry = { reload++ })
        shown == null -> SkeletonCards(count = 3)
        shown.isEmpty() -> Text(
            when {
                search.isNotBlank() -> stringResource(R.string.net_trips_no_match, search)
                filter == TripFilter.RUNNING -> stringResource(R.string.net_trips_none_running)
                else -> stringResource(R.string.net_trips_none_yet)
            },
            style = SType.small,
            color = c.muted,
            modifier = Modifier.padding(top = 12.dp),
        )
        else -> {
            shown.forEach { trip ->
                key(trip.id) { TripRow(trip, onOpen = { open(trip) }, showVehicle = true) }
            }
            failure?.let { Text(it, style = SType.small, color = c.danger) }
            if (more) {
                if (loadingMore) InlineSpinner(c.primary) else LinkButton(stringResource(R.string.net_trips_show_more), onClick = ::loadMore)
            }
        }
    }
}
