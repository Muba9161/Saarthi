package com.saarthi.owner.ui.drive

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.drive.DrivingService
import com.saarthi.owner.network.DrivingApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.LiveDot
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.tracking.attempt

/** The person's own driver profile and the vehicle it is assigned to, when they drive one. */
private class Driving(val driverId: String, val vehicle: VehiclesApi.Vehicle)

/**
 * The way into Drive mode, on Home, for an owner who is their vehicle's driver
 * ("Assign myself" on the vehicle's page). Nothing at all for anyone else.
 */
@Composable
fun DriveCard(app: OwnerApp, account: SessionStore.Account, modifier: Modifier = Modifier) {
    if (!account.can(DrivingApi.CAN_DRIVE)) return
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val driving by produceState<Driving?>(null, account.userId) {
        value = attempt {
            val me = app.drivers.mine() ?: return@attempt null
            app.vehicles.list().firstOrNull { it.currentDriver?.id == me.id }?.let { Driving(me.id, it) }
        }
    }
    val recording by DrivingService.running.collectAsStateWithLifecycle()
    val mine = driving ?: return

    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp, ring = if (recording) c.success else c.ring)
            .pressable(scale = 0.99f, label = stringResource(R.string.costs_drive_open)) {
                navigator.push("drive") { DriveScreen(app, account, mine.vehicle, mine.driverId) }
            }
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(Lucide.navigation, well = c.primarySoft, ink = c.primary, size = 40.dp, radius = 12.dp, iconSize = 18.dp)
        Column(Modifier.weight(1f)) {
            Eyebrow(stringResource(R.string.costs_drive_title))
            Text(stringResource(R.string.costs_drive_you_drive, formatPlate(mine.vehicle.registrationNumber)), style = SType.rowTitle, color = c.fg)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (recording) LiveDot(c.success, size = 7.dp)
                Text(
                    stringResource(if (recording) R.string.costs_drive_card_recording else R.string.costs_drive_card_tools),
                    style = SType.caption,
                    color = c.muted,
                )
            }
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}
