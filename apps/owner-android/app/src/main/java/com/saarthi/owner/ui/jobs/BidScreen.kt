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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.DriversApi
import com.saarthi.owner.network.RequirementsApi
import com.saarthi.owner.network.RequirementsApi.Companion.KIND_MATERIAL
import com.saarthi.owner.network.RequirementsApi.Companion.SCOPE_TRAVEL
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.fleet.VehicleOption
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.common.unitPrice
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.NotesField
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
private val TravelTypes: List<Pair<String, String>>
    get() = listOf(
        "CAR" to Words.get(R.string.market_bid_type_car),
        "SUV" to "SUV",
        "VAN" to Words.get(R.string.market_bid_type_van),
        "TEMPO" to Words.get(R.string.market_bid_type_tempo),
        "BUS" to Words.get(R.string.market_bid_type_bus),
        "TAXI" to Words.get(R.string.market_bid_type_taxi),
    )

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
    val travel = bidScope == SCOPE_TRAVEL
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
    // What a cab or tour price covers, as the web's bid dialog collects it: the customer compares bids on these.
    var priceBreakdown by rememberSaveable { mutableStateOf("") }
    var inclusionsText by rememberSaveable { mutableStateOf(job.requiredInclusions.joinToString("\n")) }
    var exclusionsText by rememberSaveable { mutableStateOf("") }
    var itinerary by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(job.id) {
        if (bidScope != SCOPE_TRAVEL) {
            vehicles = runCatching { app.vehicles.list() }.getOrDefault(emptyList()).sortedByDescending { it.freeForWork }
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
    val inclusions = entriesOf(inclusionsText)
    val exclusions = entriesOf(exclusionsText)
    val listProblem = if (travel) problemWith(inclusions, included = true) ?: problemWith(exclusions, included = false) else null
    val ready = !busy && existing == null && total != null && total > 0 &&
        (bidScope == SCOPE_TRAVEL || vehicleId != null) && (!material || chosenSeller != null) &&
        (!needsDriver || driverId != null) && (!material || canBePaid != false) && listProblem == null

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
                        // Only a travel bid collects these; placeBid leaves them off any other scope.
                        priceBreakdown = priceBreakdown.takeIf { travel },
                        inclusions = inclusions,
                        exclusions = exclusions,
                        itinerarySummary = itinerary,
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
        eyebrow = stringResource(R.string.market_bid_eyebrow, job.what),
        title = if (material) stringResource(R.string.market_bid_check_sellers) else if (existing != null) stringResource(R.string.market_bid_your_bid) else stringResource(R.string.market_bid_your_bid),
        trailing = {
            hours?.let { Pill(stringResource(R.string.market_bid_hours_left, it), c.warningBg, c.warning) }
        },
        footer = {
            if (existing != null) {
                NoticeCard(
                    stringResource(R.string.market_bid_sent, rupees(existing.price), existing.status.lowercase().replace('_', ' ')),
                    NoticeTone.SUCCESS,
                    icon = Lucide.check,
                )
            } else {
                Column {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Column(Modifier.weight(1f)) {
                            Eyebrow(stringResource(R.string.market_bid_to_customer))
                            Text(stringResource(R.string.market_bid_one_price), style = SType.caption, color = c.muted)
                        }
                        Text(total?.let(::rupees) ?: "—", style = SType.figure.copy(fontSize = 30.sp), color = c.fg)
                    }
                }
                SaarthiButton(
                    total?.let { stringResource(R.string.market_bid_send_amount, rupees(it)) } ?: stringResource(R.string.market_bid_send),
                    onClick = ::send,
                    enabled = ready,
                    busy = busy,
                    busyText = stringResource(R.string.market_bid_sending),
                )
            }
        },
    ) {
        JobSummary(job, Modifier.rise())

        if (material && canBePaid == false && existing == null) {
            NoticeCard(
                stringResource(R.string.market_bid_connect_bank, CUSTOMER_SHARE_PERCENT),
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
                    stringResource(R.string.market_bid_seller_hidden),
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
                            stringResource(R.string.market_bid_no_sellers),
                            NoticeTone.INFO,
                            icon = Lucide.box,
                        )
                    } else {
                        GroupLabel(pluralStringResource(R.plurals.market_bid_sellers_with_stock, list.value.size, list.value.size))
                    }
                    list.value.forEach { match ->
                        SellerCard(match, job, selected = match.materialId == sellerId) { sellerId = match.materialId }
                    }
                }
            }
        }

        if (bidScope != SCOPE_TRAVEL) {
            GroupLabel(stringResource(R.string.market_bid_which_vehicle))
            if (vehicles.isEmpty()) {
                Text(stringResource(R.string.market_bid_no_vehicle), style = SType.small, color = c.muted)
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
                GroupLabel(stringResource(R.string.market_bid_who_drives))
                if (drivers.isEmpty()) {
                    Text(stringResource(R.string.market_bid_no_driver), style = SType.small, color = c.muted)
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
            GroupLabel(stringResource(R.string.market_bid_vehicle_you_send))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                TravelTypes.forEach { (value, label) ->
                    ChoiceChip(label, selected = travelType == value, onClick = { travelType = value })
                }
            }
            Column(Modifier.fillMaxWidth().card(radius = 20.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                ToggleRow(stringResource(R.string.market_bid_driver_included), driverIncluded) { driverIncluded = it }
                ToggleRow(stringResource(R.string.market_bid_fuel_included), fuelIncluded) { fuelIncluded = it }
            }
            if (existing == null) {
                GroupLabel(stringResource(R.string.market_bid_price_includes))
                NotesField(
                    inclusionsText,
                    { inclusionsText = it },
                    label = stringResource(R.string.market_bid_included_label),
                    placeholder = stringResource(R.string.market_bid_included_placeholder),
                    minHeight = 90.dp,
                )
                if (job.requiredInclusions.isNotEmpty()) Hint(stringResource(R.string.market_bid_included_prefilled))
                NotesField(
                    exclusionsText,
                    { exclusionsText = it },
                    label = stringResource(R.string.market_bid_excluded_label),
                    placeholder = stringResource(R.string.market_bid_excluded_placeholder),
                    minHeight = 76.dp,
                )
                listProblem?.let { Text(it, style = SType.small, color = c.danger) }
                NotesField(
                    itinerary,
                    { itinerary = it.take(RequirementsApi.MAX_ITINERARY_LENGTH) },
                    label = stringResource(R.string.market_bid_itinerary_label),
                    placeholder = stringResource(R.string.market_bid_itinerary_placeholder),
                    minHeight = 110.dp,
                )
                Hint(stringResource(R.string.market_bid_itinerary_hint))
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
                label = stringResource(R.string.market_bid_transport_label),
                leading = Lucide.truck,
                placeholder = "6500",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
        } else {
            SaarthiField(
                value = priceText,
                onValueChange = { priceText = it.filter(Char::isDigit).take(8) },
                label = stringResource(R.string.market_bid_price_label),
                leading = Lucide.receipt,
                placeholder = job.lowestBid?.toLong()?.toString() ?: "25000",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                enabled = existing == null,
            )
            if (travel && existing == null) {
                SaarthiField(
                    value = priceBreakdown,
                    onValueChange = { priceBreakdown = it.take(RequirementsApi.MAX_PRICE_BREAKDOWN_LENGTH) },
                    label = stringResource(R.string.market_bid_breakdown_label),
                    leading = Lucide.fileText,
                    placeholder = stringResource(R.string.market_bid_breakdown_placeholder),
                    supporting = stringResource(R.string.market_bid_breakdown_supporting),
                )
            }
        }
        if (existing == null) {
            SaarthiField(
                value = note,
                onValueChange = { note = it.take(300) },
                label = stringResource(R.string.market_bid_note_label),
                leading = Lucide.send,
                placeholder = if (bidScope == SCOPE_TRAVEL) stringResource(R.string.market_bid_note_placeholder_travel) else stringResource(R.string.market_bid_note_placeholder_goods),
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
            if (job.kind == KIND_MATERIAL) stringResource(R.string.market_bid_deliver_to, job.destinationAddress ?: job.originAddress) else job.route,
            style = SType.small,
            color = c.muted,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            clockOf(job.startAt)?.let { Pill(stringResource(R.string.market_bid_needed, it), c.sunken, c.fg) }
            Pill(if (job.bidCount == 0) stringResource(R.string.market_jobs_no_bids) else pluralStringResource(R.plurals.market_jobs_bids_so_far, job.bidCount, job.bidCount), c.sunken, c.muted)
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
                        match.distanceKm?.let { stringResource(R.string.market_bid_km_from_site, it.toInt()) },
                    ).joinToString(" · ").ifBlank { match.name },
                    style = SType.caption,
                    color = c.muted,
                    maxLines = 1,
                )
            }
            if (short) Pill(stringResource(R.string.market_bid_short_on_stock), c.warningBg, c.warning)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Figure(stringResource(R.string.market_bid_price), "${unitPrice(match.pricePerUnit)}/${RequirementsApi.unitSingular(match.unit)}", Modifier.weight(1f))
            Figure(stringResource(R.string.market_listing_in_stock), "${match.availableQuantity.toLong()} ${RequirementsApi.unitWord(match.unit)}", Modifier.weight(1f), if (short) c.warning else c.success)
            Figure(stringResource(R.string.market_bid_for_quantity, "${job.quantity?.toLong() ?: ""} ${RequirementsApi.unitWord(job.unit)}".trim()), match.procurementReference?.let(::rupees) ?: "—", Modifier.weight(1f))
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

/** A list typed one entry per line (or comma separated), read the way the web's bid dialog reads it. */
private fun entriesOf(text: String): List<String> = text.split('\n', ',').map(String::trim).filter(String::isNotEmpty)

/** Why the server would refuse a bid's list of [included] or excluded items, in words; null when it would be accepted. */
private fun problemWith(entries: List<String>, included: Boolean): String? = when {
    entries.size > RequirementsApi.MAX_BID_LIST_ENTRIES -> Words.get(
        if (included) R.string.market_bid_included_too_many else R.string.market_bid_excluded_too_many,
        RequirementsApi.MAX_BID_LIST_ENTRIES,
    )
    entries.any { it.length < RequirementsApi.MIN_BID_ENTRY_LENGTH } -> Words.get(
        if (included) R.string.market_bid_included_too_short else R.string.market_bid_excluded_too_short,
        RequirementsApi.MIN_BID_ENTRY_LENGTH,
    )
    entries.any { it.length > RequirementsApi.MAX_BID_ENTRY_LENGTH } -> Words.get(
        if (included) R.string.market_bid_included_too_long else R.string.market_bid_excluded_too_long,
        RequirementsApi.MAX_BID_ENTRY_LENGTH,
    )
    else -> null
}

/** The customer's share paid up front into the fleet's bank account. */
private const val CUSTOMER_SHARE_PERCENT = 30

@Composable
private fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = SType.rowTitle, color = Saarthi.colors.fg, modifier = Modifier.weight(1f))
        SaarthiSwitch(checked = checked, onCheckedChange = onChange, label = label)
    }
}
