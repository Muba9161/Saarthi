package com.saarthi.owner.ui.customer

import android.app.DatePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.network.CommerceApi
import com.saarthi.owner.network.PlacesApi
import com.saarthi.owner.network.RequirementsApi
import com.saarthi.owner.network.RequirementsApi.Companion.KIND_CAB
import com.saarthi.owner.network.RequirementsApi.Companion.KIND_FREIGHT
import com.saarthi.owner.network.RequirementsApi.Companion.KIND_MATERIAL
import com.saarthi.owner.network.RequirementsApi.Companion.KIND_TOUR
import com.saarthi.owner.ui.commerce.CommerceDetails
import com.saarthi.owner.ui.commerce.CommerceEntry
import com.saarthi.owner.ui.common.PlaceField
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SaarthiField
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.shell.ShellActions
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val Kinds = listOf(KIND_MATERIAL to "Material", KIND_FREIGHT to "Freight", KIND_CAB to "Cab", KIND_TOUR to "Tour")
private val Units = listOf("TON" to "tonnes", "BAG" to "bags", "CUBIC_METER" to "m³", "PIECE" to "pieces")
private val CabTypes = listOf(null to "Any", "CAR" to "Car", "SUV" to "SUV", "VAN" to "Van", "BUS" to "Bus")
private val HireBases = listOf("ONE_WAY" to "One way", "ROUND_TRIP" to "Round trip", "DAILY" to "By the day")
private val DayFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("EEE d MMM")

/**
 * "What do you need delivered?" — the design's Post board, one page per kind.
 *
 * A material need names the goods and where they go: a verified fleet buys
 * it, loads it and brings it, and quotes one delivered price. The customer
 * deals only with that fleet.
 */
