package com.saarthi.owner.ui.trips

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.DriversApi
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.InlineSpinner
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.fleet.VehicleOption
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.launch

/** Steps never offered as a button: cancelling has its own, and an emergency is raised by SOS. */
private val NOT_A_BUTTON = setOf("CANCELLED", "EMERGENCY")

/** The button for moving a trip to [status]. */
private fun stepWord(status: String): String = when (status) {
    "ASSIGNED" -> Words.get(R.string.net_trips_step_assigned)
    "LOADING" -> Words.get(R.string.net_trips_step_loading)
    "STARTED" -> Words.get(R.string.net_trips_step_started)
    "IN_TRANSIT" -> Words.get(R.string.net_trips_step_in_transit)
    "DELAYED" -> Words.get(R.string.net_trips_step_delayed)
    "SUSPENDED" -> Words.get(R.string.net_trips_step_suspended)
    "ARRIVED" -> Words.get(R.string.net_trips_step_arrived)
    "UNLOADING" -> Words.get(R.string.net_trips_step_unloading)
    "COMPLETED" -> Words.get(R.string.net_trips_step_completed)
    else -> status.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
}

/** What just happened, once a step has gone through. */
internal fun stepDoneWord(status: String): String = when (status) {
    "ASSIGNED" -> Words.get(R.string.net_trips_done_assigned)
    "LOADING" -> Words.get(R.string.net_trips_done_loading)
    "STARTED" -> Words.get(R.string.net_trips_done_started)
    "IN_TRANSIT" -> Words.get(R.string.net_trips_done_in_transit)
    "DELAYED" -> Words.get(R.string.net_trips_done_delayed)
    "SUSPENDED" -> Words.get(R.string.net_trips_done_suspended)
    "ARRIVED" -> Words.get(R.string.net_trips_done_arrived)
    "UNLOADING" -> Words.get(R.string.net_trips_done_unloading)
    "COMPLETED" -> Words.get(R.string.net_trips_done_completed)
    "CANCELLED" -> Words.get(R.string.net_trips_done_cancelled)
    else -> Words.get(R.string.net_trips_done_other)
}

/**
 * Moving a trip on from the owner's phone, for when the driver cannot: the
 * next steps the server allows — at most three, as on the web's trip page —
 * and, before it leaves, a different vehicle or driver, or cancelling it.
 */
@Composable
internal fun TripActions(
    trip: TripsApi.Trip,
    busy: Boolean,
    onStep: (String) -> Unit,
    onReassign: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    var confirmingCancel by remember { mutableStateOf(false) }
    val steps = trip.allowedTransitions.filterNot { it in NOT_A_BUTTON }.take(3)
    // A trip carrying a customer's order is never cancelled here: the server cancels the order with it.
    val canCancel = trip.beforeDeparture && trip.order == null && "CANCELLED" in trip.allowedTransitions
    if (steps.isEmpty() && !trip.beforeDeparture) return

    Column(modifier.fillMaxWidth().card(radius = 22.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(R.string.net_trips_move_on), style = SType.cardTitle, color = c.fg)
        steps.forEachIndexed { index, status ->
            SaarthiButton(
                stepWord(status),
                onClick = { onStep(status) },
                tone = if (index == 0) ButtonTone.PRIMARY else ButtonTone.SECONDARY,
                enabled = !busy,
                busy = busy && index == 0,
                leading = if (status == "COMPLETED") Lucide.check else Lucide.play,
            )
        }
        if (trip.beforeDeparture) {
            if (confirmingCancel) {
                Text(stringResource(R.string.net_trips_cancel_confirm), style = SType.small, color = c.fg)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SaarthiButton(stringResource(R.string.net_trips_keep), onClick = { confirmingCancel = false }, tone = ButtonTone.SECONDARY, modifier = Modifier.weight(1f))
                    SaarthiButton(
                        stringResource(R.string.net_trips_cancel),
                        onClick = { confirmingCancel = false; onCancel() },
                        tone = ButtonTone.DANGER_OUTLINE,
                        enabled = !busy,
                        modifier = Modifier.weight(1f),
                    )
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    LinkButton(stringResource(R.string.net_trips_change_crew), onClick = onReassign, style = SType.smallStrong, enabled = !busy)
                    if (canCancel) LinkButton(stringResource(R.string.net_trips_cancel), onClick = { confirmingCancel = true }, style = SType.smallStrong, color = c.danger, enabled = !busy)
                }
            }
        }
    }
}

