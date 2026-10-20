package com.saarthi.owner.ui.costs

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.FuelApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.rememberPaged
import com.saarthi.owner.ui.common.MoreButton
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.FigureRow
import com.saarthi.owner.ui.common.FigureTile
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.km
import com.saarthi.owner.ui.common.prettyDate
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.common.shortCount
import com.saarthi.owner.ui.common.unitPrice
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.shell.LocalNavigator

/** Fuel: litres and spend over every fill-up logged, the average rate, and the fill-ups themselves. */
@Composable
internal fun FuelPanel(app: OwnerApp, access: CostAccess, vehicle: VehiclesApi.Vehicle?, changed: Int, onChanged: () -> Unit) {
    val navigator = LocalNavigator.current
    val paged = rememberPaged<FuelApi.FillUp, FuelApi.FuelPage>(
        key = "fuel-${vehicle?.id}-$changed",
        load = { page -> app.fuel.fillUps(vehicle?.id, page) },
        rowsOf = { it.items },
        hasMoreOf = { it.pagination.hasNextPage },
    )

    if (access.logFuel) {
        SaarthiButton(
            stringResource(R.string.costs_log_fill_up),
            onClick = { navigator.push("fill-up-${vehicle?.id}") { FillUpScreen(app, vehicle, onSaved = onChanged) } },
            tone = ButtonTone.SECONDARY,
            leading = Lucide.fuel,
            height = 48.dp,
        )
    }
    when (val first = paged.first) {
        Loadable.Loading -> SkeletonCards(count = 2)
        is Loadable.Failed -> FailedCard(first.message, paged.retry)
        is Loadable.Ready -> {
            val totals = first.value.totals
            FigureRow {
                FigureTile(stringResource(R.string.costs_litres), shortCount(totals.litres), stringResource(R.string.costs_fuel_litres_unit), Modifier.weight(1f))
                FigureTile(stringResource(R.string.costs_fuel_spend), rupees(totals.cost), "", Modifier.weight(1.2f))
                FigureTile(stringResource(R.string.costs_fuel_avg_rate), totals.averagePricePerLitre?.let { "%.1f".format(it) } ?: "—", stringResource(R.string.costs_fuel_rate_unit), Modifier.weight(1f))
            }
            if (paged.rows.isEmpty()) Hint(stringResource(R.string.costs_fuel_none))
            paged.rows.forEach { fill ->
                CostRow(
                    title = stringResource(R.string.costs_fuel_fill_title, fill.quantityLitres, unitPrice(fill.pricePerUnit)),
                    detail = listOfNotNull(
                        formatPlate(fill.registrationNumber).takeIf { vehicle == null && fill.registrationNumber.isNotBlank() },
                        fill.stationName,
                        km(fill.odometerKm),
                        prettyDate(fill.recordedAt),
                    ).joinToString(" · ").ifBlank { null },
                    trailing = rupees(fill.totalCost),
                )
            }
            if (paged.hasMore) MoreButton(paged.loadingMore, paged.more)
        }
    }
}
