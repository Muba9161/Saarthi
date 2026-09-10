package com.saarthi.driver.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Timer
import androidx.compose.material.icons.rounded.LocalGasStation
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Sos
import androidx.compose.material.icons.rounded.Speed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.saarthi.driver.R
import androidx.compose.ui.unit.dp
import com.saarthi.core.domain.DrivingHours
import com.saarthi.core.domain.PumpPrice
import com.saarthi.core.domain.TerminalState
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.SaarthiDriverApp
import com.saarthi.driver.data.DriverAccountStore
import com.saarthi.driver.ui.design.AlertRed
import com.saarthi.driver.ui.design.FieldLabel
import com.saarthi.driver.ui.design.FleetNotice
import com.saarthi.driver.ui.design.FleetRadius
import com.saarthi.driver.ui.design.TileRow
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.CautionAmber
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.CurrentTrackingCard
import com.saarthi.driver.ui.design.FleetButton
import com.saarthi.driver.ui.design.FleetCard
import com.saarthi.driver.ui.design.FleetEnter
import com.saarthi.driver.ui.design.FleetScreen
import com.saarthi.driver.ui.design.FleetSlideAction
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.FleetTile
import com.saarthi.driver.ui.design.LiveGreen
import com.saarthi.driver.ui.design.Monogram
import com.saarthi.driver.ui.design.SectionHeader
import com.saarthi.driver.ui.design.Slate
import com.saarthi.driver.ui.design.StatusPill

/**
 * The driver's home, once they are on a vehicle.
 *
 * Sits between signing on and driving. The cockpit is a map and four dials, and
 * it is the right surface for a moving truck — but a driver standing at a
 * loading bay wants a different answer: which vehicle am I on, is the fleet
 * receiving me, and what am I about to do. Opening a full-screen map to learn
 * that was the wrong shape.
 *
 * Everything on it is read from the terminal state the server sent. Nothing here
 * is inferred locally, because a dashboard that disagrees with the fleet's own
 * record is worse than one that shows less.
 *
 * Starting the trip is a slide rather than a tap. See [FleetSlideAction] — a
 * phone wedged in a dashboard cradle collects accidental taps all day, and this
 * is the action that tells a fleet a truck is moving.
 */
