package com.saarthi.owner.ui.trips

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** The trips read so far, and whether older ones are still to fetch. */
private data class TripBook(
    val items: List<TripsApi.Trip>,
    val page: Int,
    val hasMore: Boolean,
    val total: Int,
    val loadingMore: Boolean = false,
)

/**
 * Every trip a vehicle has run, newest first, a page at a time — the web's
 * vehicle history, reaching back as far as the server keeps. A trip opens on
 * its map.
 */
@Composable
fun VehicleTripsScreen(app: OwnerApp, vehicle: VehiclesApi.Vehicle) {
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<Loadable<TripBook>>(Loadable.Loading) }
    var moreError by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }

    LaunchedEffect(vehicle.id, reload) {
        state = Loadable.Loading
        moreError = null
        state = try {
            val first = app.trips.forVehicle(vehicle.id, page = 1)
            Loadable.Ready(TripBook(first.items, 1, first.pagination.hasNextPage, first.pagination.total))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            Loadable.Failed(error.readable())
        }
    }

    fun loadMore() {
        val book = (state as? Loadable.Ready)?.value ?: return
        if (!book.hasMore || book.loadingMore) return
        state = Loadable.Ready(book.copy(loadingMore = true))
        moreError = null
        scope.launch {
            state = try {
                val next = app.trips.forVehicle(vehicle.id, page = book.page + 1)
                Loadable.Ready(
                    book.copy(
                        // A trip started since the first page shifts the rest along by one.
                        items = book.items + next.items.filter { new -> book.items.none { it.id == new.id } },
                        page = book.page + 1,
                        hasMore = next.pagination.hasNextPage,
                        total = next.pagination.total,
                    ),
                )
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                moreError = error.readable()
                Loadable.Ready(book)
            }
        }
    }

    val book = (state as? Loadable.Ready)?.value
    DetailScreen(
        eyebrow = listOfNotNull(
            formatPlate(vehicle.registrationNumber),
            book?.total?.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.net_trips_count, it, it) },
        ).joinToString(" · "),
        title = stringResource(R.string.net_trips_trips),
    ) {
        when (val shown = state) {
            Loadable.Loading -> SkeletonCards(count = 3, modifier = Modifier.rise())
            is Loadable.Failed -> FailedCard(shown.message, onRetry = { reload++ }, modifier = Modifier.rise())
            is Loadable.Ready -> {
                val trips = shown.value
                if (trips.items.isEmpty()) {
                    NoticeCard(
                        stringResource(R.string.net_trips_vehicle_empty),
                        NoticeTone.INFO,
                        icon = Lucide.route,
                        modifier = Modifier.rise(),
                    )
                }
                trips.items.forEachIndexed { index, trip ->
                    TripRow(
                        trip,
                        onOpen = { navigator.push("trip-${trip.id}") { TripScreen(app, trip) } },
                        modifier = Modifier.rise(stagger(index.coerceAtMost(4))),
                    )
                }
                moreError?.let { NoticeCard(stringResource(R.string.net_trips_older_failed, it), NoticeTone.WARNING) }
                if (trips.hasMore) {
                    SaarthiButton(
                        stringResource(R.string.net_trips_show_older),
                        onClick = ::loadMore,
                        busy = trips.loadingMore,
                        busyText = stringResource(R.string.net_trips_loading),
                        tone = ButtonTone.SECONDARY,
                        height = 50.dp,
                    )
                }
            }
        }
    }
}
