package com.saarthi.owner.ui.costs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
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
import com.saarthi.owner.network.FuelApi
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DayField
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
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
 * Log a fill-up from its pump slip: the slip is read on the phone and fills
 * the litres, rate, day, odometer and pump, and its plate picks the vehicle.
 * Everything stays editable for a misread; the slip is kept with the entry.
 */
@Composable
internal fun FillUpScreen(app: OwnerApp, vehicle: VehiclesApi.Vehicle?, onSaved: () -> Unit) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()

    var vehicles by remember { mutableStateOf(listOfNotNull(vehicle)) }
    var vehicleId by remember { mutableStateOf(vehicle?.id) }
    var slip by remember { mutableStateOf<OwnerApi.Upload?>(null) }
    var reading by remember { mutableStateOf(false) }
    var read by remember { mutableStateOf<ReadFillUp?>(null) }
    var litres by remember { mutableStateOf("") }
    var rate by remember { mutableStateOf("") }
    var day by remember { mutableStateOf<LocalDate?>(LocalDate.now()) }
    var time by remember { mutableStateOf<LocalTime?>(null) }
    var odometer by remember { mutableStateOf("") }
    var station by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var slipLost by remember { mutableStateOf<String?>(null) }
    val pickers = rememberPickers(imagesOnly = false) { picked ->
        picked.onSuccess { slip = it; problem = null }.onFailure { problem = it.message ?: Words.get(R.string.costs_photo_unusable) }
    }

    LaunchedEffect(Unit) {
        if (vehicle == null) attempt { app.vehicles.list() }?.let { vehicles = it }
    }
    // Read the slip the moment it is picked.
    LaunchedEffect(slip) {
        val file = slip ?: return@LaunchedEffect
        reading = true
        val found = try {
            PaperScanner.text(context, file)?.let { SlipText.fillUp(it) } ?: ReadFillUp()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            ReadFillUp()
        }
        found.litres?.let { litres = it.typed() }
        found.rate?.let { rate = it.typed() }
        found.filledOn?.let { day = it }
        time = found.filledAt
        found.odometerKm?.let { odometer = it.toLong().toString() }
        found.station?.let { station = it }
        found.plate?.let { plate -> vehicles.firstOrNull { it.registrationNumber.filter(Char::isLetterOrDigit).equals(plate, true) }?.let { vehicleId = it.id } }
        read = found
        reading = false
    }

    val l = litres.toDoubleOrNull()
    val r = rate.toDoubleOrNull()
    val chosen = vehicles.firstOrNull { it.id == vehicleId }
    val otherPlate = read?.plate?.takeIf { plate -> chosen != null && !chosen.registrationNumber.filter(Char::isLetterOrDigit).equals(plate, true) }
    val ready = chosen != null && (l ?: 0.0) in 0.01..2000.0 && (r ?: 0.0) in 0.01..1000.0 && !busy && !reading && slipLost == null

    DetailScreen(
        eyebrow = chosen?.let { formatPlate(it.registrationNumber) } ?: stringResource(R.string.costs_fuel),
        title = stringResource(R.string.costs_log_fill_up),
        footer = {
            problem?.let { NoticeCard(it, NoticeTone.DANGER) }
            if (slipLost != null) {
                SaarthiButton(stringResource(R.string.costs_done), onClick = navigator::pop)
            } else {
                SaarthiButton(
                    stringResource(R.string.costs_fill_up_save),
                    onClick = {
                        busy = true
                        problem = null
                        scope.launch {
                            try {
                                val saved = app.fuel.logFillUp(
                                    FuelApi.NewFillUp(
                                        vehicleId = chosen!!.id,
                                        litres = l!!,
                                        pricePerLitre = r!!,
                                        odometerKm = odometer.toDoubleOrNull(),
                                        station = station.trim(),
                                        recordedAt = recordedAt(day, time),
                                    ),
                                )
                                onSaved()
                                val file = slip
                                if (saved != null && file != null) {
                                    try {
                                        app.fuel.attachSlip(saved.id, file)
                                    } catch (failure: Exception) {
                                        if (failure is CancellationException) throw failure
                                        slipLost = failure.readable()
                                        return@launch
                                    }
                                }
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
            }
        },
    ) {
        slipLost?.let { NoticeCard(stringResource(R.string.costs_fill_up_slip_lost, it), NoticeTone.WARNING) }

        SlipStep(
            what = SlipKind.PUMP_SLIP,
            pickers = pickers,
            picked = slip,
            reading = reading,
            outcome = read?.let { stringResource(if (it.foundAnything) R.string.costs_fill_up_read_good else R.string.costs_fill_up_read_none) },
            outcomeGood = read?.foundAnything == true,
            onClear = { slip = null; read = null },
        )
        otherPlate?.let { NoticeCard(stringResource(R.string.costs_slip_other_plate, formatPlate(it), formatPlate(chosen!!.registrationNumber)), NoticeTone.WARNING) }

        if (vehicle == null) {
            GroupLabel(stringResource(R.string.costs_vehicle))
            VehiclePicker(vehicles, vehicleId) { vehicleId = it.id }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CompactField(litres, { litres = decimalOf(it, 8) }, stringResource(R.string.costs_litres), Modifier.weight(1f), keyboardOptions = Decimal)
            CompactField(rate, { rate = decimalOf(it, 8) }, stringResource(R.string.costs_fill_up_rate), Modifier.weight(1f), keyboardOptions = Decimal)
        }
        if (l != null && r != null && l > 0 && r > 0) {
            Text(stringResource(R.string.costs_fill_up_total, rupees(l * r)), style = SType.bodyStrong, color = c.fg)
        }
        DayField(stringResource(R.string.costs_fill_up_filled_on), day, onPick = { day = it; time = null }, latest = LocalDate.now())
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CompactField(odometer, { odometer = it.filter(Char::isDigit).take(9) }, stringResource(R.string.costs_odometer_optional), Modifier.weight(1f), keyboardOptions = Whole)
            CompactField(station, { station = it.take(160) }, stringResource(R.string.costs_fill_up_pump), Modifier.weight(1f))
        }
    }
}

/** When the slip says it was filled; null for "now" when it was today and no time was read. */
private fun recordedAt(day: LocalDate?, time: LocalTime?): String? {
    val on = day ?: return null
    if (time == null && on == LocalDate.now()) return null
    val at = on.atTime(time ?: LocalTime.NOON).atZone(ZoneId.systemDefault()).toInstant()
    // A misread clock that lands later than now means "now".
    return at.takeIf { it.isBefore(java.time.Instant.now()) }?.toString()
}