/** The vehicles and drivers a trip that has not left can be given instead. */
private class Choices(val vehicles: List<VehiclesApi.Vehicle>, val drivers: List<DriversApi.Driver>)

/**
 * Another vehicle or driver for a trip before it leaves — the web's reassign.
 * Only free vehicles and verified, unassigned drivers are offered, plus the
 * ones the trip already has. Placed beside the page, not in it.
 */
@Composable
internal fun ReassignTripSheet(app: OwnerApp, trip: TripsApi.Trip, visible: Boolean, onDismiss: () -> Unit, onDone: (TripsApi.Trip) -> Unit) {
    var opening by remember { mutableIntStateOf(0) }
    var wasVisible by remember { mutableStateOf(false) }
    if (visible && !wasVisible) opening++
    wasVisible = visible
    BottomSheet(visible = visible, onDismiss = onDismiss) {
        key(opening) { ReassignForm(app, trip, onDone) }
    }
}

@Composable
private fun ReassignForm(app: OwnerApp, trip: TripsApi.Trip, onDone: (TripsApi.Trip) -> Unit) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<Loadable<Choices>>(Loadable.Loading) }
    var vehicleId by remember { mutableStateOf(trip.truck?.id) }
    var driverId by remember { mutableStateOf(trip.driver?.id) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        state = try {
            val vehicles = async { app.vehicles.list() }
            val drivers = async { app.drivers.assignable() }
            Loadable.Ready(
                Choices(
                    vehicles.await().filter { it.freeForWork || it.id == trip.truck?.id },
                    drivers.await(),
                ),
            )
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            Loadable.Failed(failure.readable())
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(stringResource(R.string.net_trips_change_crew), style = SType.sheetTitle, color = c.fg)
        when (val shown = state) {
            Loadable.Loading -> InlineSpinner(c.primary)
            is Loadable.Failed -> NoticeCard(shown.message, NoticeTone.WARNING)
            is Loadable.Ready -> {
                GroupLabel(stringResource(R.string.net_trips_vehicle))
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    shown.value.vehicles.forEach { vehicle ->
                        VehicleOption(vehicle, selected = vehicle.id == vehicleId) { vehicleId = vehicle.id }
                    }
                }
                GroupLabel(stringResource(R.string.net_trips_driver))
                val drivers = buildList {
                    trip.driver?.let { add(it.id to it.name) }
                    shown.value.drivers.filter { it.id != trip.driver?.id }.forEach { add(it.id to it.fullName) }
                }
                if (drivers.isEmpty()) {
                    Text(stringResource(R.string.net_trips_no_free_driver), style = SType.small, color = c.muted)
                }
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    drivers.forEach { (id, name) -> ChoiceChip(name, selected = driverId == id, onClick = { driverId = id }) }
                }
                problem?.let { NoticeCard(it, NoticeTone.DANGER) }
                val changed = vehicleId != trip.truck?.id || driverId != trip.driver?.id
                SaarthiButton(
                    stringResource(R.string.net_trips_save),
                    onClick = {
                        busy = true
                        problem = null
                        scope.launch {
                            try {
                                app.trips.reassign(
                                    trip.id,
                                    truckId = vehicleId.takeIf { it != trip.truck?.id },
                                    driverId = driverId.takeIf { it != trip.driver?.id },
                                )?.let(onDone)
                            } catch (failure: Exception) {
                                if (failure is CancellationException) throw failure
                                problem = failure.readable()
                            } finally {
                                busy = false
                            }
                        }
                    },
                    enabled = changed && vehicleId != null && !busy,
                    busy = busy,
                    busyText = stringResource(R.string.net_trips_saving),
                )
            }
        }
    }
}
