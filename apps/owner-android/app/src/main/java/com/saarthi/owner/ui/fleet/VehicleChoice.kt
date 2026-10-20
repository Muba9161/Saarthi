package com.saarthi.owner.ui.fleet

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.R
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable

/**
 * One vehicle to choose for new work — a bid, a trip: its plate, what it is,
 * and whether it is free, busy (and why) or has nobody to drive it.
 */
@Composable
internal fun VehicleOption(vehicle: VehiclesApi.Vehicle, selected: Boolean, onPick: () -> Unit) {
    val c = Saarthi.colors
    val free = vehicle.freeForWork
    Column(
        Modifier
            .card(radius = 18.dp, ring = if (selected) c.primary else c.ring, color = if (selected) c.primaryWash else c.card)
            .pressable(scale = 0.97f, onClick = onPick)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        PlateChip(vehicle.registrationNumber, size = 12.sp)
        Text(
            listOfNotNull(
                vehicle.categoryLabel ?: vehicle.typeLabel.ifBlank { null },
                when {
                    !free -> vehicle.busyWord
                    vehicle.currentDriver == null -> stringResource(R.string.fleet_choice_no_driver)
                    else -> stringResource(R.string.fleet_choice_free_now)
                },
            ).joinToString(" · "),
            style = SType.caption,
            color = if (free) c.muted else c.warning,
            maxLines = 1,
        )
    }
}
