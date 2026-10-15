package com.saarthi.owner.ui.personal

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.papers.PapersWallet

/**
 * "Your papers": one vehicle's folders at a time, with a chip per vehicle when
 * there is more than one. The same wallet a vehicle's own Papers screen shows,
 * so the two can never disagree.
 */
@Composable
fun PersonalPapersScreen(app: OwnerApp) {
    val c = Saarthi.colors
    var attempt by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Loadable<List<VehiclesApi.Vehicle>>>(Loadable.Loading) }
    var picked by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(attempt) {
        state = Loadable.Loading
        state = try {
            Loadable.Ready(app.vehicles.list())
        } catch (failure: Exception) {
            Loadable.Failed(failure.readable())
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = headerClearance(), bottom = tabBarClearance()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        when (val shown = state) {
            Loadable.Loading -> SkeletonCards()
            is Loadable.Failed -> FailedCard(shown.message, { attempt++ })
            is Loadable.Ready -> {
                val vehicles = shown.value
                val vehicle = vehicles.firstOrNull { it.id == picked } ?: vehicles.firstOrNull()
                if (vehicle == null) {
                    Text("No vehicle on this account yet. Add one from Saarthi on the web.", style = SType.body, color = c.muted)
                    return@Column
                }
                if (vehicles.size > 1) {
                    Row(
                        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).rise(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        vehicles.forEach { each ->
                            ChoiceChip(formatPlate(each.registrationNumber), selected = each.id == vehicle.id, onClick = { picked = each.id })
                        }
                    }
                }
                PapersWallet(app, vehicle)
            }
        }
    }
}
