package com.saarthi.owner.ui.customer

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.Page
import com.saarthi.owner.network.TravelPackagesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.common.MoreButton
import com.saarthi.owner.ui.common.rememberPaged
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiField
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.delay

/** How the list is ordered, as the web's "Sort by". */
private val SORTS: List<Pair<String, String>>
    get() = listOf(
        "createdAt" to Words.get(R.string.customer_sort_newest),
        "price" to Words.get(R.string.customer_sort_price),
        "rating" to Words.get(R.string.customer_sort_rating),
        "duration" to Words.get(R.string.customer_sort_shortest),
    )

/**
 * Ready-made trips from verified travel operators — the web's /travel: search
 * where to, the kind of trip and the order, then a trip to read and book.
 */
@Composable
fun PackagesScreen(app: OwnerApp, onBooked: () -> Unit) {
    val navigator = LocalNavigator.current
    var typed by rememberSaveable { mutableStateOf("") }
    var search by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf<String?>(null) }
    var sort by rememberSaveable { mutableStateOf("createdAt") }
    // The search follows the typing, a moment after it stops.
    LaunchedEffect(typed) {
        delay(SEARCH_AFTER_MS)
        search = typed
    }
    val paged = rememberPaged<TravelPackagesApi.Package, Page<TravelPackagesApi.Package>>(
        key = "packages-$search-$kind-$sort",
        load = { page -> app.travelPackages.packages(search, kind, null, sort, page) },
        rowsOf = { it.items },
        hasMoreOf = { it.pagination.hasNextPage },
    )

    DetailScreen(eyebrow = stringResource(R.string.customer_travel), title = stringResource(R.string.customer_book_a_trip)) {
        SaarthiField(
            value = typed,
            onValueChange = { typed = it.take(160) },
            label = stringResource(R.string.customer_packages_where_to),
            leading = Lucide.search,
            placeholder = stringResource(R.string.customer_packages_where_hint),
        )
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ChoiceChip(stringResource(R.string.customer_packages_all), selected = kind == null, onClick = { kind = null }, height = 36.dp)
            TravelPackagesApi.KINDS.forEach { (value, label) -> ChoiceChip(label, selected = kind == value, onClick = { kind = value }, height = 36.dp) }
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.customer_packages_sort), style = SType.small, color = Saarthi.colors.muted)
            SORTS.forEach { (value, label) -> ChoiceChip(label, selected = sort == value, onClick = { sort = value }, height = 32.dp) }
        }
        when (val first = paged.first) {
            Loadable.Loading -> SkeletonCards(count = 3)
            is Loadable.Failed -> FailedCard(first.message, paged.retry)
            is Loadable.Ready -> {
                if (paged.rows.isEmpty()) {
                    Hint(stringResource(if (search.isBlank() && kind == null) R.string.customer_packages_none else R.string.customer_packages_no_match))
                }
                paged.rows.forEach { trip ->
                    PackageCard(trip) { navigator.push("package-${trip.id}") { PackageScreen(app, trip.id, onBooked) } }
                }
                if (paged.hasMore) MoreButton(paged.loadingMore, paged.more)
            }
        }
    }
}

/** One trip in the list, as the web's card has it. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PackageCard(trip: TravelPackagesApi.Package, onOpen: () -> Unit) {
    val c = Saarthi.colors
    Column(
        Modifier.fillMaxWidth().card(radius = 22.dp).pressable(scale = 0.99f, label = stringResource(R.string.customer_open, trip.title), onClick = onOpen).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusPill(TravelPackagesApi.kindWord(trip.serviceKind), background = c.primaryWash, ink = c.primary, dot = false)
            if (trip.ratingCount > 0) Text("★ %.1f (%d)".format(trip.ratingAverage, trip.ratingCount), style = SType.smallStrong, color = c.warning)
        }
        Text(trip.title, style = SType.bodyStrong, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (trip.summary.isNotBlank()) Text(trip.summary, style = SType.small, color = c.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(
            listOf(
                pluralStringResource(R.plurals.customer_trip_days, trip.durationDays, trip.durationDays),
                stringResource(R.string.customer_up_to, trip.maxPassengers),
                stringResource(R.string.customer_from_place, trip.startLocation),
            ).joinToString(" · "),
            style = SType.caption,
            color = c.muted,
        )
        if (trip.destinations.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                trip.destinations.take(MAX_PLACES).forEach { StatusPill(it, background = c.sunken, ink = c.muted, dot = false) }
            }
        }
        Row(verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                Text(trip.provider?.displayName.orEmpty(), style = SType.caption, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (trip.provider?.verificationStatus == "VERIFIED") Text(stringResource(R.string.customer_verified_operator), style = SType.caption, color = c.success)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(stringResource(if (trip.pricingModel == "PER_PERSON") R.string.customer_from_per_person else R.string.customer_from), style = SType.caption, color = c.subtle)
                Text(rupees(trip.fromPrice), style = SType.headerTitle, color = c.fg)
            }
        }
        Text(stringResource(R.string.customer_no_booking_fee), style = SType.caption, color = c.subtle, modifier = Modifier.padding(top = 2.dp))
    }
}

private const val MAX_PLACES = 4
private const val SEARCH_AFTER_MS = 450L
