package com.saarthi.owner.ui.travel

import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.DriversApi
import com.saarthi.owner.network.HandoverApi
import com.saarthi.owner.network.TravelApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.dial
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rememberPhoto
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.common.vehiclePhotoOf
import com.saarthi.owner.ui.design.Avatar
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.NotesField
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.brandGradient
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.fleet.RouteStops
import com.saarthi.owner.ui.orders.FleetHandoverCard
import com.saarthi.owner.ui.orders.OverrideHandoverSheet
import com.saarthi.owner.ui.orders.PickupCodeSheet
import kotlinx.coroutines.launch

/**
 * One booking — the design's Travel · Booking: when, who, where, which
 * vehicle and driver, what was paid, and the next step in its life.
 */
@Composable
fun TravelBookingScreen(app: OwnerApp, initial: TravelApi.Booking, onChanged: () -> Unit) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var booking by remember { mutableStateOf(initial) }
    var vehicles by remember { mutableStateOf<List<VehiclesApi.Vehicle>>(emptyList()) }
    var drivers by remember { mutableStateOf<List<DriversApi.Driver>>(emptyList()) }
    var vehicleId by remember { mutableStateOf(initial.vehicle?.id) }
    var driverId by remember { mutableStateOf(initial.driver?.id) }
    var declining by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }
    val awaiting = booking.status == "AWAITING_CONFIRMATION"
    // The passenger's pickup code: asked for to start the ride, or the owner's override.
    var handovers by remember { mutableStateOf<List<HandoverApi.Handover>>(emptyList()) }
    var askingCode by remember { mutableStateOf(false) }
    var codeError by remember { mutableStateOf<String?>(null) }
    var overriding by remember { mutableStateOf<String?>(null) }
    var overrideError by remember { mutableStateOf<String?>(null) }
    val canOverride = app.session.account.value?.membershipRole == "FLEET_OWNER"
    val pickupPending = handovers.any { it.purpose == HandoverApi.PICKUP && it.pending }

    suspend fun loadHandovers() {
        handovers = booking.tripId?.let { trip -> runCatching { app.handover.forTrip(trip) }.getOrNull() }.orEmpty()
    }

    LaunchedEffect(initial.id) {
        runCatching { app.travel.get(initial.id) }.getOrNull()?.let { booking = it }
        loadHandovers()
        if (awaiting) {
            vehicles = runCatching { app.vehicles.list() }.getOrDefault(emptyList())
            drivers = runCatching { app.drivers.list() }.getOrDefault(emptyList()).filter { it.availability != "SUSPENDED" }
        }
    }

    fun act(done: String, call: suspend () -> TravelApi.Booking?) {
        busy = true
        message = null
        scope.launch {
            try {
                call()?.let { booking = it }
                message = done to NoticeTone.SUCCESS
                onChanged()
            } catch (failure: Exception) {
                message = failure.readable() to NoticeTone.DANGER
            }
            busy = false
        }
    }

    DetailScreen(
        eyebrow = "Booking ${booking.reference}",
        title = booking.title,
        footer = {
            when (booking.status) {
                "AWAITING_CONFIRMATION" -> {
                    SaarthiButton(
                        "Confirm this booking",
                        onClick = { act("Confirmed. The customer has been told.") { app.travel.confirm(booking.id, vehicleId, driverId) } },
                        busy = busy,
                        enabled = vehicleId != null,
                    )
                    SaarthiButton("Decline", onClick = { declining = true }, tone = ButtonTone.DANGER_OUTLINE, enabled = !busy, height = 48.dp)
                }
                "CONFIRMED" -> SaarthiButton(
                    "Start the trip",
                    onClick = {
                        if (pickupPending) {
                            codeError = null
                            askingCode = true
                        } else {
                            act("Trip started.") { app.travel.start(booking.id) }
                        }
                    },
                    busy = busy,
                    leading = Lucide.play,
                )
                "IN_PROGRESS" -> SaarthiButton("Finish the trip", onClick = { act("Trip finished.") { app.travel.complete(booking.id) } }, busy = busy, leading = Lucide.flag)
                else -> Unit
            }
        },
    ) {
        val (word, _, _) = bookingLook(booking.status)
        BookingHero(booking, word, Modifier.rise())

        message?.let { (text, tone) -> RevealedNotice(text, tone) }

        Row(
            Modifier.fillMaxWidth().rise(stagger(1)).card(radius = 22.dp).padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Avatar(booking.contactName ?: "Customer", size = 44.dp, background = c.primarySoft, ink = c.primary)
            Column(Modifier.weight(1f)) {
                Text(booking.contactName ?: "Customer", style = SType.bodyStrong, color = c.fg)
                Text(
                    listOfNotNull(booking.passengers?.let { "$it people" }, booking.specialRequests?.take(40)).joinToString(" · "),
                    style = SType.caption,
                    color = c.muted,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            booking.contactPhone?.let { phone ->
                CircleButton(Lucide.phone, "Call ${booking.contactName ?: "the customer"}", { context.dial(phone) }, size = 44.dp, iconSize = 18.dp)
            }
        }

        BookingRouteCard(booking, Modifier.rise(stagger(2)))

        handovers.forEach { handover ->
            FleetHandoverCard(
                handover,
                canOverride = false,
                onOverride = {},
                modifier = Modifier.rise(stagger(2)),
            )
        }

        if (awaiting) {
            GroupLabel("Which vehicle goes")
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                vehicles.forEach { vehicle ->
                    ChoiceChip(
                        com.saarthi.owner.ui.common.formatPlate(vehicle.registrationNumber),
                        selected = vehicleId == vehicle.id,
                        onClick = { vehicleId = vehicle.id },
                    )
                }
            }
            if (drivers.isNotEmpty()) {
                GroupLabel("Who drives")
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    drivers.forEach { driver ->
                        ChoiceChip(driver.fullName, selected = driverId == driver.id, onClick = { driverId = driver.id })
                    }
                }
            }
        }

        Row(
            Modifier.fillMaxWidth().rise(stagger(3)).card(radius = 22.dp).padding(18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Payment", style = SType.cardTitle, color = c.fg)
                val payment = booking.paymentStatus
                Text(
                    when (payment) {
                        "SUCCEEDED" -> "Paid by the customer"
                        "PENDING", null -> "Not paid yet"
                        "FAILED" -> "The customer's payment failed"
                        else -> payment.lowercase().replace('_', ' ')
                    },
                    style = SType.caption,
                    color = c.muted,
                )
            }
            Text(booking.totalAmount?.let(::rupees) ?: "—", style = SType.headerTitle, color = c.fg)
        }
    }

    PickupCodeSheet(
        visible = askingCode,
        busy = busy,
        error = codeError,
        canOverride = canOverride,
        onStart = { code ->
            busy = true
            codeError = null
            scope.launch {
                try {
                    app.travel.start(booking.id, code)?.let { booking = it }
                    askingCode = false
                    message = "Trip started." to NoticeTone.SUCCESS
                    loadHandovers()
                    onChanged()
                } catch (failure: Exception) {
                    codeError = failure.readable()
                }
                busy = false
            }
        },
        onNoCode = {
            askingCode = false
            overrideError = null
            overriding = HandoverApi.PICKUP
        },
        onDismiss = { askingCode = false },
    )

    OverrideHandoverSheet(
        purpose = overriding,
        busy = busy,
        error = overrideError,
        onConfirm = { why ->
            val tripId = booking.tripId
            if (tripId != null) {
                busy = true
                overrideError = null
                scope.launch {
                    try {
                        app.handover.override(tripId, HandoverApi.PICKUP, why)
                        app.travel.start(booking.id)?.let { booking = it }
                        overriding = null
                        message = "Started without the code. The reason is on record and the passenger has been told." to NoticeTone.SUCCESS
                        loadHandovers()
                        onChanged()
                    } catch (failure: Exception) {
                        overrideError = failure.readable()
                    }
                    busy = false
                }
            }
        },
        onDismiss = { overriding = null },
    )

    BottomSheet(visible = declining, onDismiss = { declining = false }) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Why can't you take it?", style = SType.sheetTitle, color = c.fg)
            NotesField(reason, { reason = it.take(500) }, label = "The customer sees this", minHeight = 90.dp)
            SaarthiButton(
                "Decline booking",
                onClick = {
                    declining = false
                    act("Declined. The customer has been told.") { app.travel.decline(booking.id, reason.trim()) }
                },
                tone = ButtonTone.DANGER_OUTLINE,
                enabled = reason.trim().length >= 3,
            )
        }
    }
}

