package com.saarthi.owner.ui.costs

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.network.ServicingApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DayField
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SegmentedControl
import com.saarthi.owner.ui.papers.PaperScanner
import com.saarthi.owner.ui.papers.SlipKind
import com.saarthi.owner.ui.papers.SlipStep
import com.saarthi.owner.ui.papers.rememberPickers
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.tracking.attempt
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Log work on a vehicle: done already — read off the workshop's bill, which
 * fills the total, the day, the bill number, the workshop, the odometer and
 * the kind of work — or booked for a day ahead.
 */
@Composable
internal fun ServiceLogScreen(app: OwnerApp, vehicle: VehiclesApi.Vehicle?, onSaved: () -> Unit) {
    val context = LocalContext.current
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()

    var vehicles by remember { mutableStateOf(listOfNotNull(vehicle)) }
    var vehicleId by remember { mutableStateOf(vehicle?.id) }
    var done by remember { mutableStateOf(true) }
    var bill by remember { mutableStateOf<OwnerApi.Upload?>(null) }
    var reading by remember { mutableStateOf(false) }
    var read by remember { mutableStateOf<ReadBill?>(null) }
    var type by remember { mutableStateOf("PREVENTIVE") }
    var title by remember { mutableStateOf("") }
    var day by remember { mutableStateOf<LocalDate?>(LocalDate.now()) }
    var cost by remember { mutableStateOf("") }
    var odometer by remember { mutableStateOf("") }
    var workshop by remember { mutableStateOf("") }
    var invoice by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val pickers = rememberPickers(imagesOnly = false) { picked ->
        picked.onSuccess { bill = it; problem = null }.onFailure { problem = it.message ?: Words.get(R.string.costs_photo_unusable) }
    }

    LaunchedEffect(Unit) {
        if (vehicle == null) attempt { app.vehicles.list() }?.let { vehicles = it }
    }
    LaunchedEffect(bill) {
        val file = bill ?: return@LaunchedEffect
        reading = true
        val found = try {
            PaperScanner.text(context, file)?.let { SlipText.bill(it) } ?: ReadBill()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            ReadBill()
        }
        found.total?.let { cost = it.typed() }
        // An estimate's date is the day it was written, not the day booked.
        if (done) found.date?.let { day = it }
        found.invoiceNumber?.let { invoice = it }
        found.workshop?.let { workshop = it }
        found.odometerKm?.let { odometer = it.toLong().toString() }
        found.type?.let { kind ->
            type = kind
            if (title.isBlank()) title = ServicingApi.typeWord(kind).let { if (kind == "PREVENTIVE") "General service" else it }
        }
        found.plate?.let { plate -> vehicles.firstOrNull { it.registrationNumber.filter(Char::isLetterOrDigit).equals(plate, true) }?.let { vehicleId = it.id } }
        read = found
        reading = false
    }

    val chosen = vehicles.firstOrNull { it.id == vehicleId }
    val otherPlate = read?.plate?.takeIf { plate -> chosen != null && !chosen.registrationNumber.filter(Char::isLetterOrDigit).equals(plate, true) }
    val today = LocalDate.now()
    val dayFits = day?.let { if (done) !it.isAfter(today) else !it.isBefore(today) } == true
    val ready = chosen != null && title.trim().length >= 3 && dayFits && !busy && !reading

    DetailScreen(
        eyebrow = chosen?.let { formatPlate(it.registrationNumber) } ?: stringResource(R.string.costs_servicing),
        title = stringResource(R.string.costs_log_servicing),
        footer = {
            problem?.let { NoticeCard(it, NoticeTone.DANGER) }
            SaarthiButton(
                stringResource(if (done) R.string.costs_service_save else R.string.costs_service_book),
                onClick = {
                    busy = true
                    problem = null
                    scope.launch {
                        try {
                            val on = day!!
                            if (done) {
                                app.servicing.recordDone(
                                    ServicingApi.DoneWork(
                                        vehicleId = chosen!!.id,
                                        type = type,
                                        title = title.trim(),
                                        serviceDate = on.atTime(LocalTime.NOON).atZone(ZoneId.systemDefault()).toInstant().toString(),
                                        odometerKm = odometer.toDoubleOrNull(),
                                        workshop = workshop.trim(),
                                        totalCost = cost.toDoubleOrNull(),
                                        invoiceNumber = invoice.trim(),
                                    ),
                                )
                            } else {
                                app.servicing.book(
                                    vehicleId = chosen!!.id,
                                    type = type,
                                    title = title.trim(),
                                    scheduledAt = on.atTime(BOOKED_AT).atZone(ZoneId.systemDefault()).toInstant().toString(),
                                    workshop = workshop.trim(),
                                    cost = cost.toDoubleOrNull(),
                                )
                            }
                            onSaved()
                            navigator.pop()
                        } catch (failure: Exception) {
                            if (failure is CancellationException) throw failure
                            problem = failure.readable()
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = ready,
                busy = busy,
                busyText = stringResource(R.string.costs_saving),
            )
        },
    ) {
        SegmentedControl(
            options = listOf(stringResource(R.string.costs_service_done_already), stringResource(R.string.costs_service_booked)),
            selected = if (done) 0 else 1,
            onSelect = { index ->
                done = index == 0
                // A day that suited the other choice (a past day for booked work, a coming one for work done) becomes today.
                val picked = day
                if (picked != null && (if (done) picked.isAfter(today) else picked.isBefore(today))) day = today
            },
            height = 44.dp,
        )
        // Work done is read off its bill; work booked ahead off the workshop's estimate or job card.
        SlipStep(
            what = if (done) SlipKind.BILL else SlipKind.ESTIMATE,
            pickers = pickers,
            picked = bill,
            reading = reading,
            outcome = read?.let {
                stringResource(
                    when {
                        !it.foundAnything -> if (done) R.string.costs_service_read_none else R.string.costs_receipt_read_none
                        done -> R.string.costs_service_read_good
                        else -> R.string.costs_receipt_read_good
                    },
                )
            },
            outcomeGood = read?.foundAnything == true,
            onClear = { bill = null; read = null },
        )
        if (done) Hint(stringResource(R.string.costs_service_bill_hint))
        otherPlate?.let { NoticeCard(stringResource(R.string.costs_bill_other_plate, formatPlate(it), formatPlate(chosen!!.registrationNumber)), NoticeTone.WARNING) }

        if (vehicle == null) {
            GroupLabel(stringResource(R.string.costs_vehicle))
            VehiclePicker(vehicles, vehicleId) { vehicleId = it.id }
        }
        GroupLabel(stringResource(R.string.costs_service_work))
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ServicingApi.TYPES.forEach { (value, label) -> ChoiceChip(label, selected = type == value, onClick = { type = value }, height = 36.dp) }
        }
        CompactField(title, { title = it.take(160) }, stringResource(R.string.costs_service_what), placeholder = stringResource(R.string.costs_service_what_placeholder))
        DayField(
            stringResource(if (done) R.string.costs_service_done_on else R.string.costs_service_booked_for),
            day,
            onPick = { day = it },
            latest = today.takeIf { done },
            earliest = today.takeIf { !done },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CompactField(cost, { cost = decimalOf(it) }, stringResource(if (done) R.string.costs_service_total else R.string.costs_service_estimate), Modifier.weight(1f), keyboardOptions = Decimal)
            if (done) CompactField(odometer, { odometer = it.filter(Char::isDigit).take(9) }, stringResource(R.string.costs_odometer_optional), Modifier.weight(1f), keyboardOptions = Whole)
        }
        CompactField(workshop, { workshop = it.take(160) }, stringResource(R.string.costs_service_workshop))
        if (done) CompactField(invoice, { invoice = it.take(80) }, stringResource(R.string.costs_service_bill_number))
    }
}

/** Booked work is booked for the morning of its day. */
private val BOOKED_AT: LocalTime = LocalTime.of(10, 0)
