package com.saarthi.owner.ui.trips

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Context
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.DriversApi
import com.saarthi.owner.network.PlacesApi
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.PlaceField
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.NotesField
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.fleet.VehicleOption
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// Made on each use, so the month and day names follow the app\'s language when it changes.
private val WhenLabel: DateTimeFormatter get() = DateTimeFormatter.ofPattern("d MMM, h:mm a")

/** The vehicles a trip can go on now, and the drivers who can take one. */
private class TripChoices(val vehicles: List<VehiclesApi.Vehicle>, val drivers: List<DriversApi.Driver>)

/**
 * A new trip, as the web's create-trip dialog makes one: a free vehicle, its
 * driver or another verified one, where it goes from and to — the phone's own
 * location one tap away — and, if known, when, for how much, and a note.
 * The server plans the road between the two places.
 */
@Composable
fun NewTripScreen(app: OwnerApp, account: SessionStore.Account, vehicle: VehiclesApi.Vehicle?, onCreated: (TripsApi.Trip) -> Unit) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<Loadable<TripChoices>>(Loadable.Loading) }
    var attempt by remember { mutableIntStateOf(0) }
    var vehicleId by remember { mutableStateOf(vehicle?.id) }
    var driverId by remember { mutableStateOf(vehicle?.currentDriver?.id) }
    var from by remember { mutableStateOf<PlacesApi.Place?>(null) }
    var to by remember { mutableStateOf<PlacesApi.Place?>(null) }
    var leaves by remember { mutableStateOf<LocalDateTime?>(null) }
    var arrives by remember { mutableStateOf<LocalDateTime?>(null) }
    var price by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(attempt) {
        state = Loadable.Loading
        state = try {
            val vehicles = async { app.vehicles.list() }
            val drivers = async { app.drivers.assignable() }
            Loadable.Ready(TripChoices(vehicles.await().filter { it.freeForWork || it.id == vehicle?.id }, drivers.await()))
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            Loadable.Failed(failure.readable())
        }
    }

    val chosenVehicle = (state as? Loadable.Ready)?.value?.vehicles?.firstOrNull { it.id == vehicleId }
    // The vehicle's own driver is the default, as the server takes it when none is named.
    LaunchedEffect(vehicleId) {
        if (driverId == null) driverId = chosenVehicle?.currentDriver?.id
    }

    val amount = price.trim().takeIf { it.isNotEmpty() }?.toDoubleOrNull()
    val priceProblem = price.isNotBlank() && (amount == null || amount < 0)
    val leaving = leaves
    val arriving = arrives
    val timesProblem = leaving != null && arriving != null && !arriving.isAfter(leaving)
    val ready = vehicleId != null && driverId != null && from != null && to != null && !priceProblem && !timesProblem

    DetailScreen(
        eyebrow = stringResource(R.string.net_trips_trips),
        title = stringResource(R.string.net_trips_new_trip),
        footer = {
            problem?.let { NoticeCard(it, NoticeTone.DANGER) }
            SaarthiButton(
                stringResource(R.string.net_trips_create),
                onClick = {
                    val start = from ?: return@SaarthiButton
                    val end = to ?: return@SaarthiButton
                    busy = true
                    problem = null
                    scope.launch {
                        try {
                            app.trips.create(
                                TripsApi.NewTrip(
                                    truckId = vehicleId!!,
                                    driverId = driverId,
                                    from = start.asTripPlace(),
                                    to = end.asTripPlace(),
                                    leavesAt = leaves?.atZone(ZoneId.systemDefault())?.toInstant(),
                                    arrivesBy = arrives?.atZone(ZoneId.systemDefault())?.toInstant(),
                                    price = amount,
                                    notes = notes,
                                ),
                            )?.let(onCreated)
                        } catch (failure: Exception) {
                            if (failure is CancellationException) throw failure
                            problem = failure.readable()
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = ready && !busy,
                busy = busy,
                busyText = stringResource(R.string.net_trips_creating),
            )
        },
    ) {
        when (val shown = state) {
            Loadable.Loading -> SkeletonCards(count = 2)
            is Loadable.Failed -> FailedCard(shown.message, onRetry = { attempt++ })
            is Loadable.Ready -> {
                GroupLabel(stringResource(R.string.net_trips_vehicle))
                if (shown.value.vehicles.isEmpty()) {
                    Text(stringResource(R.string.net_trips_no_free_vehicle), style = SType.small, color = c.muted)
                }
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    shown.value.vehicles.forEach { option ->
                        VehicleOption(option, selected = option.id == vehicleId) {
                            vehicleId = option.id
                            driverId = option.currentDriver?.id ?: driverId
                        }
                    }
                }

                GroupLabel(stringResource(R.string.net_trips_driver))
                val ownDriver = chosenVehicle?.currentDriver?.let { it.id to stringResource(R.string.net_trips_driver_this_vehicle, it.name) }
                val drivers = buildList {
                    ownDriver?.let { add(it) }
                    shown.value.drivers.filter { d -> none { it.first == d.id } }.forEach { add(it.id to it.fullName) }
                }
                if (drivers.isEmpty()) {
                    Text(stringResource(R.string.net_trips_no_free_driver_assign), style = SType.small, color = c.muted)
                }
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    drivers.forEach { (id, name) -> ChoiceChip(name, selected = driverId == id, onClick = { driverId = id }) }
                }

                PlaceField(stringResource(R.string.net_trips_pick_up_from), from, app.places, onPick = { from = it }, icon = Lucide.navigation)
                PlaceField(stringResource(R.string.net_trips_drop_at), to, app.places, onPick = { to = it })

                WhenRow(stringResource(R.string.net_trips_leaves), leaves, onPick = { leaves = it }, onClear = { leaves = null })
                WhenRow(stringResource(R.string.net_trips_arrives_by), arrives, onPick = { arrives = it }, onClear = { arrives = null })
                if (timesProblem) Text(stringResource(R.string.net_trips_arrival_before_leaving), style = SType.small, color = c.danger)

                CompactField(
                    price,
                    { typed -> price = typed.filter { it.isDigit() || it == '.' }.take(12) },
                    stringResource(R.string.net_trips_rate_field),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                if (priceProblem) Text(stringResource(R.string.net_trips_rate_not_number), style = SType.small, color = c.danger)
                NotesField(notes, { notes = it.take(2000) }, label = stringResource(R.string.net_trips_notes_field), minHeight = 80.dp)
            }
        }
    }
}

private fun PlacesApi.Place.asTripPlace() = TripsApi.Place(label = name, address = address, city = city, latitude = latitude, longitude = longitude)

/** A day and time from the phone's own pickers; optional, so it can be cleared. */
@Composable
private fun WhenRow(label: String, value: LocalDateTime?, onPick: (LocalDateTime) -> Unit, onClear: () -> Unit) {
    val c = Saarthi.colors
    val context = LocalContext.current
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 14.dp, color = c.elevated, ring = c.input, elevated = false)
            .pressable(scale = 0.99f, label = label) { pickDateTime(context, value ?: LocalDateTime.now(), onPick) }
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        LineIcon(Lucide.calendar, size = 18.dp, color = c.primary)
        Text(stringResource(R.string.net_trips_optional, label), style = SType.small, color = c.muted, modifier = Modifier.weight(1f))
        if (value != null) {
            Text(WhenLabel.format(value), style = SType.smallStrong, color = c.fg)
            LinkButton(stringResource(R.string.net_trips_clear), onClick = onClear, style = SType.smallStrong, color = c.muted)
        } else {
            Text(stringResource(R.string.net_trips_choose), style = SType.smallStrong, color = c.subtle)
        }
    }
}

private fun pickDateTime(context: Context, start: LocalDateTime, onPick: (LocalDateTime) -> Unit) {
    DatePickerDialog(
        context,
        { _, year, month, day ->
            TimePickerDialog(
                context,
                { _, hour, minute -> onPick(LocalDateTime.of(year, month + 1, day, hour, minute)) },
                start.hour,
                start.minute,
                false,
            ).show()
        },
        start.year,
        start.monthValue - 1,
        start.dayOfMonth,
    ).apply {
        datePicker.minDate = System.currentTimeMillis() - 60_000
    }.show()
}
