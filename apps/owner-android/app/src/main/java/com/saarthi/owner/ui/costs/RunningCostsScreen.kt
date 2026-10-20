package com.saarthi.owner.ui.costs

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.SegmentedControl

/**
 * Running costs — the web's tabs of the same name: fuel, servicing, the slips
 * drivers file, loans and EMIs, and tolls with FASTags. For the whole fleet,
 * or for one [vehicle] when opened from its page. Each tab shows only when the
 * person's role and the business's plan allow it, as on the web.
 */
@Composable
fun RunningCostsScreen(app: OwnerApp, account: SessionStore.Account, vehicle: VehiclesApi.Vehicle? = null, start: CostTab? = null) {
    val access = remember(account) { CostAccess(account) }
    val tabs = access.tabs
    var tab by rememberSaveable { mutableStateOf(start?.takeIf { it in tabs } ?: tabs.firstOrNull()) }
    // Bumped when something is logged from a pushed form, so the open tab reads again.
    var changed by remember { mutableIntStateOf(0) }
    val onChanged: () -> Unit = { changed++ }

    DetailScreen(
        eyebrow = vehicle?.let { formatPlate(it.registrationNumber) } ?: stringResource(R.string.costs_whole_fleet),
        title = stringResource(R.string.costs_running_costs),
    ) {
        val shown = tab
        if (shown == null) {
            Hint(stringResource(R.string.costs_not_in_plan))
            return@DetailScreen
        }
        if (tabs.size > 1) {
            SegmentedControl(options = tabs.map { it.label }, selected = tabs.indexOf(shown), onSelect = { tab = tabs[it] }, height = 44.dp)
        }
        when (shown) {
            CostTab.FUEL -> FuelPanel(app, access, vehicle, changed, onChanged)
            CostTab.SERVICING -> ServicingPanel(app, access, vehicle, changed, onChanged)
            CostTab.SLIPS -> SlipsPanel(app, access, vehicle, changed, onChanged)
            CostTab.LOANS -> LoansPanel(app, access, vehicle, changed, onChanged)
            CostTab.TOLL -> TollPanel(app, access, vehicle)
        }
    }
}
