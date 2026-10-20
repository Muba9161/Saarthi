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
import com.saarthi.owner.data.DeviceLocation
import com.saarthi.owner.network.DrivingApi
import com.saarthi.owner.network.FuelApi
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.network.VehiclesApi
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
import com.saarthi.owner.ui.papers.PaperScanner
import com.saarthi.owner.ui.papers.SlipKind
import com.saarthi.owner.ui.papers.SlipStep
import com.saarthi.owner.ui.papers.rememberPickers
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.tracking.attempt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * File a slip paid on the road — a toll in cash, parking, a puncture, a meal,
 * loading charges, a challan — as Humsafar files it: its photo is the evidence
 * and is required, and is read on the phone for the amount, the kind and who
 * was paid. Filed against the trip the vehicle is on.
 */
@Composable
internal fun SlipLogScreen(app: OwnerApp, vehicle: VehiclesApi.Vehicle?, onSaved: () -> Unit) {
    val context = LocalContext.current
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var vehicles by remember { mutableStateOf(listOfNotNull(vehicle)) }
    var vehicleId by remember { mutableStateOf(vehicle?.id) }
    var photo by remember { mutableStateOf<OwnerApi.Upload?>(null) }
    var reading by remember { mutableStateOf(false) }
    var read by remember { mutableStateOf<ReadSlip?>(null) }
    var category by remember { mutableStateOf<String?>(null) }
    var amount by remember { mutableStateOf("") }
    var vendor by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val pickers = rememberPickers(imagesOnly = true) { picked ->
        picked.onSuccess { photo = it; problem = null }.onFailure { problem = it.message ?: Words.get(R.string.costs_photo_unusable) }
    }

    LaunchedEffect(Unit) {
        if (vehicle == null) attempt { app.vehicles.list() }?.let { vehicles = it }
    }
    LaunchedEffect(photo) {
        val file = photo ?: return@LaunchedEffect
        reading = true
        val found = try {
            PaperScanner.text(context, file)?.let { SlipText.expense(it) } ?: ReadSlip()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            ReadSlip()
        }
        found.amount?.let { amount = it.typed() }
        found.category?.let { category = it }
        found.vendor?.let { vendor = it }
        found.plate?.let { plate -> vehicles.firstOrNull { it.registrationNumber.filter(Char::isLetterOrDigit).equals(plate, true) }?.let { vehicleId = it.id } }
        read = found
        reading = false
    }

    val chosen = vehicles.firstOrNull { it.id == vehicleId }
    val value = amount.toDoubleOrNull()
    val ready = chosen != null && photo != null && category != null && (value ?: 0.0) in 0.01..1_000_000.0 && !busy && !reading

    DetailScreen(
        eyebrow = chosen?.let { formatPlate(it.registrationNumber) } ?: stringResource(R.string.costs_slips),
        title = stringResource(R.string.costs_file_slip),
        footer = {
            problem?.let { NoticeCard(it, NoticeTone.DANGER) }
            SaarthiButton(
                stringResource(R.string.costs_slip_file),
                onClick = {
                    busy = true
                    problem = null
                    scope.launch {
                        try {
                            // Where it was paid, when the phone already may say; never asked for here.
                            val here = if (DeviceLocation.allowed(context)) attempt { DeviceLocation.current(context) } else null
                            app.driving.fileSlip(
                                DrivingApi.Slip(
                                    vehicleId = chosen!!.id,
                                    category = category!!,
                                    amount = value!!,
                                    vendor = vendor.trim(),
                                    notes = notes.trim(),
                                    latitude = here?.latitude,
                                    longitude = here?.longitude,
                                    photo = photo!!,
                                ),
                            )
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
                busyText = stringResource(R.string.costs_slip_filing),
            )
        },
    ) {
        SlipStep(
            what = SlipKind.SLIP,
            pickers = pickers,
            picked = photo,
            reading = reading,
            outcome = read?.let { stringResource(if (it.foundAnything) R.string.costs_slip_read_good else R.string.costs_slip_read_none) },
            outcomeGood = read?.foundAnything == true,
            onClear = { photo = null; read = null },
        )
        if (photo == null) Hint(stringResource(R.string.costs_slip_photo_needed))
        if (vehicle == null) {
            GroupLabel(stringResource(R.string.costs_vehicle))
            VehiclePicker(vehicles, vehicleId) { vehicleId = it.id }
        }
        GroupLabel(stringResource(R.string.costs_slip_what_for))
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FuelApi.SLIP_CATEGORIES.forEach { (code, label) -> ChoiceChip(label, selected = category == code, onClick = { category = code }, height = 36.dp) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CompactField(amount, { amount = decimalOf(it) }, stringResource(R.string.costs_slip_amount), Modifier.weight(1f), keyboardOptions = Decimal)
            CompactField(vendor, { vendor = it.take(120) }, stringResource(R.string.costs_slip_paid_to), Modifier.weight(1.3f))
        }
        CompactField(notes, { notes = it.take(300) }, stringResource(R.string.costs_slip_note))
    }
}
