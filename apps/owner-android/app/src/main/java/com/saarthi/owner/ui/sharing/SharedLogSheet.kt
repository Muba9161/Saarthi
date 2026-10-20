package com.saarthi.owner.ui.sharing

import android.app.DatePickerDialog
import androidx.annotation.StringRes
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
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
import com.saarthi.owner.network.PlacesApi
import com.saarthi.owner.network.ServicingApi
import com.saarthi.owner.ui.common.PlaceField
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.costs.ReadBill
import com.saarthi.owner.ui.costs.ReadFillUp
import com.saarthi.owner.ui.costs.SlipText
import com.saarthi.owner.ui.costs.typed
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NotesField
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SegmentedControl
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.papers.SlipKind
import com.saarthi.owner.ui.papers.SlipStep
import com.saarthi.owner.ui.papers.rememberSlipReader
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch

/** What a person a vehicle is shared with can log against it. */
enum class LogKind(@StringRes val title: Int, @StringRes val action: Int) {
    TRIP(R.string.people_log_trip_title, R.string.people_log_trip_action),
    FUEL(R.string.people_log_fuel_title, R.string.people_log_fuel_action),
    SERVICE(R.string.people_log_service_title, R.string.people_log_service_action),
}

// Made on each use, so the month and day names follow the app\'s language when it changes.
private val DayFormat: DateTimeFormatter get() = DateTimeFormatter.ofPattern("EEE d MMM yyyy")
private val Decimal = KeyboardOptions(keyboardType = KeyboardType.Decimal)

/**
 * One sheet for the three logs, each the web's form cut to a phone: the server
 * decides what is valid and its reason is shown as it says it.
 */
@Composable
internal fun SharedLogSheet(app: OwnerApp, shareId: String, kind: LogKind?, onDismiss: () -> Unit, onSaved: () -> Unit) {
    // The last form stays drawn while the sheet slides away, rather than the sheet emptying first.
    val shown = remember { mutableStateOf<LogKind?>(null) }
    if (kind != null) shown.value = kind
    BottomSheet(visible = kind != null, onDismiss = onDismiss) {
        // Keyed on each opening, so a form never remembers what was typed last time.
        key(kind) {
            when (shown.value) {
                LogKind.TRIP -> TripForm(app, shareId, onSaved)
                LogKind.FUEL -> FuelForm(app, shareId, onSaved)
                LogKind.SERVICE -> ServiceForm(app, shareId, onSaved)
                null -> Unit
            }
        }
    }
}

/** A form's saving: whether it is under way, the server's refusal if any, and how to start it. */
private class Saving(val busy: Boolean, val problem: String?, val run: (suspend () -> Unit) -> Unit)

/** A form's own trouble before saving — a photo that would not open. */
private class Trouble {
    var message by mutableStateOf<String?>(null)
}

/** Runs a save, keeping a refusal under the form instead of closing it. */
@Composable
private fun rememberSaving(onSaved: () -> Unit): Saving {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    return Saving(busy, problem) { save ->
        busy = true
        problem = null
        scope.launch {
            try {
                save()
                onSaved()
            } catch (failure: Exception) {
                problem = failure.readable()
            } finally {
                busy = false
            }
        }
    }
}

@Composable
private fun FormFrame(@StringRes title: Int, problem: String?, content: @Composable () -> Unit) {
    val c = Saarthi.colors
    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(stringResource(title), style = SType.sheetTitle, color = c.fg)
        content()
        problem?.let { NoticeCard(it, NoticeTone.DANGER) }
    }
}

@Composable
private fun TripForm(app: OwnerApp, shareId: String, onSaved: () -> Unit) {
    var from by remember { mutableStateOf<PlacesApi.Place?>(null) }
    var to by remember { mutableStateOf<PlacesApi.Place?>(null) }
    var notes by remember { mutableStateOf("") }
    val saving = rememberSaving(onSaved)
    FormFrame(LogKind.TRIP.title, saving.problem) {
        PlaceField(stringResource(R.string.people_log_from), from, app.places, onPick = { from = it })
        PlaceField(stringResource(R.string.people_log_to), to, app.places, onPick = { to = it }, icon = Lucide.flag)
        NotesField(notes, { notes = it.take(2000) }, label = stringResource(R.string.people_log_notes_optional), minHeight = 64.dp)
        SaarthiButton(
            stringResource(R.string.people_log_save_trip),
            onClick = { saving.run { app.sharing.addTrip(shareId, from!!, to!!, notes.trim()) } },
            enabled = from != null && to != null && !saving.busy,
            busy = saving.busy,
            busyText = stringResource(R.string.people_saving),
        )
    }
}