@Composable
fun PostRequirementScreen(app: OwnerApp, actions: ShellActions) {
    val model = viewModel { CustomerModel(app.requirements, app.orders, app.travel) }
    val startKind by model.postKind.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val c = Saarthi.colors

    var kind by rememberSaveable { mutableStateOf(startKind) }
    LaunchedEffect(startKind) { kind = startKind }

    var material by rememberSaveable { mutableStateOf("") }
    // Material is matched to sellers' stock by its catalogue category, read from what is typed.
    val catalogue = remember { CommerceEntry(app.commerce, CommerceApi.SCOPE_REQUIREMENT) }
    var specification by rememberSaveable { mutableStateOf("") }
    var quantity by rememberSaveable { mutableStateOf("") }
    var unit by rememberSaveable { mutableStateOf("TON") }
    var capacity by rememberSaveable { mutableStateOf("") }
    var passengers by rememberSaveable { mutableStateOf("") }
    var days by rememberSaveable { mutableStateOf("2") }
    var hireBasis by rememberSaveable { mutableStateOf("ONE_WAY") }
    var vehicleType by rememberSaveable { mutableStateOf<String?>(null) }
    var destinationsText by rememberSaveable { mutableStateOf("") }
    var day by rememberSaveable { mutableStateOf(LocalDate.now().plusDays(1).toString()) }
    var from by remember { mutableStateOf<PlacesApi.Place?>(null) }
    var to by remember { mutableStateOf<PlacesApi.Place?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val travel = kind == KIND_CAB || kind == KIND_TOUR
    val qty = quantity.toDoubleOrNull()
    val people = passengers.toIntOrNull()
    val destinations = destinationsText.split(',', '\n').map { it.trim() }.filter { it.length >= 2 }
    // The first thing still to fill in, said under the button so a grey button is never a mystery.
    val missing: String? = when (kind) {
        KIND_MATERIAL -> when {
            material.trim().length < 2 -> "the material"
            catalogue.categoryId == null -> "what kind of material it is"
            catalogue.missing.isNotEmpty() -> "the ${catalogue.missing.first().label.lowercase()}"
            qty == null || qty <= 0 -> "the quantity"
            to == null -> "where to deliver"
            else -> null
        }
        KIND_FREIGHT -> when {
            material.trim().length < 2 -> "the goods"
            qty == null || qty <= 0 -> "the quantity"
            (capacity.toDoubleOrNull() ?: 0.0) <= 0 -> "the truck size"
            from == null -> "where to pick up"
            to == null -> "where to drop"
            else -> null
        }
        KIND_CAB -> when {
            people == null || people <= 0 -> "how many people"
            from == null -> "where to pick up"
            to == null -> "where to drop"
            else -> null
        }
        else -> when {
            people == null || people <= 0 -> "how many people"
            from == null -> "where to pick up"
            destinations.isEmpty() -> "the places to visit"
            else -> null
        }
    }
    val ready = !busy && missing == null

    fun post() {
        val neededOn = LocalDate.parse(day)
        val start = neededOn.atTime(LocalTime.of(10, 0)).atZone(ZoneId.systemDefault()).toInstant()
        val title = when (kind) {
            KIND_MATERIAL -> "${quantity.trim()} ${Units.firstOrNull { it.first == unit }?.second ?: ""} ${material.trim()}".trim()
            KIND_FREIGHT -> "${material.trim()} to ${to?.city ?: to?.name}".trim()
            KIND_CAB -> "${people ?: ""} people to ${to?.city ?: to?.name}".trim()
            else -> "Tour: ${destinations.joinToString(", ")}"
        }.take(200).let { if (it.length < 5) "$it request" else it }
        busy = true
        error = null
        scope.launch {
            try {
                val created = app.requirements.create(
                    RequirementsApi.NewRequirement(
                        kind = kind,
                        title = title,
                        description = specification.ifBlank { null },
                        // A material need starts where it ends: the fleet sources it, the customer
                        // only says where it must arrive.
                        origin = if (kind == KIND_MATERIAL) to!! else from!!,
                        destination = to,
                        startAt = start,
                        bidsCloseAt = bidWindowFor(start),
                        budgetAmount = null,
                        materialName = material.trim(),
                        categoryId = catalogue.categoryId.takeIf { kind == KIND_MATERIAL },
                        attributes = catalogue.attributesJson.takeIf { kind == KIND_MATERIAL },
                        goodsDescription = material.trim(),
                        quantity = qty ?: 0.0,
                        unit = unit,
                        specification = specification,
                        requiredCapacityTons = capacity.toDoubleOrNull() ?: 0.0,
                        passengers = people ?: 1,
                        hireBasis = hireBasis,
                        durationDays = days.toIntOrNull() ?: 1,
                        preferredVehicleType = vehicleType,
                        destinations = destinations,
                    ),
                )
                busy = false
                material = ""
                catalogue.reset()
                specification = ""
                quantity = ""
                passengers = ""
                destinationsText = ""
                model.refresh(silent = true)
                created?.let { request ->
                    navigator.push("bids-${request.id}") { CustomerBidsScreen(app, request) { model.refresh(silent = true) } }
                }
                actions.selectTab("orders")
            } catch (failure: Exception) {
                busy = false
                error = failure.readable()
            }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = headerClearance(), bottom = tabBarClearance()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            when (kind) {
                KIND_MATERIAL -> "What do you need delivered?"
                KIND_FREIGHT -> "What needs moving?"
                KIND_CAB -> "Where are you going?"
                else -> "Where would you like to go?"
            },
            style = SType.display,
            color = c.fg,
            modifier = Modifier.rise(),
        )
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).rise(stagger(1)), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Kinds.forEach { (value, label) -> ChoiceChip(label, selected = kind == value, onClick = { kind = value }) }
        }

        when (kind) {
            KIND_MATERIAL, KIND_FREIGHT -> {
                SaarthiField(
                    value = material,
                    onValueChange = { material = it.take(160) },
                    label = if (kind == KIND_MATERIAL) "Material" else "Goods",
                    leading = Lucide.box,
                    placeholder = if (kind == KIND_MATERIAL) "M-sand, plastering grade" else "Cement bags",
                )
                if (kind == KIND_MATERIAL) CommerceDetails(catalogue, material, app.commerce)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CompactField(
                        value = quantity,
                        onValueChange = { quantity = it.filter { ch -> ch.isDigit() || ch == '.' }.take(8) },
                        label = "Quantity",
                        placeholder = "20",
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.weight(1f),
                    )
                    if (kind == KIND_FREIGHT) {
                        CompactField(
                            value = capacity,
                            onValueChange = { capacity = it.filter { ch -> ch.isDigit() || ch == '.' }.take(5) },
                            label = "Truck size (t)",
                            placeholder = "16",
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Units.forEach { (value, label) -> ChoiceChip(label, selected = unit == value, onClick = { unit = value }, height = 36.dp) }
                }
                if (kind == KIND_MATERIAL) {
                    SaarthiField(
                        value = specification,
                        onValueChange = { specification = it.take(300) },
                        label = "Grade or brand (optional)",
                        leading = Lucide.fileText,
                        placeholder = "Any grade · washed",
                    )
                }
            }
            KIND_CAB -> {
                CompactField(
                    value = passengers,
                    onValueChange = { passengers = it.filter(Char::isDigit).take(2) },
                    label = "People",
                    placeholder = "4",
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HireBases.forEach { (value, label) -> ChoiceChip(label, selected = hireBasis == value, onClick = { hireBasis = value }, height = 36.dp) }
                }
                if (hireBasis == "DAILY") {
                    CompactField(
                        value = days,
                        onValueChange = { days = it.filter(Char::isDigit).take(2) },
                        label = "Days",
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    )
                }
            }
            else -> {
                SaarthiField(
                    value = destinationsText,
                    onValueChange = { destinationsText = it.take(400) },
                    label = "Places to visit",
                    leading = Lucide.flag,
                    placeholder = "Mahabaleshwar, Panchgani",
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CompactField(
                        value = passengers,
                        onValueChange = { passengers = it.filter(Char::isDigit).take(2) },
                        label = "People",
                        placeholder = "6",
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(1f),
                    )
                    CompactField(
                        value = days,
                        onValueChange = { days = it.filter(Char::isDigit).take(2) },
                        label = "Days",
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        if (travel) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CabTypes.forEach { (value, label) -> ChoiceChip(label, selected = vehicleType == value, onClick = { vehicleType = value }, height = 36.dp) }
            }
        }

        // When it is needed: a date, chosen from the phone's own calendar.
        val chosen = LocalDate.parse(day)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (travel) "Travel on" else "Needed by", style = SType.fieldLabel, color = c.muted)
            Row(
                Modifier
                    .fillMaxWidth()
                    .card(radius = 16.dp, color = c.elevated, ring = c.input, elevated = false)
                    .pressable(scale = 0.99f) {
                        DatePickerDialog(
                            context,
                            { _, year, month, dayOfMonth -> day = LocalDate.of(year, month + 1, dayOfMonth).toString() },
                            chosen.year,
                            chosen.monthValue - 1,
                            chosen.dayOfMonth,
                        ).apply { datePicker.minDate = System.currentTimeMillis() }.show()
                    }
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                com.saarthi.owner.ui.design.LineIcon(Lucide.calendar, size = 20.dp, color = c.primary)
                Text(DayFormat.format(chosen), style = SType.field, color = c.fg)
            }
        }

        if (kind != KIND_MATERIAL) {
            PlaceField(
                label = if (travel) "Pick up from" else "Pick up from",
                place = from,
                places = app.places,
                onPick = { from = it },
                icon = Lucide.navigation,
            )
        }
        PlaceField(
            label = when (kind) {
                KIND_MATERIAL -> "Deliver to"
                KIND_TOUR -> "Tour ends at (optional)"
                KIND_CAB -> "Going to"
                else -> "Drop at"
            },
            place = to,
            places = app.places,
            onPick = { to = it },
        )

        if (kind == KIND_MATERIAL) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(c.successWash)
                    .border(1.dp, c.successGlow, RoundedCornerShape(18.dp))
                    .padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                IconWell(Lucide.truck, well = c.successSoft, ink = c.success, size = 36.dp, radius = 12.dp, iconSize = 16.dp)
                Column(Modifier.weight(1f)) {
                    Text("One price, delivered", style = SType.bodyStrong, color = c.fg)
                    Text(
                        "A verified fleet buys the material, loads it and brings it to your site. You deal only with that fleet.",
                        style = SType.small,
                        color = c.muted,
                    )
                }
            }
        }

        error?.let { RevealedNotice(it, NoticeTone.DANGER) }

        SaarthiButton(
            "Post and get bids",
            onClick = ::post,
            enabled = ready,
            busy = busy,
            busyText = "Posting…",
            trailing = Lucide.arrowRight,
        )
        Text(
            when {
                missing != null -> "Add $missing to post."
                kind == KIND_MATERIAL -> "Fleets near your site check sellers' stock and bid."
                else -> "Fleets and operators near you bid within hours."
            },
            style = SType.caption,
            color = c.subtle,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * Bidding closes two hours before the job — within the server's window of
 * at least two hours from now and at most three days.
 */
private fun bidWindowFor(start: java.time.Instant): java.time.Instant {
    val now = java.time.Instant.now()
    val earliest = now.plus(java.time.Duration.ofHours(2)).plusSeconds(60)
    val latest = now.plus(java.time.Duration.ofHours(72))
    val wanted = start.minus(java.time.Duration.ofHours(2))
    return when {
        wanted.isBefore(earliest) -> earliest
        wanted.isAfter(latest) -> latest
        else -> wanted
    }
}
