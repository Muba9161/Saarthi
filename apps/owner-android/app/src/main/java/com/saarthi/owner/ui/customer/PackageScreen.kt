package com.saarthi.owner.ui.customer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.TravelPackagesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.FigureRow
import com.saarthi.owner.ui.common.FigureTile
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.CancellationException

/**
 * One trip, as the web's package page has it: how long, in what, for how
 * many, the route, the days, what is and is not included, the refunds if it
 * is cancelled, the operator — and the way to book it.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun PackageScreen(app: OwnerApp, packageId: String, onBooked: () -> Unit) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val account = app.session.account.value
    val canBook = account?.can(TravelPackagesApi.CAN_BOOK) == true
    var attempt by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Loadable<TravelPackagesApi.Package>>(Loadable.Loading) }
    LaunchedEffect(packageId, attempt) {
        state = try {
            app.travelPackages.get(packageId)?.let { Loadable.Ready(it) } ?: Loadable.Failed(Words.get(R.string.customer_package_gone))
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            Loadable.Failed(failure.readable())
        }
    }
    val trip = (state as? Loadable.Ready)?.value

    DetailScreen(
        eyebrow = trip?.let { TravelPackagesApi.kindWord(it.serviceKind) } ?: stringResource(R.string.customer_travel),
        title = trip?.title ?: stringResource(R.string.customer_trip),
        footer = if (trip != null && canBook) {
            {
                SaarthiButton(
                    stringResource(R.string.customer_package_book),
                    onClick = { navigator.push("book-${trip.id}") { BookTripScreen(app, trip, onBooked) } },
                    leading = Lucide.calendar,
                )
            }
        } else {
            null
        },
    ) {
        when (val shown = state) {
            Loadable.Loading -> SkeletonCards(count = 3)
            is Loadable.Failed -> FailedCard(shown.message, { attempt++ })
            is Loadable.Ready -> {
                val t = shown.value
                FigureRow {
                    FigureTile(
                        stringResource(R.string.customer_days),
                        t.durationDays.toString(),
                        t.durationNights?.let { stringResource(R.string.customer_package_nights, it) }.orEmpty(),
                        Modifier.weight(1f),
                    )
                    FigureTile(stringResource(R.string.customer_package_seats), "${t.minPassengers}–${t.maxPassengers}", "", Modifier.weight(1f))
                    FigureTile(
                        stringResource(if (t.pricingModel == "PER_PERSON") R.string.customer_per_person else R.string.customer_from),
                        rupees(t.fromPrice),
                        "",
                        Modifier.weight(1.2f),
                    )
                }
                Column(Modifier.fillMaxWidth().card(radius = 20.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Eyebrow(stringResource(R.string.customer_package_route))
                    Text(listOfNotNull(t.startLocation, *t.destinations.toTypedArray(), t.endLocation?.takeIf { it != t.startLocation }).distinct().joinToString(" → "), style = SType.body, color = c.fg)
                    Text(
                        listOfNotNull(
                            TravelPackagesApi.vehicleWord(t.vehicleType) + (t.vehicle?.model?.let { " · $it" } ?: ""),
                            t.approxDistanceKm?.let { stringResource(R.string.customer_package_about_km, "%,d".format(it.toLong())) },
                            if (t.driverIncluded) stringResource(R.string.customer_package_driver_included) else null,
                            if (t.fuelIncluded) stringResource(R.string.customer_package_fuel_included) else null,
                        ).joinToString(" · "),
                        style = SType.caption,
                        color = c.muted,
                    )
                }
                t.description?.ifBlank { null }?.let {
                    GroupLabel(stringResource(R.string.customer_package_about))
                    Text(it, style = SType.body, color = c.fg)
                }
                if (t.itinerary.isNotEmpty()) {
                    GroupLabel(stringResource(R.string.customer_package_day_by_day))
                    t.itinerary.forEach { day ->
                        Column(Modifier.fillMaxWidth().card(radius = 18.dp).padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(stringResource(R.string.customer_package_day_title, day.dayNumber, day.title), style = SType.bodyStrong, color = c.fg)
                            day.description?.ifBlank { null }?.let { Text(it, style = SType.small, color = c.muted) }
                            if (day.highlights.isNotEmpty()) Text(day.highlights.joinToString(" · "), style = SType.caption, color = c.subtle)
                            day.overnightAt?.let { Text(stringResource(R.string.customer_package_night_at, it), style = SType.caption, color = c.subtle) }
                        }
                    }
                }
                if (t.inclusions.isNotEmpty() || t.exclusions.isNotEmpty()) {
                    GroupLabel(stringResource(R.string.customer_package_covers))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        t.inclusions.forEach { StatusPill("✓ $it", background = c.successBg, ink = c.success, dot = false) }
                        t.exclusions.forEach { StatusPill("✕ $it", background = c.sunken, ink = c.muted, dot = false) }
                    }
                }
                t.cancellationPolicy?.takeIf { it.isNotEmpty() }?.let { tiers ->
                    GroupLabel(stringResource(R.string.customer_package_if_cancel))
                    tiers.sortedByDescending { it.hoursBefore }.forEach { tier ->
                        Text(stringResource(R.string.customer_package_refund_tier, tier.hoursBefore, tier.refundPercent), style = SType.small, color = c.muted)
                    }
                }
                GroupLabel(stringResource(R.string.customer_package_operated_by))
                Text(t.provider?.displayName ?: stringResource(R.string.customer_the_operator), style = SType.bodyStrong, color = c.fg)
                Text(
                    t.provider?.takeIf { it.ratingCount > 0 }?.let {
                        pluralStringResource(R.plurals.customer_package_reviews, it.ratingCount, "%.1f".format(it.ratingAverage), it.ratingCount)
                    } ?: stringResource(R.string.customer_package_no_reviews),
                    style = SType.small,
                    color = c.muted,
                )
                if (!canBook) Hint(stringResource(R.string.customer_package_customers_only))
            }
        }
    }
}