@Composable
fun DriverDashboardScreen(
    cockpit: TerminalViewModel,
    account: DriverAccountStore.Account,
    onOpenProfile: () -> Unit,
    onOpenChecklist: () -> Unit,
    onOpenPapers: () -> Unit,
    onOpenTrips: () -> Unit,
    onOpenNotices: () -> Unit,
    onOpenCockpit: () -> Unit,
    onOpenNearby: () -> Unit,
    onSos: () -> Unit,
) {
    val state by cockpit.uiState.collectAsState()
    val fastag by cockpit.fastag.collectAsState()
    val fuelPrice by cockpit.fuelPrice.collectAsState()
    val papers by cockpit.papers.collectAsState()
    val cachedPapers by (LocalContext.current.applicationContext as SaarthiDriverApp)
        .papers.cached.collectAsState()
    val notices by cockpit.notifications.collectAsState()
    val hours by cockpit.hours.collectAsState()
    val registration = state.registration
    val firstName = account.name.substringBefore(' ').ifBlank { "driver" }

    /*
     * Fetched once when the dashboard appears, not on a timer.
     *
     * None of these change minute to minute — a FASTag balance, a set of
     * papers, today's diesel rate — and polling them from a cab would spend a
     * driver's data on answers that had not moved.
     */
    val fuelType = state.server?.vehicle?.fuelType
    val shownFuels = PumpPrice.shownFor(fuelType)

    LaunchedEffect(registration) {
        cockpit.loadFastag()
        // Skipped for a vehicle that can use no published rate. The lookup costs
        // a reverse geocode and a provider fetch, and for an electric van both
        // would be spent on a number it cannot act on.
        if (PumpPrice.worthFetching(fuelType)) cockpit.loadFuelPrice()
        cockpit.loadPapers()
        cockpit.loadNotifications()
    }

    FleetScreen {
        Spacer(Modifier.height(FleetSpace.snug))

        // --- Who, and a way to their profile ---------------------------------
        FleetEnter(index = 0) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(FleetSpace.snug),
            ) {
                Monogram(account.name, size = 48.dp, onClick = onOpenProfile)
                Column(Modifier.weight(1f)) {
                    Text(
                        stringResource(R.string.greeting, firstName),
                        style = MaterialTheme.typography.titleLarge,
                        color = Chalk,
                    )
                    Text(
                        account.email.ifBlank { "Signed in" },
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                        maxLines = 1,
                    )
                }
                /*
                 * Three states, not two.
                 *
                 * "Anything but offline is live" told a driver Saarthi was
                 * reporting before it had reached a server at all — and kept
                 * saying it when the API could not be resolved. Connecting is
                 * its own answer.
                 */
                StatusPill(
                    label = stringResource(
                        when {
                            state.live -> R.string.status_live
                            state.offline -> R.string.status_offline
                            else -> R.string.status_connecting
                        },
                    ),
                    tint = when {
                        state.live -> LiveGreen
                        state.offline -> CautionAmber
                        else -> Slate
                    },
                    live = state.live,
                )
            }
        }

        Spacer(Modifier.height(FleetSpace.section))

        /*
         * Hours at the wheel, when they are worth saying.
         *
         * Above the vehicle card, and only when there is something to say. A
         * fatigue figure shown permanently becomes furniture; shown at four and
         * a half hours it is a reason to start looking for a dhaba.
         */
        val advice = hours.advice
        if (advice != DrivingHours.Advice.NONE) {
            FleetEnter(index = 1) {
                Column {
                    FleetNotice(
                        message = when (advice) {
                            DrivingHours.Advice.BREAK_SOON -> stringResource(
                                R.string.hours_break_soon,
                                DrivingHours.format(hours.stintMs),
                            )
                            DrivingHours.Advice.BREAK_DUE -> stringResource(
                                R.string.hours_break_due,
                                DrivingHours.format(hours.stintMs),
                            )
                            DrivingHours.Advice.SHIFT_SOON -> stringResource(
                                R.string.hours_shift_soon,
                                DrivingHours.format(hours.todayMs),
                            )
                            DrivingHours.Advice.SHIFT_DUE -> stringResource(
                                R.string.hours_shift_due,
                                DrivingHours.format(hours.todayMs),
                            )
                            DrivingHours.Advice.NONE -> ""
                        },
                        tint = when (advice) {
                            DrivingHours.Advice.BREAK_DUE,
                            DrivingHours.Advice.SHIFT_DUE,
                            -> AlertRed
                            else -> CautionAmber
                        },
                    )
                    Spacer(Modifier.height(FleetSpace.snug))
                }
            }
        }

        // --- The vehicle, as the headline ------------------------------------
        if (registration != null) {
            FleetEnter(index = 1) {
                CurrentTrackingCard(
                    code = registration,
                    detailLabel = stringResource(R.string.label_reporting),
                    detailValue = stringResource(
                        when {
                            state.live -> R.string.reporting_live
                            state.offline -> R.string.reporting_saved
                            else -> R.string.reporting_connecting
                        },
                    ),
                    statusLabel = state.state.driverWord(),
                    statusTint = when {
                        state.live -> LiveGreen
                        state.offline -> CautionAmber
                        else -> Slate
                    },
                    live = state.live,
                    onClick = onOpenCockpit,
                )
            }

            Spacer(Modifier.height(FleetSpace.snug))
        }

        /*
         * The two numbers that decide whether a shift goes smoothly.
         *
         * A FASTag that is empty an hour before a plaza is trivial to top up and
         * impossible to argue with once the barrier is down; a diesel rate is
         * what a driver is asked to account for at the end of a run. Both were
         * on the platform already and visible only to somebody at a desk.
         */
        if (fastag != null || (fuelPrice != null && shownFuels.isNotEmpty())) {
            FleetEnter(index = 2) {
                Column {
                    TileRow {
                        fastag?.let { tag ->
                            FleetCard(
                                Modifier.weight(1f),
                                padding = FleetSpace.base,
                                corner = FleetRadius.tile,
                            ) {
                                FieldLabel(stringResource(R.string.label_fastag))
                                Spacer(Modifier.height(FleetSpace.hair))
                                Text(
                                    // A balance the bank has not reported is not
                                    // zero, and must never be drawn as one.
                                    tag.balanceRupees?.let { "₹%,.0f".format(it) } ?: "-",
                                    style = MaterialTheme.typography.titleLarge,
                                    color = when {
                                        tag.balanceRupees == null -> Slate
                                        tag.lowBalance -> AlertRed
                                        else -> Chalk
                                    },
                                    maxLines = 1,
                                )
                                Spacer(Modifier.height(FleetSpace.hair))
                                Text(
                                    when {
                                        tag.status != "ACTIVE" -> tag.status.lowercase()
                                        tag.lowBalance -> stringResource(R.string.fastag_low)
                                        tag.balanceRupees == null ->
                                            stringResource(R.string.fastag_unknown)
                                        else -> tag.issuerBank
                                            ?: stringResource(R.string.status_live)
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (tag.lowBalance) AlertRed else Slate,
                                    maxLines = 2,
                                )
                            }
                        }

                        /*
                         * The rate for the fuel this vehicle actually takes.
                         *
                         * It said "Diesel today" to everything on the platform,
                         * so an electric scooter was shown the price of diesel —
                         * the same fault as the nearby list offering it petrol
                         * pumps. `PumpPrice` decides; see it for why an
                         * unrecorded fuel type shows every rate rather than a
                         * guess, and why electric shows none.
                         */
                        val rates = shownFuels.mapNotNull { fuel ->
                            val rupees = when (fuel) {
                                PumpPrice.Fuel.DIESEL -> fuelPrice?.diesel
                                PumpPrice.Fuel.PETROL -> fuelPrice?.petrol
                                PumpPrice.Fuel.CNG -> fuelPrice?.cng
                            }
                            rupees?.let { fuel to it }
                        }
                        val price = fuelPrice

                        if (price != null && shownFuels.isNotEmpty()) {
                            FleetCard(
                                Modifier.weight(1f),
                                padding = FleetSpace.base,
                                corner = FleetRadius.tile,
                            ) {
                                FieldLabel(
                                    stringResource(
                                        // One fuel gets its own name; several get
                                        // a heading, because each line is then
                                        // labelled with the fuel it belongs to.
                                        if (rates.size == 1) {
                                            when (rates.first().first) {
                                                PumpPrice.Fuel.DIESEL -> R.string.label_diesel
                                                PumpPrice.Fuel.PETROL -> R.string.label_petrol
                                                PumpPrice.Fuel.CNG -> R.string.label_cng
                                            }
                                        } else {
                                            R.string.label_pump_prices
                                        },
                                    ),
                                )
                                Spacer(Modifier.height(FleetSpace.hair))

                                if (rates.isEmpty()) {
                                    Text(
                                        "-",
                                        style = MaterialTheme.typography.titleLarge,
                                        color = Slate,
                                    )
                                    Spacer(Modifier.height(FleetSpace.hair))
                                    Text(
                                        stringResource(R.string.rate_none_here, price.city),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = Slate,
                                        maxLines = 2,
                                    )
                                } else {
                                    rates.forEachIndexed { index, (fuel, rupees) ->
                                        if (index > 0) Spacer(Modifier.height(FleetSpace.hair))
                                        Row(verticalAlignment = Alignment.Bottom) {
                                            Text(
                                                "₹%.2f".format(rupees),
                                                style = MaterialTheme.typography.titleLarge,
                                                color = Chalk,
                                                maxLines = 1,
                                            )
                                            if (rates.size > 1) {
                                                Text(
                                                    " " + stringResource(
                                                        when (fuel) {
                                                            PumpPrice.Fuel.DIESEL ->
                                                                R.string.fuel_diesel
                                                            PumpPrice.Fuel.PETROL ->
                                                                R.string.fuel_petrol
                                                            PumpPrice.Fuel.CNG -> R.string.fuel_cng
                                                        },
                                                    ),
                                                    style = MaterialTheme.typography.labelSmall,
                                                    color = Slate,
                                                )
                                            }
                                        }
                                    }

                                    Spacer(Modifier.height(FleetSpace.hair))
                                    Text(
                                        // The unit, the place and the date. A
                                        // rate without all three is a number a
                                        // driver cannot check — and CNG is sold
                                        // by weight, so "a litre" would be wrong
                                        // by about a third.
                                        listOfNotNull(
                                            if (rates.size == 1) {
                                                stringResource(
                                                    when (
                                                        PumpPrice.unitOf(rates.first().first)
                                                    ) {
                                                        PumpPrice.Unit.KILOGRAM ->
                                                            R.string.unit_per_kg
                                                        PumpPrice.Unit.LITRE ->
                                                            R.string.unit_per_litre
                                                    },
                                                )
                                            } else {
                                                null
                                            },
                                            price.city,
                                            price.publishedOn,
                                        ).joinToString(" · "),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = Slate,
                                        maxLines = 2,
                                    )
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(FleetSpace.snug))
                }
            }
        }

        // --- What a driver does from here ------------------------------------
        FleetEnter(index = 2) {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(FleetSpace.tight)) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(FleetSpace.tight),
                ) {
                    FleetTile(
                        icon = Icons.Rounded.Speed,
                        title = stringResource(R.string.tile_live_view),
                        subtitle = stringResource(R.string.tile_live_view_sub),
                        onClick = onOpenCockpit,
                        accent = true,
                        modifier = Modifier.weight(1f),
                    )
                    FleetTile(
                        icon = Icons.Rounded.LocalGasStation,
                        title = stringResource(R.string.tile_nearby),
                        subtitle = stringResource(R.string.tile_nearby_sub),
                        onClick = onOpenNearby,
                        modifier = Modifier.weight(1f),
                    )
                }
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(FleetSpace.tight),
                ) {
                    FleetTile(
                        icon = Icons.Rounded.QrCodeScanner,
                        /*
                         * No plate here.
                         *
                         * It was the subtitle, and wrapped mid-registration on a
                         * normal handset - "UP32RU690 / 7". Moving it to the
                         * title only traded that for "UP32RU6..." , and half a
                         * number plate is worse than none: a driver checking it
                         * against the truck cannot tell if they are on the right
                         * one. The registration is already the headline of the
                         * card directly above, at 30sp, so the tile repeating it
                         * badly bought nothing.
                         */
                        title = stringResource(R.string.tile_vehicle),
                        subtitle = stringResource(
                            if (registration != null) {
                                R.string.tile_vehicle_signed_on
                            } else {
                                R.string.tile_vehicle_not_signed_on
                            },
                        ),
                        onClick = onOpenCockpit,
                        modifier = Modifier.weight(1f),
                    )
                    FleetTile(
                        icon = Icons.Rounded.Sos,
                        title = stringResource(R.string.tile_emergency),
                        subtitle = stringResource(R.string.tile_emergency_sub),
                        onClick = onSos,
                        modifier = Modifier.weight(1f),
                    )
                }
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(FleetSpace.tight),
                ) {
                    FleetTile(
                        icon = Icons.Rounded.Description,
                        title = stringResource(R.string.tile_papers),
                        // The count is the useful part: a driver wants to know
                        // they are covered before a checkpoint, not at one.
                        /*
                         * How many are actually *on the phone*, not how many
                         * exist. The first wording counted the list, so it said
                         * "1 on this phone" for a document that had never
                         * downloaded — a claim a driver would find out was false
                         * at the barrier, which is the one place it matters.
                         */
                        subtitle = when {
                            papers.isEmpty() -> stringResource(R.string.tile_papers_none)
                            cachedPapers.isEmpty() ->
                                stringResource(R.string.tile_papers_none_saved, papers.size)
                            cachedPapers.size < papers.size -> stringResource(
                                R.string.tile_papers_partial,
                                cachedPapers.size,
                                papers.size,
                            )
                            else -> stringResource(R.string.tile_papers_all, papers.size)
                        },
                        onClick = onOpenPapers,
                        modifier = Modifier.weight(1f),
                    )
                    FleetTile(
                        icon = Icons.Rounded.Notifications,
                        title = stringResource(R.string.tile_notices),
                        subtitle = if (notices.unread > 0) {
                            stringResource(R.string.tile_notices_new, notices.unread)
                        } else {
                            stringResource(R.string.tile_notices_none)
                        },
                        onClick = onOpenNotices,
                        accent = notices.unread > 0,
                        modifier = Modifier.weight(1f),
                    )
                }
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(FleetSpace.tight),
                ) {
                    FleetTile(
                        icon = Icons.Rounded.History,
                        title = stringResource(R.string.tile_trips),
                        subtitle = stringResource(R.string.tile_trips_sub),
                        onClick = onOpenTrips,
                        modifier = Modifier.weight(1f),
                    )
                    FleetTile(
                        icon = Icons.Rounded.Timer,
                        title = stringResource(R.string.tile_hours),
                        // Shown plainly rather than only warned about, so a
                        // driver can see where they stand at any point.
                        subtitle = DrivingHours.format(hours.todayMs),
                        onClick = onOpenProfile,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        Spacer(Modifier.height(FleetSpace.section))

        // --- The one action, and it takes a deliberate gesture ---------------
        FleetEnter(index = 3) {
            Column(Modifier.fillMaxWidth()) {
                when (state.state) {
                    TerminalState.READY -> {
                        SectionHeader(stringResource(R.string.ready_title))
                        Spacer(Modifier.height(FleetSpace.tight))
                        Text(
                            stringResource(R.string.ready_blurb),
                            style = MaterialTheme.typography.bodyMedium,
                            color = Ash,
                        )
                        Spacer(Modifier.height(FleetSpace.snug))
                        FleetSlideAction(
                            label = stringResource(R.string.slide_start_trip),
                            onConfirm = {
                                cockpit.startTrip()
                                onOpenCockpit()
                            },
                        )
                    }

                    TerminalState.TRIP_ACTIVE -> {
                        SectionHeader(stringResource(R.string.trip_under_way))
                        Spacer(Modifier.height(FleetSpace.tight))
                        Text(
                            stringResource(R.string.trip_under_way_blurb),
                            style = MaterialTheme.typography.bodyMedium,
                            color = Ash,
                        )
                        Spacer(Modifier.height(FleetSpace.snug))
                        FleetSlideAction(
                            label = stringResource(R.string.slide_open_live),
                            onConfirm = onOpenCockpit,
                        )
                    }

                    /*
                     * The safety check, as the one thing on the screen.
                     *
                     * This is a step the driver takes right now, not a status to
                     * read, so it gets a button rather than a sentence. Before
                     * this it fell into the card below and said "open the live
                     * view to carry on" - which led to a map with no check on it
                     * and a shift that could never start.
                     */
                    /*
                     * Both states mean "do the safety check".
                     *
                     * APPROVED is the platform's word for "authorised by a named
                     * person, safety check still outstanding"; CHECKLIST_REQUIRED
                     * is the same situation a moment later. Offering the check
                     * only for the second left an approved driver on a dashboard
                     * whose only advice was "open the live view" — with no route
                     * to the check, and therefore none to starting a trip.
                     */
                    TerminalState.APPROVED,
                    TerminalState.CHECKLIST_REQUIRED,
                    -> {
                        SectionHeader(stringResource(R.string.before_you_drive))
                        Spacer(Modifier.height(FleetSpace.tight))
                        Text(
                            stringResource(R.string.before_you_drive_blurb),
                            style = MaterialTheme.typography.bodyMedium,
                            color = Ash,
                        )
                        Spacer(Modifier.height(FleetSpace.snug))
                        FleetButton(
                            label = stringResource(R.string.start_safety_check),
                            onClick = onOpenChecklist,
                        )
                    }

                    else -> {
                        /*
                         * Anything else is a step the driver cannot take from
                         * here — a decision by the fleet, or a shift already
                         * closed. Saying which is more use than a dead slider.
                         */
                        FleetCard(Modifier.fillMaxWidth()) {
                            SectionHeader(stringResource(R.string.next_step))
                            Spacer(Modifier.height(FleetSpace.tight))
                            Text(
                                state.state.driverWord(),
                                style = MaterialTheme.typography.titleMedium,
                                color = Chalk,
                            )
                            Spacer(Modifier.height(FleetSpace.tight))
                            Text(
                                stringResource(
                                    /*
                                     * Advice a driver can act on, rather than
                                     * one sentence for every dead end.
                                     *
                                     * This card said "open the live view to
                                     * carry on" whatever had happened — to a
                                     * driver waiting on their fleet, and to one
                                     * whose phone held no session at all, for
                                     * whom the live view is not reachable and
                                     * the advice was simply a wall.
                                     */
                                    when {
                                        state.state.waitingOnFleet ->
                                            R.string.next_step_awaiting
                                        state.state.signedOnToVehicle ->
                                            R.string.next_step_blurb
                                        else -> R.string.next_step_reconnect
                                    },
                                ),
                                style = MaterialTheme.typography.bodyMedium,
                                color = Ash,
                            )
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(FleetSpace.wide))
    }
}
