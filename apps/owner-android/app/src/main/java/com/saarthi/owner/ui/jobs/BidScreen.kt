package com.saarthi.owner.ui.jobs

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.DriversApi
import com.saarthi.owner.network.RequirementsApi
import com.saarthi.owner.network.RequirementsApi.Companion.KIND_MATERIAL
import com.saarthi.owner.network.RequirementsApi.Companion.SCOPE_TRAVEL
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.plural
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.common.unitPrice
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SaarthiField
import com.saarthi.owner.ui.design.SaarthiSwitch
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.launch

/** Vehicle types an operator can offer on a passenger job. */
private val TravelTypes = listOf("CAR" to "Car", "SUV" to "SUV", "VAN" to "Van", "TEMPO" to "Tempo", "BUS" to "Bus", "TAXI" to "Taxi")

/**
 * A bid on one job — the design's "Check sellers" for a material job, and
 * the same frame for freight and passenger work.
 *
 * Material is bid as one delivered price: the seller's price for the quantity,
 * plus the fleet's own transport. The customer sees only that price and the
 * fleet — never the seller.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BidScreen(app: OwnerApp, account: SessionStore.Account, job: RequirementsApi.Requirement, onPlaced: () -> Unit) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    val bidScope = RequirementsApi.scopeFor(job.kind)
    val material = job.kind == KIND_MATERIAL
    val existing = job.myBid

    var sellers by remember { mutableStateOf<Loadable<List<RequirementsApi.SellerMatch>>>(Loadable.Loading) }
    var vehicles by remember { mutableStateOf<List<VehiclesApi.Vehicle>>(emptyList()) }
    var drivers by remember { mutableStateOf<List<DriversApi.Driver>>(emptyList()) }
    var driverId by rememberSaveable { mutableStateOf<String?>(null) }
    /** Whether the business can be paid. Null until known; a material bid needs it — the customer's 30% lands there. */
    var canBePaid by remember { mutableStateOf<Boolean?>(null) }
    var sellerId by rememberSaveable { mutableStateOf<String?>(null) }
    var vehicleId by rememberSaveable { mutableStateOf<String?>(existing?.vehicle?.id) }
    var priceText by rememberSaveable { mutableStateOf(if (!material) existing?.price?.toLong()?.toString().orEmpty() else "") }
    var transportText by rememberSaveable { mutableStateOf("") }
    var travelType by rememberSaveable { mutableStateOf(existing?.offeredVehicleType ?: job.preferredVehicleType ?: "CAR") }
    var driverIncluded by rememberSaveable { mutableStateOf(true) }
    var fuelIncluded by rememberSaveable { mutableStateOf(true) }
    var note by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(job.id) {
        if (bidScope != SCOPE_TRAVEL) {
            vehicles = runCatching { app.vehicles.list() }.getOrDefault(emptyList()).sortedByDescending { it.freeForWork() }
            drivers = runCatching { app.drivers.list() }.getOrDefault(emptyList())
                .filter { it.availability != "SUSPENDED" }
                .sortedBy { if (it.availability == "AVAILABLE") 0 else 1 }
        }
        if (material) {
            canBePaid = runCatching { app.materials.payoutAccount()?.usable }.getOrNull()
            sellers = try {
                val found = app.requirements.sellerMatches(job.id).sortedBy { it.procurementReference ?: Double.MAX_VALUE }
                sellerId = sellerId ?: found.firstOrNull { it.stockSufficient != false }?.materialId
                Loadable.Ready(found)
            } catch (failure: Exception) {
                Loadable.Failed(failure.readable())
            }
        }
    }

    val chosenSeller = (sellers as? Loadable.Ready)?.value?.firstOrNull { it.materialId == sellerId }
    val transport = transportText.toDoubleOrNull()
    val total: Double? = if (material) {
        val cost = chosenSeller?.procurementReference
        if (cost != null && transport != null) cost + transport else null
    } else {
        priceText.toDoubleOrNull()
    }
    // A vehicle with nobody set on it needs a driver named on the bid; the server refuses it otherwise.
    val needsDriver = existing == null && bidScope != SCOPE_TRAVEL &&
        vehicles.firstOrNull { it.id == vehicleId }?.let { it.currentDriver == null } == true
    val ready = !busy && existing == null && total != null && total > 0 &&
        (bidScope == SCOPE_TRAVEL || vehicleId != null) && (!material || chosenSeller != null) &&
        (!needsDriver || driverId != null) && (!material || canBePaid != false)

    fun send() {
        val price = total ?: return
        busy = true
        error = null
        scope.launch {
            try {
                app.requirements.placeBid(
                    job.id,
                    RequirementsApi.BidOffer(
                        scope = bidScope,
                        price = price,
                        message = note,
                        vehicleId = vehicleId,
                        driverId = driverId.takeIf { needsDriver },
                        sourceMaterialId = if (material) chosenSeller?.materialId else null,
                        offeredVehicleType = if (bidScope == SCOPE_TRAVEL) travelType else null,
                        driverIncluded = driverIncluded,
                        fuelIncluded = fuelIncluded,
                    ),
                )
                onPlaced()
                navigator.pop()
            } catch (failure: Exception) {
                error = failure.readable()
                busy = false
            }
        }
    }

    val hours = job.hoursLeft()
    DetailScreen(
        eyebrow = "Job · ${job.what}",
        title = if (material) "Check sellers" else if (existing != null) "Your bid" else "Your bid",
        trailing = {
            hours?.let { Pill("$it h left", c.warningBg, c.warning) }
        },
        footer = {
            if (existing != null) {
                NoticeCard(
                    "You bid ${rupees(existing.price)} — ${existing.status.lowercase().replace('_', ' ')}. The customer has it.",
                    NoticeTone.SUCCESS,
                    icon = Lucide.check,
                )
            } else {
                Column {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Column(Modifier.weight(1f)) {
                            Eyebrow("Bid to the customer")
                            Text("One delivered price", style = SType.caption, color = c.muted)
                        }
                        Text(total?.let(::rupees) ?: "—", style = SType.figure.copy(fontSize = 30.sp), color = c.fg)
                    }
                }
                SaarthiButton(
                    total?.let { "Send bid · ${rupees(it)}" } ?: "Send bid",
                    onClick = ::send,
                    enabled = ready,
                    busy = busy,
                    busyText = "Sending…",
                )
            }
        },
    ) {
        JobSummary(job, Modifier.rise())

        if (material && canBePaid == false && existing == null) {
            NoticeCard(
                "Connect and verify your business bank account in Saarthi on the web before bidding on material. The customer's 30% is paid into it.",
                NoticeTone.WARNING,
                Modifier.rise(stagger(1)),
                icon = Lucide.alertTriangle,
            )
        }
        if (material) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .rise(stagger(1))
                    .clip(RoundedCornerShape(18.dp))
                    .background(c.primaryWash)
                    .border(1.dp, c.primaryRing, RoundedCornerShape(18.dp))
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                IconWell(Lucide.lock, well = c.primarySoft, ink = c.primary, size = 36.dp, shape = CircleShape, iconSize = 16.dp)
                Text(
                    "The customer never sees the seller. You buy it, load it and deliver it.",
                    style = SType.body,
                    color = c.fg,
                    modifier = Modifier.weight(1f),
                )
            }
            when (val list = sellers) {
                Loadable.Loading -> SkeletonCards(count = 2)
                is Loadable.Failed -> NoticeCard(list.message, NoticeTone.WARNING, icon = Lucide.cloudOff)
                is Loadable.Ready -> {
                    if (list.value.isEmpty()) {
                        NoticeCard(
                            "No seller near the site lists this in stock yet. You can bid as soon as one does — you'll see them here.",
                            NoticeTone.INFO,
                            icon = Lucide.box,
                        )
                    } else {
                        GroupLabel("${plural(list.value.size, "seller")} with stock near the site")
                    }
                    list.value.forEach { match ->
                        SellerCard(match, job, selected = match.materialId == sellerId) { sellerId = match.materialId }
                    }
                }
            }
        }

        if (bidScope != SCOPE_TRAVEL) {
            GroupLabel("Which vehicle goes")
            if (vehicles.isEmpty()) {
                Text("No vehicle on this account can be offered right now.", style = SType.small, color = c.muted)
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // A bid already sent shows only the vehicle it offered; it cannot be swapped here.
                vehicles.filter { existing == null || it.id == existing.vehicle?.id }.forEach { vehicle ->
                    VehicleOption(vehicle, selected = vehicle.id == vehicleId) { if (existing == null) vehicleId = vehicle.id }
                }
            }
            if (needsDriver) {
                GroupLabel("Who drives it")
                if (drivers.isEmpty()) {
                    Text("No driver on this account can be named yet.", style = SType.small, color = c.muted)
                } else {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        drivers.forEach { driver ->
                            ChoiceChip(driver.fullName, selected = driver.id == driverId, onClick = { driverId = driver.id })
                        }
                    }
                }
            }
        } else {
            GroupLabel("Vehicle you will send")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                TravelTypes.forEach { (value, label) ->
                    ChoiceChip(label, selected = travelType == value, onClick = { travelType = value })
                }
            }
            Column(Modifier.fillMaxWidth().card(radius = 20.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                ToggleRow("Driver included", driverIncluded) { driverIncluded = it }
                ToggleRow("Fuel included", fuelIncluded) { fuelIncluded = it }
            }
        }

        if (material) {
            chosenSeller?.procurementReference?.let { cost ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "${chosenSeller.name} · ${job.quantity?.let { "${it.toLong()} ${RequirementsApi.unitWord(job.unit)}" } ?: ""} × ${unitPrice(chosenSeller.pricePerUnit)}",
                        style = SType.small,
                        color = c.muted,
                        modifier = Modifier.weight(1f),
                    )
                    Text(rupees(cost), style = SType.bodyStrong, color = c.fg)
                }
            }
            SaarthiField(
                value = transportText,
                onValueChange = { transportText = it.filter(Char::isDigit).take(8) },
                label = "Your transport, delivered to site (₹)",
                leading = Lucide.truck,
                placeholder = "6500",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
        } else {
            SaarthiField(
                value = priceText,
                onValueChange = { priceText = it.filter(Char::isDigit).take(8) },
                label = "Your price for the whole job (₹)",
                leading = Lucide.receipt,
                placeholder = job.lowestBid?.toLong()?.toString() ?: "25000",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                enabled = existing == null,
            )
        }
        if (existing == null) {
            SaarthiField(
                value = note,
                onValueChange = { note = it.take(300) },
                label = "A note for the customer (optional)",
                leading = Lucide.send,
                placeholder = if (bidScope == SCOPE_TRAVEL) "AC car, tolls and parking included" else "Loaded by 7, at your gate by 11",
            )
        }
        error?.let { RevealedNotice(it, NoticeTone.DANGER) }
    }
}

