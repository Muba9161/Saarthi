package com.saarthi.owner.ui.customer

import android.app.TimePickerDialog
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.PlacesApi
import com.saarthi.owner.network.TravelPackagesApi
import com.saarthi.owner.ui.common.DayField
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.PlaceField
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.NotesField
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.tracking.attempt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// Made on each use, so the month and day names follow the app\'s language when it changes.
private val TimeLabel: DateTimeFormatter get() = DateTimeFormatter.ofPattern("h:mm a")
private val PHONE = Regex("^(\\+91)?[6-9][0-9]{9}$")

/**
 * Booking a trip, as the web's three steps put on one page: who is going and
 * when, how to reach the customer, and where to pick them up (and drop them,
 * for a trip priced by the kilometre) — with the price for the party as it
 * stands. The booking is made unpaid; paying is the booking's next step.
 */
@Composable
internal fun BookTripScreen(app: OwnerApp, trip: TravelPackagesApi.Package, onBooked: () -> Unit) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    val account = app.session.account.value
    val earliestDay = maxOf(LocalDate.now().plusDays(trip.advanceBookingDays.toLong()), LocalDate.now())

    var passengers by remember { mutableStateOf(trip.minPassengers.coerceAtLeast(1).toString()) }
    var day by remember { mutableStateOf<LocalDate?>(null) }
    var time by remember { mutableStateOf(LocalTime.of(8, 0)) }
    var name by remember { mutableStateOf(account?.fullName.orEmpty()) }
    var phone by remember { mutableStateOf("") }
    var pickup by remember { mutableStateOf<PlacesApi.Place?>(null) }
    var dropoff by remember { mutableStateOf<PlacesApi.Place?>(null) }
    var requests by remember { mutableStateOf("") }
    var quote by remember { mutableStateOf<TravelPackagesApi.Quote?>(null) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }

    val party = passengers.toIntOrNull()
    val partyFits = party != null && party in trip.minPassengers..trip.maxPassengers
    val startsAt = day?.let { LocalDateTime.of(it, time) }
    val whenProblem = startsAt?.let { whenProblem(trip, it) }
    val phoneFits = PHONE.matches(phone.filter { it.isDigit() || it == '+' })
    val dropFits = !trip.needsDropoff || dropoff != null

    // The price follows the party and the drop, a moment after they change.
    LaunchedEffect(party, dropoff) {
        quote = null
        if (!partyFits) return@LaunchedEffect
        delay(QUOTE_AFTER_MS)
        quote = attempt { app.travelPackages.quote(trip.id, party!!, dropoff) }
    }

    val ready = partyFits && startsAt != null && whenProblem == null && name.trim().length >= 2 && phoneFits && dropFits && !busy

    DetailScreen(
        eyebrow = stringResource(R.string.customer_book_a_trip),
        title = trip.title,
        footer = {
            problem?.let { NoticeCard(it, NoticeTone.DANGER) }
            SaarthiButton(
                quote?.let { stringResource(R.string.customer_book_for, rupees(it.total)) } ?: stringResource(R.string.customer_book),
                onClick = {
                    busy = true
                    problem = null
                    scope.launch {
                        try {
                            val booking = app.travelPackages.book(
                                TravelPackagesApi.NewBooking(
                                    packageId = trip.id,
                                    startAt = startsAt!!.atZone(ZoneId.systemDefault()).toInstant().toString(),
                                    passengers = party!!,
                                    contactName = name,
                                    contactPhone = phone.filter { it.isDigit() || it == '+' },
                                    pickup = pickup,
                                    dropoff = dropoff,
                                    specialRequests = requests.trim(),
                                ),
                            )
                            onBooked()
                            // Straight to the booking, where paying holds the vehicle.
                            booking?.let { navigator.replace("booking-${it.id}") { CustomerBookingScreen(app, it, onBooked) } } ?: navigator.pop()
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
                busyText = stringResource(R.string.customer_booking_busy),
            )
            Text(stringResource(R.string.customer_book_pay_next), style = SType.caption, color = c.subtle, modifier = Modifier.fillMaxWidth())
        },
    ) {
        GroupLabel(stringResource(R.string.customer_trip))
        CompactField(
            passengers,
            { passengers = it.filter(Char::isDigit).take(2) },
            stringResource(R.string.customer_book_passengers, trip.minPassengers, trip.maxPassengers),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        if (party != null && !partyFits) {
            Text(stringResource(R.string.customer_book_party_range, trip.minPassengers, trip.maxPassengers), style = SType.small, color = c.danger)
        }
        DayField(stringResource(R.string.customer_book_starts_on), day, onPick = { day = it }, earliest = earliestDay, latest = LocalDate.now().plusDays(MAX_DAYS_AHEAD))
        Row(
            Modifier
                .fillMaxWidth()
                .card(radius = 14.dp, color = c.elevated, ring = c.input, elevated = false)
                .pressable(scale = 0.99f, label = stringResource(R.string.customer_book_choose_start_time)) {
                    TimePickerDialog(context, { _, hour, minute -> time = LocalTime.of(hour, minute) }, time.hour, time.minute, false).show()
                }
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            LineIcon(Lucide.clock, size = 18.dp, color = c.primary)
            Text(stringResource(R.string.customer_book_pickup_time), style = SType.small, color = c.muted, modifier = Modifier.weight(1f))
            Text(TimeLabel.format(time), style = SType.smallStrong, color = c.fg)
        }
        whenProblem?.let { Text(it, style = SType.small, color = c.danger) }

        GroupLabel(stringResource(R.string.customer_book_contact))
        CompactField(name, { name = it.take(160) }, stringResource(R.string.customer_name))
        CompactField(
            phone,
            { phone = it.take(14) },
            stringResource(R.string.customer_mobile_number),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            placeholder = "98XXXXXXXX",
        )
        if (phone.isNotBlank() && !phoneFits) Text(stringResource(R.string.customer_book_phone_invalid), style = SType.small, color = c.danger)

        GroupLabel(stringResource(R.string.customer_book_journey))
        PlaceField(
            label = stringResource(R.string.customer_pick_up_from_optional),
            place = pickup,
            places = app.places,
            onPick = { pickup = it },
            placeholder = trip.startLocation,
            icon = Lucide.navigation,
        )
        PlaceField(
            label = stringResource(if (trip.needsDropoff) R.string.customer_drop_at else R.string.customer_drop_at_optional),
            place = dropoff,
            places = app.places,
            onPick = { dropoff = it },
        )
        if (trip.needsDropoff) Text(stringResource(R.string.customer_book_drop_needed), style = SType.caption, color = c.subtle)
        NotesField(requests, { requests = it.take(2000) }, label = stringResource(R.string.customer_book_operator_notes), minHeight = 72.dp)

        quote?.let { price ->
            Column(Modifier.fillMaxWidth().card(radius = 20.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Eyebrow(stringResource(R.string.customer_book_price_for_party))
                Row {
                    Text(stringResource(R.string.customer_trip), style = SType.small, color = c.muted, modifier = Modifier.weight(1f))
                    Text(rupees(price.subtotal), style = SType.smallStrong, color = c.fg)
                }
                if (price.platformFee > 0) {
                    Row {
                        Text(stringResource(R.string.customer_book_booking_fee), style = SType.small, color = c.muted, modifier = Modifier.weight(1f))
                        Text(rupees(price.platformFee), style = SType.smallStrong, color = c.fg)
                    }
                }
                Row {
                    Text(stringResource(R.string.customer_total), style = SType.bodyStrong, color = c.fg, modifier = Modifier.weight(1f))
                    Text(rupees(price.total), style = SType.bodyStrong, color = c.fg)
                }
            }
        }
    }
}

/** Why a start time will not do, in the server's terms; null when it will. */
private fun whenProblem(trip: TravelPackagesApi.Package, startsAt: LocalDateTime): String? {
    val now = LocalDateTime.now()
    val day = startsAt.toLocalDate()
    return when {
        Duration.between(now, startsAt).toHours() < TravelPackagesApi.LEAD_HOURS -> Words.get(R.string.customer_book_lead_hours, TravelPackagesApi.LEAD_HOURS)
        trip.advanceBookingDays > 0 && day.isBefore(LocalDate.now().plusDays(trip.advanceBookingDays.toLong())) ->
            Words.plural(R.plurals.customer_book_notice_days, trip.advanceBookingDays)
        trip.availableFrom?.let { from -> runCatching { LocalDate.parse(from.take(10)) }.getOrNull()?.let { day.isBefore(it) } } == true ->
            Words.get(R.string.customer_book_runs_from, trip.availableFrom!!.take(10))
        trip.availableTo?.let { to -> runCatching { LocalDate.parse(to.take(10)) }.getOrNull()?.let { day.isAfter(it) } } == true ->
            Words.get(R.string.customer_book_runs_until, trip.availableTo!!.take(10))
        trip.availableWeekdays.isNotEmpty() && (day.dayOfWeek.value % 7) !in trip.availableWeekdays -> {
            val weekdays = WEEKDAYS
            Words.get(R.string.customer_book_runs_on, trip.availableWeekdays.sorted().joinToString(", ") { weekdays[it] })
        }
        else -> null
    }
}

/** 0 is Sunday, as the server counts. */
private val WEEKDAYS: List<String>
    get() = listOf(
        Words.get(R.string.customer_weekday_sundays),
        Words.get(R.string.customer_weekday_mondays),
        Words.get(R.string.customer_weekday_tuesdays),
        Words.get(R.string.customer_weekday_wednesdays),
        Words.get(R.string.customer_weekday_thursdays),
        Words.get(R.string.customer_weekday_fridays),
        Words.get(R.string.customer_weekday_saturdays),
    )
private const val MAX_DAYS_AHEAD = 365L
private const val QUOTE_AFTER_MS = 400L