/** The booking's banner: when, how many, how far, and [word] for where it stands. Shared with the customer's view. */
@Composable
internal fun BookingHero(booking: TravelApi.Booking, word: String, modifier: Modifier = Modifier) {
    val start = clockOf(booking.startDate)
    Box(
        modifier
            .fillMaxWidth()
            .height(176.dp)
            .shadow(16.dp, RoundedCornerShape(28.dp), spotColor = Color(0xBF021D40), ambientColor = Color.Transparent)
            .brandGradient(RoundedCornerShape(28.dp)),
    ) {
        val photo = rememberPhoto(vehiclePhotoOf(booking.vehicle?.vehicleType ?: "SUV") ?: R.drawable.vehicle_suv)
        if (photo != null) {
            Image(photo, null, contentScale = ContentScale.Fit, modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp).size(width = 150.dp, height = 80.dp))
        }
        Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Eyebrow(start ?: "Booked", Modifier.weight(1f), color = Color.White.copy(alpha = 0.75f))
                StatusPill(word, background = Color.White.copy(alpha = 0.14f), ink = Color.White, live = booking.status == "IN_PROGRESS", ring = Color.White.copy(alpha = 0.2f))
            }
            Text(
                listOfNotNull(
                    booking.passengers?.let { "$it people" },
                    booking.durationDays?.let { "$it day${if (it == 1) "" else "s"}" },
                ).joinToString(" · ").ifBlank { booking.title },
                style = SType.title.copy(fontSize = 24.sp),
                modifier = Modifier.fillMaxWidth(0.58f),
                color = Color.White,
            )
            booking.distanceKm?.let { Text("${it.toInt()} km", style = SType.small, color = Color.White.copy(alpha = 0.8f)) }
        }
    }
}

/** Where the trip starts and ends, and the vehicle and driver once they are named. */
@Composable
internal fun BookingRouteCard(booking: TravelApi.Booking, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val start = clockOf(booking.startDate)
    Column(modifier.fillMaxWidth().card(radius = 22.dp).padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        RouteStops(
            from = booking.pickupAddress ?: "Pickup",
            fromNote = start?.let { "Pick up $it" },
            to = booking.dropoffAddress ?: booking.destinations.joinToString(", ").ifBlank { "Destination" },
            toNote = clockOf(booking.endDate)?.let { "Back $it" },
        )
        if (booking.vehicle != null || booking.driver != null) {
            Eyebrow("Vehicle & driver")
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                booking.vehicle?.registrationNumber?.let { PlateChip(it, size = 12.sp) }
                Text(
                    listOfNotNull(booking.vehicle?.model, booking.driver?.name).joinToString(" · "),
                    style = SType.small,
                    color = c.muted,
                )
            }
        }
    }
}