@Composable
private fun FuelForm(app: OwnerApp, shareId: String, onSaved: () -> Unit) {
    val c = Saarthi.colors
    var litres by remember { mutableStateOf("") }
    var price by remember { mutableStateOf("") }
    var odometer by remember { mutableStateOf("") }
    var station by remember { mutableStateOf("") }
    val saving = rememberSaving(onSaved)
    val trouble = remember { Trouble() }
    // The pump slip fills the litres, the rate, the odometer and the pump.
    val slip = rememberSlipReader({ SlipText.fillUp(it) }, ReadFillUp(), onProblem = { trouble.message = it }) { found ->
        trouble.message = null
        found.litres?.let { litres = it.typed() }
        found.rate?.let { price = it.typed() }
        found.odometerKm?.let { odometer = it.toLong().toString() }
        found.station?.let { station = it }
    }
    val l = litres.toDoubleOrNull()
    val p = price.toDoubleOrNull()
    FormFrame(LogKind.FUEL.title, saving.problem ?: trouble.message) {
        SlipStep(slip, SlipKind.PUMP_SLIP, good = { it.foundAnything })
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CompactField(litres, { litres = it.take(8) }, stringResource(R.string.people_log_litres), Modifier.weight(1f), keyboardOptions = Decimal)
            CompactField(price, { price = it.take(8) }, stringResource(R.string.people_log_price_per_litre), Modifier.weight(1f), keyboardOptions = Decimal)
        }
        if (l != null && p != null && l > 0 && p > 0) {
            Text(stringResource(R.string.people_log_total, rupees(l * p)), style = SType.bodyStrong, color = c.fg)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CompactField(odometer, { odometer = it.take(9) }, stringResource(R.string.people_log_odometer_optional), Modifier.weight(1f), keyboardOptions = Decimal)
            CompactField(station, { station = it.take(160) }, stringResource(R.string.people_log_station_optional), Modifier.weight(1f))
        }
        SaarthiButton(
            stringResource(R.string.people_log_save_fuel),
            onClick = { saving.run { app.sharing.addFuel(shareId, l!!, p!!, odometer.toDoubleOrNull(), station.trim()) } },
            enabled = (l ?: 0.0) > 0 && (p ?: 0.0) > 0 && !saving.busy && !slip.reading,
            busy = saving.busy,
            busyText = stringResource(R.string.people_saving),
        )
    }
}

@Composable
private fun ServiceForm(app: OwnerApp, shareId: String, onSaved: () -> Unit) {
    val c = Saarthi.colors
    val context = LocalContext.current
    var type by remember { mutableStateOf("PREVENTIVE") }
    var done by remember { mutableStateOf(true) }
    var title by remember { mutableStateOf("") }
    var day by remember { mutableStateOf(LocalDate.now()) }
    var cost by remember { mutableStateOf("") }
    var odometer by remember { mutableStateOf("") }
    var workshop by remember { mutableStateOf("") }
    val saving = rememberSaving(onSaved)
    val trouble = remember { Trouble() }
    // Work done is read off its bill, work booked off the estimate: the cost, the workshop, the kind of work.
    val bill = rememberSlipReader({ SlipText.bill(it) }, ReadBill(), onProblem = { trouble.message = it }) { found ->
        trouble.message = null
        found.total?.let { cost = it.typed() }
        if (done) found.date?.let { day = it }
        found.workshop?.let { workshop = it }
        found.odometerKm?.let { odometer = it.toLong().toString() }
        found.type?.let { kind ->
            type = kind
            if (title.isBlank()) title = ServicingApi.typeWord(kind)
        }
    }
    FormFrame(LogKind.SERVICE.title, saving.problem ?: trouble.message) {
        SegmentedControl(
            options = listOf(stringResource(R.string.people_log_done_already), stringResource(R.string.people_log_booked)),
            selected = if (done) 0 else 1,
            onSelect = { done = it == 0 },
            height = 44.dp,
        )
        SlipStep(bill, if (done) SlipKind.BILL else SlipKind.ESTIMATE, good = { it.foundAnything })
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ServicingApi.TYPES.forEach { (value, label) ->
                ChoiceChip(label, selected = type == value, onClick = { type = value }, height = 36.dp)
            }
        }
        CompactField(title, { title = it.take(160) }, stringResource(R.string.people_log_what_was_done), placeholder = stringResource(R.string.people_log_what_was_done_example))
        Row(
            Modifier
                .fillMaxWidth()
                .card(radius = 14.dp, color = c.elevated, ring = c.input, elevated = false)
                .pressable(scale = 0.99f, label = stringResource(R.string.people_log_choose_date)) {
                    DatePickerDialog(
                        context,
                        { _, year, month, dayOfMonth -> day = LocalDate.of(year, month + 1, dayOfMonth) },
                        day.year,
                        day.monthValue - 1,
                        day.dayOfMonth,
                    ).apply {
                        // Work done cannot be in the future, and booked work cannot be in the past.
                        val today = System.currentTimeMillis()
                        if (done) datePicker.maxDate = today else datePicker.minDate = today
                    }.show()
                }
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            LineIcon(Lucide.calendar, size = 18.dp, color = c.primary)
            Text(stringResource(if (done) R.string.people_log_done_on else R.string.people_log_booked_for, DayFormat.format(day)), style = SType.bodyMedium, color = c.fg)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CompactField(cost, { cost = it.take(10) }, stringResource(R.string.people_log_cost_optional), Modifier.weight(1f), keyboardOptions = Decimal)
            CompactField(odometer, { odometer = it.take(9) }, stringResource(R.string.people_log_odometer_optional), Modifier.weight(1f), keyboardOptions = Decimal)
        }
        CompactField(workshop, { workshop = it.take(160) }, stringResource(R.string.people_log_workshop_optional))
        SaarthiButton(
            stringResource(R.string.people_log_save_service),
            onClick = {
                saving.run {
                    app.sharing.addMaintenance(
                        shareId = shareId,
                        type = type,
                        title = title.trim(),
                        cost = cost.toDoubleOrNull(),
                        odometerKm = odometer.toDoubleOrNull(),
                        workshop = workshop.trim(),
                        on = day.atTime(12, 0).atZone(ZoneId.systemDefault()).toInstant(),
                        done = done,
                    )
                }
            },
            enabled = title.trim().length >= 3 && !saving.busy && !bill.reading,
            busy = saving.busy,
            busyText = stringResource(R.string.people_saving),
            modifier = Modifier.padding(bottom = 4.dp),
        )
    }
}
