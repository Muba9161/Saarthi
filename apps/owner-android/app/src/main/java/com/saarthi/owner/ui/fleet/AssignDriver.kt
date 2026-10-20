package com.saarthi.owner.ui.fleet

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.DriversApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.Avatar
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.InlineSpinner
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.papers.PaperScanner
import com.saarthi.owner.ui.papers.PaperText
import com.saarthi.owner.ui.papers.rememberPickers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.launch

/**
 * Who drives this vehicle, on its page: named with a way to change or clear
 * it, or an invitation to name someone — for an account that may.
 */
@Composable
internal fun DriverCard(
    driverName: String?,
    canAssign: Boolean,
    busy: Boolean,
    onAssign: () -> Unit,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    var confirming by remember { mutableStateOf(false) }
    if (driverName == null && !canAssign) return
    Column(modifier.fillMaxWidth().card(radius = 22.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            if (driverName != null) {
                Avatar(driverName, size = 44.dp, background = c.primarySoft, ink = c.primary)
            } else {
                com.saarthi.owner.ui.design.IconWell(Lucide.user, well = c.sunken, ink = c.muted, size = 44.dp, radius = 22.dp)
            }
            Column(Modifier.weight(1f)) {
                Eyebrow(stringResource(if (driverName != null) R.string.fleet_assign_driving else R.string.fleet_assign_no_driver))
                Text(
                    driverName ?: stringResource(R.string.fleet_assign_nobody),
                    style = if (driverName != null) SType.rowTitle else SType.small,
                    color = if (driverName != null) c.fg else c.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (busy) InlineSpinner(c.primary)
        }
        if (canAssign && !busy) {
            if (confirming) {
                Text(stringResource(R.string.fleet_assign_take_off_confirm, driverName.orEmpty()), style = SType.small, color = c.fg)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SaarthiButton(stringResource(R.string.fleet_assign_keep), onClick = { confirming = false }, tone = ButtonTone.SECONDARY, modifier = Modifier.weight(1f))
                    SaarthiButton(stringResource(R.string.fleet_assign_remove), onClick = { confirming = false; onRemove() }, tone = ButtonTone.DANGER_OUTLINE, modifier = Modifier.weight(1f))
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    LinkButton(stringResource(if (driverName != null) R.string.fleet_assign_change_driver else R.string.fleet_assign_assign_driver), onClick = onAssign, style = SType.smallStrong)
                    if (driverName != null) LinkButton(stringResource(R.string.fleet_assign_remove), onClick = { confirming = true }, style = SType.smallStrong, color = c.danger)
                }
            }
        }
    }
}

/** What the sheet offers: the people who can be put on the vehicle, and the owner's own profile. */
private class Assignable(val drivers: List<DriversApi.Driver>, val self: DriversApi.SelfDriver?)

private const val SELF = "self"

/**
 * Choosing who drives [vehicle], as the web's assign dialog does: yourself, or
 * one of your verified drivers who is not on another vehicle. Placed beside
 * the page, not in it.
 */
@Composable
internal fun AssignDriverSheet(
    app: OwnerApp,
    account: SessionStore.Account,
    vehicle: VehiclesApi.Vehicle,
    visible: Boolean,
    onDismiss: () -> Unit,
    onAssigned: (String) -> Unit,
) {
    var opening by remember { mutableIntStateOf(0) }
    var wasVisible by remember { mutableStateOf(false) }
    if (visible && !wasVisible) opening++
    wasVisible = visible
    BottomSheet(visible = visible, onDismiss = onDismiss) {
        // A fresh read and a fresh choice on every opening.
        key(opening) { AssignForm(app, account, vehicle, onAssigned) }
    }
}

@Composable
private fun AssignForm(app: OwnerApp, account: SessionStore.Account, vehicle: VehiclesApi.Vehicle, onAssigned: (String) -> Unit) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<Loadable<Assignable>>(Loadable.Loading) }
    var chosen by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        state = try {
            val drivers = async { app.drivers.assignable() }
            val self = async { runCatching { app.drivers.mine() }.getOrNull() }
            Loadable.Ready(Assignable(drivers.await(), self.await()))
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            Loadable.Failed(failure.readable())
        }
    }

    fun assign(driverId: String, who: String) {
        busy = true
        problem = null
        scope.launch {
            try {
                app.vehicles.assignDriver(vehicle.id, driverId)
                onAssigned(who)
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                problem = failure.readable()
            } finally {
                busy = false
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(stringResource(R.string.fleet_assign_sheet_title, formatPlate(vehicle.registrationNumber)), style = SType.sheetTitle, color = c.fg)
        Text(stringResource(R.string.fleet_assign_sheet_hint), style = SType.small, color = c.muted)
        when (val shown = state) {
            Loadable.Loading -> InlineSpinner(c.primary)
            is Loadable.Failed -> NoticeCard(shown.message, NoticeTone.WARNING)
            is Loadable.Ready -> {
                val self = shown.value.self
                val canAddSelf = account.can(DriversApi.CAN_MANAGE)
                Column(
                    Modifier.fillMaxWidth().heightIn(max = 380.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (self != null || canAddSelf) {
                        ChoiceRow(stringResource(R.string.fleet_assign_myself), selfLine(self, vehicle), selected = chosen == SELF, enabled = selfAssignable(self, vehicle)) { chosen = SELF }
                    }
                    shown.value.drivers.filter { it.id != self?.id }.forEach { driver ->
                        ChoiceRow(
                            driver.fullName,
                            listOfNotNull(driver.phone, driver.overallScore?.let { stringResource(R.string.fleet_assign_score, it) }).joinToString(" · ").ifBlank { null },
                            selected = chosen == driver.id,
                        ) { chosen = driver.id }
                    }
                    if (shown.value.drivers.isEmpty()) {
                        Text(stringResource(R.string.fleet_assign_none_free), style = SType.small, color = c.muted)
                    }
                }
                if (chosen == SELF && self == null) {
                    AddMyself(app, vehicle, busy, onBusy = { busy = it }, onProblem = { problem = it }, onAssigned = onAssigned)
                } else {
                    problem?.let { NoticeCard(it, NoticeTone.DANGER) }
                    SaarthiButton(
                        stringResource(R.string.fleet_assign_assign),
                        onClick = {
                            val pick = chosen ?: return@SaarthiButton
                            if (pick == SELF) self?.let { assign(it.id, "You") } else {
                                assign(pick, shown.value.drivers.firstOrNull { it.id == pick }?.fullName ?: "")
                            }
                        },
                        enabled = chosen != null && !busy,
                        busy = busy,
                        busyText = stringResource(R.string.fleet_assign_assigning),
                    )
                }
                if (chosen == SELF && self == null) problem?.let { NoticeCard(it, NoticeTone.DANGER) }
            }
        }
    }
}

private fun selfAssignable(self: DriversApi.SelfDriver?, vehicle: VehiclesApi.Vehicle): Boolean =
    self == null || (self.verified && (self.currentTruckId == null || self.currentTruckId == vehicle.id))

private fun selfLine(self: DriversApi.SelfDriver?, vehicle: VehiclesApi.Vehicle): String = when {
    self == null -> Words.get(R.string.fleet_assign_self_adds)
    !self.verified -> Words.get(R.string.fleet_assign_self_unverified)
    self.currentTruckId != null && self.currentTruckId != vehicle.id -> Words.get(R.string.fleet_assign_self_elsewhere)
    else -> Words.get(R.string.fleet_assign_self_licence, self.licenseNumber)
}

@Composable
private fun ChoiceRow(title: String, line: String?, selected: Boolean, enabled: Boolean = true, onPick: () -> Unit) {
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 16.dp, color = if (selected) c.primaryWash else c.elevated, ring = if (selected) c.primary else c.input, elevated = false)
            .pressable(enabled = enabled, scale = 0.99f, label = title, onClick = onPick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Avatar(title, size = 36.dp, background = c.primarySoft, ink = c.primary)
        Column(Modifier.weight(1f)) {
            Text(title, style = SType.bodyStrong, color = if (enabled) c.fg else c.subtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
            line?.let { Text(it, style = SType.caption, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        if (selected) LineIcon(Lucide.check, size = 18.dp, color = c.primary)
    }
}

/**
 * The owner adding themselves as a driver: their licence read off a photo of
 * it, as every upload is — the number and validity filled in, left open to
 * correct. A new profile starts unverified, so it is assigned once verified.
 */
@Composable
private fun AddMyself(
    app: OwnerApp,
    vehicle: VehiclesApi.Vehicle,
    busy: Boolean,
    onBusy: (Boolean) -> Unit,
    onProblem: (String?) -> Unit,
    onAssigned: (String) -> Unit,
) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var licence by remember { mutableStateOf("") }
    var expiry by remember { mutableStateOf<java.time.LocalDate?>(null) }
    var reading by remember { mutableStateOf(false) }
    var added by remember { mutableStateOf<String?>(null) }
    val pickers = rememberPickers(imagesOnly = false) { result ->
        val file = result.getOrElse { onProblem(it.message ?: Words.get(R.string.fleet_assign_photo_unusable)); return@rememberPickers }
        reading = true
        onProblem(null)
        scope.launch {
            val read = runCatching { PaperScanner.text(context, file) }.getOrNull()?.let { PaperText.read(it, PaperText.LICENCE, null) }
            read?.number?.let { licence = it }
            read?.expiresOn?.let { expiry = it }
            if (read?.number == null) onProblem(Words.get(R.string.fleet_assign_licence_unreadable))
            reading = false
        }
    }

    added?.let {
        NoticeCard(it, NoticeTone.SUCCESS)
        return
    }
    Text(stringResource(R.string.fleet_assign_photo_hint), style = SType.small, color = c.muted)
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        SaarthiButton(stringResource(R.string.fleet_assign_scan_licence), onClick = pickers.takePhoto, enabled = !reading && !busy, leading = Lucide.camera, modifier = Modifier.weight(1f))
        SaarthiButton(stringResource(R.string.fleet_assign_choose_file), onClick = pickers.chooseFile, enabled = !reading && !busy, tone = ButtonTone.SECONDARY, modifier = Modifier.weight(1f))
    }
    if (reading) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            InlineSpinner(c.primary)
            Text(stringResource(R.string.fleet_assign_reading), style = SType.small, color = c.muted)
        }
    }
    CompactField(licence, { licence = it.uppercase().take(40) }, stringResource(R.string.fleet_assign_licence_number))
    SaarthiButton(
        stringResource(R.string.fleet_assign_add_me),
        onClick = {
            onBusy(true)
            onProblem(null)
            scope.launch {
                try {
                    val profile = app.drivers.addMyself(licence, expiry)
                    if (profile != null && profile.verified) {
                        app.vehicles.assignDriver(vehicle.id, profile.id)
                        onAssigned("You")
                    } else {
                        added = Words.get(R.string.fleet_assign_added_unverified)
                    }
                } catch (failure: Exception) {
                    if (failure is CancellationException) throw failure
                    onProblem(failure.readable())
                } finally {
                    onBusy(false)
                }
            }
        },
        enabled = licence.trim().length >= 8 && !busy && !reading,
        busy = busy,
        busyText = stringResource(R.string.fleet_assign_adding),
    )
}
