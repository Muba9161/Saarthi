package com.saarthi.owner.ui.jobs

import androidx.annotation.StringRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.OrdersApi
import com.saarthi.owner.network.RequirementsApi
import com.saarthi.owner.network.RequirementsApi.Companion.KIND_CAB
import com.saarthi.owner.network.RequirementsApi.Companion.KIND_FREIGHT
import com.saarthi.owner.network.RequirementsApi.Companion.KIND_MATERIAL
import com.saarthi.owner.network.RequirementsApi.Companion.KIND_TOUR
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rememberPhoto
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.SegmentedControl
import com.saarthi.owner.ui.orders.FleetOrderScreen
import com.saarthi.owner.ui.orders.OrderRow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.trips.TripsListContent
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private const val REFRESH_MS = 60_000L

/** The board and the fleet's own orders, read and kept fresh. */
class JobsModel(private val requirements: RequirementsApi, private val ordersApi: OrdersApi) : ViewModel() {
    private val _state = MutableStateFlow<Loadable<List<RequirementsApi.Requirement>>>(Loadable.Loading)
    val state: StateFlow<Loadable<List<RequirementsApi.Requirement>>> = _state.asStateFlow()

    private val _orders = MutableStateFlow<Loadable<List<OrdersApi.Order>>>(Loadable.Loading)
    val orders: StateFlow<Loadable<List<OrdersApi.Order>>> = _orders.asStateFlow()

    init {
        refresh()
    }

    fun refresh(silent: Boolean = false) {
        if (!silent) _state.value = Loadable.Loading
        viewModelScope.launch {
            _state.value = try {
                Loadable.Ready(requirements.board())
            } catch (error: Exception) {
                if (silent && _state.value is Loadable.Ready) return@launch
                Loadable.Failed(error.readable())
            }
        }
        viewModelScope.launch {
            _orders.value = try {
                Loadable.Ready(ordersApi.list())
            } catch (error: Exception) {
                if (silent && _orders.value is Loadable.Ready) return@launch
                Loadable.Failed(error.readable())
            }
        }
    }
}

/** What a kind of job is called on a chip, and drawn as. */
private enum class JobKind(val kind: String?, @StringRes val label: Int) {
    ALL(null, R.string.market_jobs_kind_all),
    MATERIAL(KIND_MATERIAL, R.string.market_jobs_kind_material),
    FREIGHT(KIND_FREIGHT, R.string.market_jobs_kind_freight),
    CAB(KIND_CAB, R.string.market_jobs_kind_cab),
    TOUR(KIND_TOUR, R.string.market_jobs_kind_tour),
}

/**
 * "Bid on work" — the jobs customers have posted on this business's routes,
 * soonest to close first. The design's Jobs board.
 *
 * A material job is bid by sourcing it from a seller and delivering it; the
 * customer never deals with the seller. Freight and passenger jobs are bid
 * with a vehicle and a price.
 */