/** What the customer asked for, at a glance. */
@Composable
private fun JobSummary(job: RequirementsApi.Requirement, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(job.title.ifBlank { job.what }, style = SType.cardTitle, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(
            if (job.kind == KIND_MATERIAL) "Deliver to ${job.destinationAddress ?: job.originAddress}" else job.route,
            style = SType.small,
            color = c.muted,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            clockOf(job.startAt)?.let { Pill("Needed $it", c.sunken, c.fg) }
            Pill(if (job.bidCount == 0) "No bids yet" else "${plural(job.bidCount, "bid")} so far", c.sunken, c.muted)
        }
    }
}

@Composable
private fun SellerCard(
    match: RequirementsApi.SellerMatch,
    job: RequirementsApi.Requirement,
    selected: Boolean,
    onPick: () -> Unit,
) {
    val c = Saarthi.colors
    val short = match.stockSufficient == false
    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 22.dp, ring = if (selected) c.primary else c.ring)
            .pressable(scale = 0.98f, onClick = onPick)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(
                Modifier
                    .size(22.dp)
                    .clip(CircleShape)
                    .border(2.dp, if (selected) c.primary else c.borderStrong, CircleShape)
                    .padding(5.dp)
                    .clip(CircleShape)
                    .background(if (selected) c.primary else c.card),
            )
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(match.sellerName, style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (match.sellerVerified) LineIcon(Lucide.shieldCheck, size = 15.dp, color = c.success)
                }
                Text(
                    listOfNotNull(
                        match.pickupAddress?.substringBefore(',')?.ifBlank { null },
                        match.distanceKm?.let { "${it.toInt()} km from site" },
                    ).joinToString(" · ").ifBlank { match.name },
                    style = SType.caption,
                    color = c.muted,
                    maxLines = 1,
                )
            }
            if (short) Pill("Short on stock", c.warningBg, c.warning)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Figure("Price", "${unitPrice(match.pricePerUnit)}/${RequirementsApi.unitWord(match.unit).removeSuffix("s")}", Modifier.weight(1f))
            Figure("In stock", "${match.availableQuantity.toLong()} ${RequirementsApi.unitWord(match.unit)}", Modifier.weight(1f), if (short) c.warning else c.success)
            Figure("For ${job.quantity?.toLong() ?: ""} ${RequirementsApi.unitWord(job.unit)}".trim(), match.procurementReference?.let(::rupees) ?: "—", Modifier.weight(1f))
        }
    }
}

