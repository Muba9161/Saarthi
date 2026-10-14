package com.saarthi.owner.ui.personal

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.papers.PaperRow
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

/** A paper beside the vehicle it belongs to. */
private data class VehiclePaper(val vehicle: VehiclesApi.Vehicle, val paper: PapersApi.Paper)

/**
 * "Your papers" — every vehicle's papers, the next to run out first. The
 * numbers are shown masked; the full papers stay in the web folders.
 */
@Composable
fun PersonalPapersScreen(app: OwnerApp) {
    val c = Saarthi.colors
    var state by remember { mutableStateOf<Loadable<List<VehiclePaper>>>(Loadable.Loading) }
    var filter by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        state = try {
            coroutineScope {
                val vehicles = app.vehicles.list()
                val all = vehicles.map { vehicle ->
                    async { runCatching { app.papers.forVehicle(vehicle.id) }.getOrDefault(emptyList()).map { VehiclePaper(vehicle, it) } }
                }.awaitAll().flatten()
                Loadable.Ready(all.sortedWith(compareByDescending<VehiclePaper> { it.paper.rejected }.thenBy { it.paper.daysRemaining ?: Int.MAX_VALUE }))
            }
        } catch (failure: Exception) {
            Loadable.Failed(failure.readable())
        }
    }

    val top = headerClearance()
    val bottom = tabBarClearance()
    when (val shown = state) {
        Loadable.Loading -> SkeletonCards(modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = top))
        is Loadable.Failed -> NoticeCard(shown.message, NoticeTone.WARNING, Modifier.padding(start = 20.dp, end = 20.dp, top = top))
        is Loadable.Ready -> {
            val vehicles = shown.value.map { it.vehicle }.distinctBy { it.id }
            val listed = shown.value.filter { filter == null || it.vehicle.id == filter }
            val worst = listed.firstOrNull { it.paper.expired || it.paper.rejected } ?: listed.firstOrNull { it.paper.dueSoon }
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = top, bottom = bottom),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                worst?.let { pick ->
                    item(key = "worst") {
                        NoticeCard(
                            if (pick.paper.rejected) {
                                "${pick.paper.documentTypeLabel} on ${formatPlate(pick.vehicle.registrationNumber)} was turned down. Upload it again from Saarthi on the web."
                            } else if (pick.paper.expired) {
                                "${pick.paper.documentTypeLabel} on ${formatPlate(pick.vehicle.registrationNumber)} has run out. Renew it before you drive."
                            } else {
                                "${pick.paper.documentTypeLabel} on ${formatPlate(pick.vehicle.registrationNumber)} runs out in ${pick.paper.daysRemaining} days. Renew it before it lapses."
                            },
                            if (pick.paper.expired || pick.paper.rejected) NoticeTone.DANGER else NoticeTone.WARNING,
                            Modifier.rise(),
                            icon = Lucide.alertTriangle,
                        )
                    }
                }
                if (vehicles.size > 1) {
                    item(key = "chips") {
                        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ChoiceChip("All · ${shown.value.size}", selected = filter == null, onClick = { filter = null })
                            vehicles.forEach { vehicle ->
                                ChoiceChip(
                                    "${formatPlate(vehicle.registrationNumber)} · ${shown.value.count { it.vehicle.id == vehicle.id }}",
                                    selected = filter == vehicle.id,
                                    onClick = { filter = vehicle.id },
                                )
                            }
                        }
                    }
                }
                if (listed.isEmpty()) {
                    item(key = "empty") { Text("No papers on file yet. Add them from Saarthi on the web.", style = SType.small, color = c.muted) }
                }
                items(listed, key = { it.paper.id }) { entry -> PaperRow(entry.paper, plate = entry.vehicle.registrationNumber) }
            }
        }
    }
}