@Composable
fun JobsScreen(app: OwnerApp, account: SessionStore.Account, withOrders: Boolean = true) {
    val model = viewModel { JobsModel(app.requirements, app.orders) }
    val state by model.state.collectAsStateWithLifecycle()
    val orders by model.orders.collectAsStateWithLifecycle()
    var section by rememberSaveable { mutableIntStateOf(SECTION_JOBS) }
    var filter by rememberSaveable { mutableStateOf(JobKind.ALL) }
    val navigator = LocalNavigator.current

    LaunchedEffect(Unit) {
        while (true) {
            delay(REFRESH_MS)
            model.refresh(silent = true)
        }
    }

    val top = headerClearance()
    val bottom = tabBarClearance()
    if (section == SECTION_TRIPS) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, top = top, bottom = bottom),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            JobsSwitch(section) { section = it }
            TripsListContent(app, account)
        }
        return
    }
    if (section == SECTION_ORDERS) {
        OrdersList(
            orders = orders,
            switcher = { JobsSwitch(section) { section = it } },
            onRetry = { model.refresh() },
            onOpen = { order -> navigator.push("order-${order.id}") { FleetOrderScreen(app, order) } },
            top = top,
            bottom = bottom,
        )
        return
    }
    when (val shown = state) {
        Loadable.Loading -> SkeletonCards(modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = top))
        is Loadable.Failed -> FailedCard(shown.message, { model.refresh() }, Modifier.padding(start = 20.dp, end = 20.dp, top = top))
        is Loadable.Ready -> {
            val jobs = shown.value
            val counts = jobs.groupingBy { it.kind }.eachCount()
            val listed = jobs.filter { filter.kind == null || it.kind == filter.kind }
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = top, bottom = bottom),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (withOrders) item(key = "switch") { JobsSwitch(section) { section = it } }
                if (counts.size > 1) item(key = "chips") {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .rise(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        JobKind.entries.forEach { kind ->
                            val count = if (kind.kind == null) jobs.size else counts[kind.kind] ?: 0
                            if (kind.kind == null || count > 0) {
                                ChoiceChip("${stringResource(kind.label)} · $count", selected = filter == kind, onClick = { filter = kind })
                            }
                        }
                    }
                }
                if (listed.isEmpty()) {
                    item(key = "empty") {
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .padding(top = 48.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            IconWell(Lucide.briefcase, well = Saarthi.colors.sunken, ink = Saarthi.colors.muted, size = 64.dp, shape = CircleShape, iconSize = 26.dp)
                            Text(stringResource(R.string.market_jobs_empty_title), style = SType.cardTitle, color = Saarthi.colors.fg)
                            Text(
                                stringResource(R.string.market_jobs_empty_body),
                                style = SType.small,
                                color = Saarthi.colors.muted,
                            )
                        }
                    }
                }
                items(listed, key = { it.id }) { job ->
                    JobCard(job, Modifier.rise(stagger(1))) {
                        navigator.push("bid-${job.id}") { BidScreen(app, account, job, onPlaced = { model.refresh(silent = true) }) }
                    }
                }
            }
        }
    }
}

/** How a kind of job is badged and pictured. */
@Composable
private fun kindLook(kind: String): Triple<String, Color, Color> {
    val c = Saarthi.colors
    return when (kind) {
        KIND_MATERIAL -> Triple(stringResource(R.string.market_jobs_kind_material), c.accentSoft, c.accent)
        KIND_FREIGHT -> Triple(stringResource(R.string.market_jobs_kind_freight), c.primarySoft, c.primary)
        KIND_CAB -> Triple(stringResource(R.string.market_jobs_kind_cab), c.infoSoft, c.info)
        else -> Triple(stringResource(R.string.market_jobs_kind_tour), c.successSoft, c.success)
    }
}

private fun photoFor(kind: String): Int = when (kind) {
    KIND_MATERIAL -> R.drawable.vehicle_tipper
    KIND_FREIGHT -> R.drawable.vehicle_truck
    KIND_CAB -> R.drawable.vehicle_sedan
    else -> R.drawable.vehicle_bus
}