@Composable
private fun Figure(label: String, value: String, modifier: Modifier = Modifier, ink: androidx.compose.ui.graphics.Color = Saarthi.colors.fg) {
    val c = Saarthi.colors
    Column(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(c.sunken)
            .padding(10.dp),
    ) {
        Eyebrow(label, maxLines = 1)
        Text(value, style = SType.smallStrong, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Free to take new work: nothing running on it, and not in the workshop. A driver being attached does not make it busy. */
private fun VehiclesApi.Vehicle.freeForWork(): Boolean =
    currentTripId == null && status in setOf("AVAILABLE", "IDLE", "ASSIGNED")

/** Why a vehicle is not free, in a word. */
private fun VehiclesApi.Vehicle.busyWord(): String = when {
    status == "MAINTENANCE" -> "in service"
    status == "SUSPENDED" -> "suspended"
    currentTripId != null || status in setOf("ON_TRIP", "LOADING", "UNLOADING") -> "on a trip"
    else -> "busy"
}

@Composable
private fun VehicleOption(vehicle: VehiclesApi.Vehicle, selected: Boolean, onPick: () -> Unit) {
    val c = Saarthi.colors
    val free = vehicle.freeForWork()
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
                    !free -> vehicle.busyWord()
                    vehicle.currentDriver == null -> "no driver"
                    else -> "free now"
                },
            ).joinToString(" · "),
            style = SType.caption,
            color = if (free) c.muted else c.warning,
            maxLines = 1,
        )
    }
}

@Composable
private fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = SType.rowTitle, color = Saarthi.colors.fg, modifier = Modifier.weight(1f))
        SaarthiSwitch(checked = checked, onCheckedChange = onChange, label = label)
    }
}