@Composable
private fun JobCard(job: RequirementsApi.Requirement, modifier: Modifier = Modifier, onBid: () -> Unit) {
    val c = Saarthi.colors
    val (word, ground, ink) = kindLook(job.kind)
    val hours = job.hoursLeft()
    val mine = job.myBid
    Column(
        modifier
            .fillMaxWidth()
            .card(radius = 24.dp, ring = if (mine == null && job.kind == KIND_MATERIAL) c.primaryRing else c.ring)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    Modifier
                        .clip(CircleShape)
                        .background(ground)
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                ) {
                    Text(
                        if (hours != null) stringResource(R.string.market_jobs_closes_in, word, if (hours < 1) "<1" else hours.toString()) else stringResource(R.string.market_jobs_bidding_closed, word),
                        style = SType.captionStrong,
                        color = ink,
                    )
                }
                Text(
                    "${job.what} → ${job.destinationCity ?: job.destinationAddress?.substringBefore(',') ?: job.originCity ?: job.originAddress.substringBefore(',')}",
                    style = SType.cardTitle.copy(fontSize = SType.headerTitle.fontSize),
                    color = c.fg,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            val photo = rememberPhoto(photoFor(job.kind))
            if (photo != null) {
                Image(photo, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.size(width = 96.dp, height = 52.dp))
            }
        }
        Text(
            listOfNotNull(
                job.route.takeIf { job.kind != KIND_MATERIAL },
                job.specification?.ifBlank { null },
                clockOf(job.startAt)?.let { stringResource(R.string.market_jobs_needed_lower, it) },
            ).joinToString(" · "),
            style = SType.small,
            color = c.muted,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill(if (job.bidCount == 0) stringResource(R.string.market_jobs_no_bids) else pluralStringResource(R.plurals.market_jobs_bids_so_far, job.bidCount, job.bidCount), c.sunken, c.fg)
            job.distanceToOriginKm?.let { Pill(stringResource(R.string.market_jobs_km_away, it.toInt()), c.sunken, c.muted) }
            mine?.let { Pill(stringResource(R.string.market_jobs_your_bid_amount, rupees(it.price)), c.successBg, c.success) }
        }
        SaarthiButton(
            text = when {
                mine != null -> stringResource(R.string.market_jobs_see_your_bid)
                job.kind == KIND_MATERIAL -> stringResource(R.string.market_jobs_check_sellers_bid)
                job.kind == KIND_FREIGHT -> stringResource(R.string.market_jobs_bid_freight)
                else -> stringResource(R.string.market_jobs_quote_trip)
            },
            onClick = onBid,
            tone = if (mine != null || job.kind != KIND_MATERIAL) ButtonTone.SECONDARY else ButtonTone.PRIMARY,
            height = 50.dp,
            enabled = hours != null || mine != null,
        )
    }
}

/** Open jobs, the orders already won, or the trips running them. */
@Composable
private fun JobsSwitch(section: Int, onChange: (Int) -> Unit) {
    SegmentedControl(
        options = listOf(stringResource(R.string.market_jobs_section_open), stringResource(R.string.market_jobs_section_orders), stringResource(R.string.market_jobs_section_trips)),
        selected = section,
        onSelect = onChange,
        modifier = Modifier.rise(),
    )
}

private const val SECTION_JOBS = 0
private const val SECTION_ORDERS = 1
private const val SECTION_TRIPS = 2

@Composable
private fun OrdersList(
    orders: Loadable<List<OrdersApi.Order>>,
    switcher: @Composable () -> Unit,
    onRetry: () -> Unit,
    onOpen: (OrdersApi.Order) -> Unit,
    top: androidx.compose.ui.unit.Dp,
    bottom: androidx.compose.ui.unit.Dp,
) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = top, bottom = bottom),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(key = "switch") { switcher() }
        when (orders) {
            Loadable.Loading -> item(key = "loading") { SkeletonCards(count = 2) }
            is Loadable.Failed -> item(key = "failed") { FailedCard(orders.message, onRetry) }
            is Loadable.Ready -> {
                val (open, done) = orders.value.partition { it.open }
                if (orders.value.isEmpty()) {
                    item(key = "empty") {
                        Text(
                            stringResource(R.string.market_jobs_orders_empty),
                            style = SType.small,
                            color = Saarthi.colors.muted,
                            modifier = Modifier.padding(top = 24.dp),
                        )
                    }
                }
                if (open.isNotEmpty()) item(key = "open-label") { GroupLabel(stringResource(R.string.market_jobs_in_progress)) }
                items(open, key = { it.id }) { order -> OrderRow(order, order.customerName, order.totalPrice, onOpen = { onOpen(order) }) }
                if (done.isNotEmpty()) item(key = "done-label") { GroupLabel(stringResource(R.string.market_jobs_earlier)) }
                items(done, key = { it.id }) { order -> OrderRow(order, order.customerName, order.totalPrice, onOpen = { onOpen(order) }) }
            }
        }
    }
}

@Composable
internal fun Pill(text: String, ground: Color, ink: Color) {
    Box(
        Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(ground)
            .padding(horizontal = 10.dp, vertical = 5.dp),
    ) {
        Text(text, style = SType.captionStrong, color = ink, maxLines = 1)
    }
}
