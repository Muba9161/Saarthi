package com.saarthi.driver.car

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.net.Uri
import android.os.SystemClock
import android.text.SpannableString
import android.text.Spanned
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarLocation
import androidx.car.app.model.Distance
import androidx.car.app.model.DistanceSpan
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Metadata
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Place
import androidx.car.app.model.PlaceListMapTemplate
import androidx.car.app.model.PlaceMarker
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.location.LocationServices
import com.saarthi.core.domain.DrivingHours
import com.saarthi.core.network.NearbyPlaceDto
import com.saarthi.core.network.RouteDto
import com.saarthi.core.telemetry.Metric
import com.saarthi.driver.SaarthiDriverApp
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * The car-screen detail views.
 *
 * All read-only, all reading the same state the phone holds. Nothing here
 * creates, edits or configures anything — Android Auto refuses that shape of
 * interaction while moving, and it would be the wrong place for it regardless.
 */

/** Where this vehicle is going, if anywhere. */
class CarTripScreen(carContext: CarContext) : Screen(carContext) {

    private val app = carContext.applicationContext as SaarthiDriverApp

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                owner.lifecycleScope.launch {
                    app.repository.state.collect { invalidate() }
                }
            }
        })
    }

    override fun onGetTemplate(): Template {
        val session = app.repository.state.value?.session
            ?: return message("No active trip.")

        val started = session.tripStartedAt
            ?: return message(
                "No trip has been started. Start it on your phone when you are ready.",
            )

        val pane = Pane.Builder()
            .addRow(
                Row.Builder()
                    .setTitle("Vehicle")
                    .addText(app.repository.state.value?.vehicle?.registrationNumber ?: "-")
                    .build(),
            )
            .addRow(
                Row.Builder()
                    .setTitle("Started")
                    .addText(startedForDriver(started))
                    .build(),
            )
            .addRow(
                Row.Builder()
                    .setTitle("Driver")
                    .addText(app.account.account.value?.name ?: "-")
                    .build(),
            )
            .build()

        return PaneTemplate.Builder(pane)
            .setTitle("Trip")
            .setHeaderAction(Action.BACK)
            .build()
    }

    private fun message(text: String): Template =
        MessageTemplate.Builder(text)
            .setTitle("Trip")
            .setHeaderAction(Action.BACK)
            .build()
}

/**
 * What the engine is saying.
 *
 * Only what the adapter actually answered. A vehicle whose ECU does not publish
 * a value shows nothing for it rather than a zero — most Indian-market cars do
 * not expose fuel level or odometer over generic OBD-II, and inventing a figure
 * on a car screen is how a driver comes to trust a number nobody measured.
 */
class CarHealthScreen(carContext: CarContext) : Screen(carContext) {

    private val app = carContext.applicationContext as SaarthiDriverApp

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                owner.lifecycleScope.launch {
                    app.telemetry.snapshot.collect { invalidate() }
                }
            }
        })
    }

    override fun onGetTemplate(): Template {
        val telemetry = app.telemetry.snapshot.value

        if (!telemetry.isReadingFromObd) {
            return MessageTemplate.Builder(
                "No adapter connected. Plug the OBD adapter in and connect it on your phone.",
            )
                .setTitle("Vehicle health")
                .setHeaderAction(Action.BACK)
                .build()
        }

        val pane = Pane.Builder()
        var shown = 0

        // Only measured values. `isMeasured` is false for anything simulated,
        // and the driver build cannot simulate at all — this is belt and braces
        // on the rule that a fabricated reading never reaches a person.
        for ((metric, label, unit) in READOUTS) {
            val value = telemetry.value(metric) ?: continue
            if (!telemetry.isMeasured(metric)) continue
            pane.addRow(
                Row.Builder()
                    .setTitle(label)
                    .addText("%.0f %s".format(value, unit))
                    .build(),
            )
            shown += 1
        }

        if (shown == 0) {
            return MessageTemplate.Builder(
                "The adapter is connected but this vehicle is not reporting anything yet.",
            )
                .setTitle("Vehicle health")
                .setHeaderAction(Action.BACK)
                .build()
        }

        return PaneTemplate.Builder(pane.build())
            .setTitle("Vehicle health")
            .setHeaderAction(Action.BACK)
            .build()
    }

    private companion object {
        /** The readings worth a glance, in the order a driver would want them. */
        val READOUTS = listOf(
            Triple(Metric.SPEED, "Speed", "km/h"),
            Triple(Metric.RPM, "Engine", "rpm"),
            Triple(Metric.COOLANT_TEMPERATURE, "Coolant", "°C"),
            Triple(Metric.ENGINE_LOAD, "Engine load", "%"),
            Triple(Metric.FUEL_LEVEL, "Fuel", "%"),
        )
    }
}

/** Fuel, workshops and the rest, from the same service the phone uses. */
class CarNearbyScreen(carContext: CarContext) : Screen(carContext) {

    override fun onGetTemplate(): Template {
        val items = ItemList.Builder()

        /*
         * A category, then the places in it on a map.
         *
         * This screen used to end here: it listed the categories and, whichever
         * one a driver chose, told them to pick up their phone. That was a poor
         * use of the platform. The host renders the map itself for a
         * PlaceListMapTemplate, the nearby service already returns coordinates,
         * and a driver at the wheel is precisely the person who cannot pick up
         * a phone. CarPlacesScreen does the round trip instead.
         */
        for (category in CATEGORIES) {
            items.addItem(
                Row.Builder()
                    .setTitle(category.label)
                    .addText(category.hint)
                    .setBrowsable(true)
                    .setOnClickListener {
                        screenManager.push(CarPlacesScreen(carContext, category))
                    }
                    .build(),
            )
        }

        return ListTemplate.Builder()
            .setTitle("Nearby")
            .setSingleList(items.build())
            .setHeaderAction(Action.BACK)
            .build()
    }
}

/** One kind of place, as a driver picks it and as the server names it. */
internal data class ServiceCategory(val key: String, val label: String, val hint: String)

/*
 * The keys are the server's, not the labels.
 *
 * The old screen listed "Workshops" and "Tyres" as free text because nothing
 * ever left the phone. These strings are sent now, so they have to be the codes
 * the nearby service actually understands — the same set the cockpit's service
 * sheet uses.
 */
internal val CATEGORIES = listOf(
    ServiceCategory("FUEL", "Fuel", "Filling stations near you"),
    ServiceCategory("MECHANIC", "Workshops", "Repairs and service centres"),
    ServiceCategory("TYRE", "Tyres", "Tyre service"),
    ServiceCategory("PARKING", "Parking", "Truck parking and rest"),
    ServiceCategory("FOOD", "Food and rest", "Dhabas and rest stops"),
    ServiceCategory("HOSPITAL", "Hospital", "Emergency services"),
)

/**
 * The places in one category, on the car's own map.
 *
 * The host draws the map and the pins; this supplies the coordinates and the
 * rows. That division is the whole reason a templated app may show a map at
 * all — Saarthi never paints a pixel of it, so what appears cannot be a
 * surface the platform has not vetted for someone who is driving.
 *
 * Choosing a row hands the destination to whichever navigation app the head
 * unit runs rather than starting a route inside Saarthi. The driver already
 * has a navigator on that screen and expects it, and Saarthi's own guidance
 * lives on the phone where the route preview and the deliberate "start" step
 * already exist — see TerminalViewModel.previewRoute for why a tap there is
 * treated as "how far is that?" rather than "take me there".
 */
internal class CarPlacesScreen(
    carContext: CarContext,
    private val category: ServiceCategory,
) : Screen(carContext) {

    private val app = carContext.applicationContext as SaarthiDriverApp

    private var places: List<NearbyPlaceDto>? = null
    private var failure: String? = null

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onCreate(owner: LifecycleOwner) {
                owner.lifecycleScope.launch {
                    search()
                    invalidate()
                }
            }
        })
    }

    override fun onGetTemplate(): Template {
        val found = places
        val error = failure

        if (error != null) {
            return MessageTemplate.Builder(error)
                .setTitle(category.label)
                .setHeaderAction(Action.BACK)
                .build()
        }

        if (found == null) {
            return PlaceListMapTemplate.Builder()
                .setTitle(category.label)
                .setHeaderAction(Action.BACK)
                .setLoading(true)
                .build()
        }

        if (found.isEmpty()) {
            return MessageTemplate.Builder("Nothing found near you.")
                .setTitle(category.label)
                .setHeaderAction(Action.BACK)
                .build()
        }

        val items = ItemList.Builder()
        // The host refuses more than six rows, and a driver reading a list at
        // the wheel would not want more. They arrive nearest first.
        for (place in found.take(MAX_ROWS)) {
            items.addItem(
                Row.Builder()
                    .setTitle(place.name)
                    .addText(distanceLine(place))
                    .setMetadata(
                        Metadata.Builder()
                            .setPlace(
                                Place.Builder(
                                    CarLocation.create(place.latitude, place.longitude),
                                )
                                    .setMarker(PlaceMarker.Builder().build())
                                    .build(),
                            )
                            .build(),
                    )
                    .setOnClickListener {
                        screenManager.push(CarRouteScreen(carContext, place))
                    }
                    .build(),
            )
        }

        return PlaceListMapTemplate.Builder()
            .setTitle(category.label)
            .setHeaderAction(Action.BACK)
            .setItemList(items.build())
            .setCurrentLocationEnabled(true)
            .build()
    }

    /**
     * Run the search, from the best position available.
     *
     * Telemetry first, because while the vehicle is reporting that is the
     * vehicle's own fix. Only when there is none does this fall back to what
     * Android last knew, and only if that is recent: a place list built around
     * where the lorry was yesterday is not a lesser answer, it is a wrong one,
     * and the honest refusal is better.
     */
    private suspend fun search() {
        val result = app.repository.nearby(category.key)
        if (result.isSuccess) {
            places = result.getOrNull()?.places
            failure = null
            return
        }

        val fallback = recentDeviceFix()
        if (fallback == null) {
            failure = result.exceptionOrNull()?.message
                ?: "Saarthi could not search nearby just now."
            return
        }

        app.repository.nearby(category.key, fallback.latitude, fallback.longitude)
            .onSuccess {
                places = it.places
                failure = null
            }
            .onFailure {
                failure = it.message ?: "Saarthi could not search nearby just now."
            }
    }

    /**
     * Android's own last fix, if it is fresh enough to search around.
     *
     * `lastLocation` can be hours or days stale, and it carries the age with
     * it, so the age is checked rather than assumed. Null on a refusal or a
     * missing permission too — this is a fallback, and a fallback that throws
     * is worse than one that declines.
     */
    private suspend fun recentDeviceFix(): Location? = runCatching {
        if (
            ContextCompat.checkSelfPermission(
                carContext,
                Manifest.permission.ACCESS_FINE_LOCATION,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            return null
        }

        val fix = LocationServices.getFusedLocationProviderClient(carContext)
            .lastLocation
            .await()
            ?: return null

        val age = SystemClock.elapsedRealtimeNanos() - fix.elapsedRealtimeNanos
        if (age > MAX_FIX_AGE_NANOS) null else fix
    }.getOrNull()

    /**
     * How far, with a span the host can render.
     *
     * The distance may not be a plain string: `PlaceListMapTemplate` refuses a
     * non-browsable row without a `DistanceSpan` and throws from inside the
     * host callback, which takes the app down rather than dropping the row.
     * The span also lets the head unit print the figure in the driver's own
     * units, which a string never could.
     *
     * The leading space is the span's anchor — the host replaces that one
     * character with the formatted distance.
     */
    private fun distanceLine(place: NearbyPlaceDto): CharSequence {
        val road = place.distance.km
        val km = road ?: place.straightLineKm

        /*
         * Section 19 in miniature: a straight-line figure is not a road
         * distance and must not be dressed up as one. A driver who reads
         * "4 km" and then finds a river in the way was misled by the app.
         */
        val tail = listOfNotNull(
            if (road == null) "as the crow flies" else null,
            place.address,
        ).joinToString(" · ")

        val text = SpannableString(if (tail.isEmpty()) " " else "  $tail")
        text.setSpan(
            DistanceSpan.create(Distance.create(km, Distance.UNIT_KILOMETERS)),
            0,
            1,
            Spanned.SPAN_INCLUSIVE_EXCLUSIVE,
        )
        return text
    }

    private companion object {
        const val MAX_ROWS = 6

        /** Ten minutes. Older than that and the lorry has probably moved. */
        const val MAX_FIX_AGE_NANOS = 10L * 60L * 1_000_000_000L
    }
}

/**
 * The route to one place, before the driver commits to it.
 *
 * Choosing a row in a list is a driver asking "how far is that?", not "take me
 * there" — the phone's own nearby list has treated it that way since the
 * beginning, and the reasoning is in `TerminalViewModel.previewRoute`: a
 * mis-tap on a screen in a moving cab must not silently start a journey.
 *
 * What this adds over handing the coordinate straight to the car's navigator
 * is the figure that actually matters to a lorry. Saarthi routes on the
 * `driving-hgv` profile — weight limits, height limits, roads a truck may
 * legally use — and a general navigation app routes a car. The distance and
 * the arrival time here are therefore Saarthi's own answer, and can differ
 * materially from what the head unit's navigator would say.
 */
internal class CarRouteScreen(
    carContext: CarContext,
    private val place: NearbyPlaceDto,
) : Screen(carContext) {

    private val app = carContext.applicationContext as SaarthiDriverApp

    private var route: RouteDto? = null
    private var failure: String? = null

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onCreate(owner: LifecycleOwner) {
                owner.lifecycleScope.launch {
                    app.repository
                        .route(place.latitude, place.longitude, place.name)
                        .onSuccess {
                            route = it
                            failure = null
                        }
                        .onFailure {
                            failure = it.message
                                ?: "Saarthi could not work out a route just now."
                        }
                    invalidate()
                }
            }
        })
    }

    override fun onGetTemplate(): Template {
        val error = failure
        if (error != null) {
            return MessageTemplate.Builder(error)
                .setTitle(place.name)
                .setHeaderAction(Action.BACK)
                .build()
        }

        val found = route
            ?: return PaneTemplate.Builder(Pane.Builder().setLoading(true).build())
                .setTitle(place.name)
                .setHeaderAction(Action.BACK)
                .build()

        val pane = Pane.Builder()
            .addRow(
                Row.Builder()
                    .setTitle("Distance")
                    .addText("%.1f km".format(found.distanceKm))
                    .build(),
            )
            .addRow(
                Row.Builder()
                    .setTitle("Driving time")
                    .addText(DrivingHours.format(found.durationMinutes * 60_000L))
                    .build(),
            )
            .addRow(
                Row.Builder()
                    .setTitle("Arriving")
                    // Server-computed, so a drifted phone clock cannot skew it.
                    .addText(clockOf(found.etaAt))
                    .build(),
            )

        if (place.address != null) {
            pane.addRow(
                Row.Builder()
                    .setTitle("Address")
                    .addText(place.address!!)
                    .build(),
            )
        }

        pane.addAction(navigateAction(found))

        return PaneTemplate.Builder(pane.build())
            .setTitle(place.name)
            .setHeaderAction(Action.BACK)
            .build()
    }

    /**
     * Show the route, and let the driver start it.
     *
     * Saarthi guides this itself rather than handing the coordinate to another
     * app. Two reasons, and the second is the real one: the route was planned
     * on the driving-hgv profile, so passing only the destination onward
     * would silently swap a lorry-legal route for a car one — and the driver
     * would never know the road they were sent down was not the road Saarthi
     * chose. Keeping guidance here also keeps the engine readings on the same
     * screen, which is what the cockpit does on the phone.
     *
     * Only offered once there is a route. Without one there is nothing to
     * preview, and the message above already says why.
     */
    private fun navigateAction(route: RouteDto): Action = Action.Builder()
        .setTitle("Navigate")
        .setOnClickListener {
            screenManager.push(CarRoutePreviewScreen(carContext, place, route))
        }
        .build()

    /** The arrival time on the driver's own clock. */
    private fun clockOf(iso: String): String = runCatching {
        DateTimeFormatter.ofPattern("HH:mm")
            .withZone(ZoneId.systemDefault())
            .format(Instant.parse(iso))
    }.getOrDefault(iso)
}

/**
 * Raising an emergency, with one deliberate step in the way.
 *
 * Not a single tap. An SOS despatches people and interrupts a fleet; a control
 * that could be caught by a sleeve on a rough road would be raised by accident
 * often enough that the real ones stopped being believed. The confirmation is
 * the same shape as the phone's, for the same reason.
 */
class CarSosScreen(carContext: CarContext) : Screen(carContext) {

    private val app = carContext.applicationContext as SaarthiDriverApp

    override fun onGetTemplate(): Template =
        MessageTemplate.Builder(
            "Raise an emergency for ${app.repository.state.value?.vehicle?.registrationNumber ?: "this vehicle"}? " +
                "Your fleet and nearby Saarthi vehicles will be alerted with your position.",
        )
            .setTitle("Emergency")
            .setHeaderAction(Action.BACK)
            .addAction(
                Action.Builder()
                    .setTitle("Raise SOS")
                    .setBackgroundColor(CarColor.RED)
                    .setOnClickListener {
                        /*
                         * The same call the phone makes, with a fresh event id.
                         *
                         * The id is what makes an SOS idempotent on the server:
                         * a retry over a bad connection must reach one
                         * emergency, not three. Generated per raise rather than
                         * reused, so two genuine emergencies on one shift stay
                         * two.
                         */
                        app.scope.launch {
                            app.repository.raiseSos(
                                type = "OTHER",
                                description = "Raised from the car screen.",
                                eventId = java.util.UUID.randomUUID().toString(),
                            )
                        }
                        screenManager.push(
                            CarPhoneHandoffScreen(
                                carContext,
                                "Emergency raised. Your fleet has been alerted. Keep your phone " +
                                    "to hand - they may call.",
                            ),
                        )
                    }
                    .build(),
            )
            .addAction(
                Action.Builder()
                    .setTitle("Cancel")
                    .setOnClickListener { screenManager.pop() }
                    .build(),
            )
            .build()
}

/** Anything the car screen should not do, said plainly. */
class CarPhoneHandoffScreen(
    carContext: CarContext,
    private val text: String,
) : Screen(carContext) {

    override fun onGetTemplate(): Template =
        MessageTemplate.Builder(text)
            .setTitle("Saarthi")
            .setHeaderAction(Action.BACK)
            .build()
}

/**
 * When the trip began, as a driver reads it.
 *
 * The server sends an ISO instant, and this row was printing it verbatim:
 * "2026-09-10T07:23:17.405Z" on a car screen, in UTC, to the millisecond. A
 * driver glancing at a head unit wants the time on their own clock and a sense
 * of how long they have been going — the raw form gives neither, and in India
 * it is five and a half hours out on top.
 *
 * Falls back to the untouched string if the instant will not parse, on the same
 * reasoning as `relativeTime` in the notices screen: an unreadable timestamp is
 * poor, but an invented one is worse.
 */
private fun startedForDriver(iso: String): String {
    val instant = runCatching { Instant.parse(iso) }.getOrNull() ?: return iso

    val clock = runCatching {
        DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault()).format(instant)
    }.getOrNull() ?: return iso

    val elapsed = System.currentTimeMillis() - instant.toEpochMilli()
    // A clock running ahead of the phone would otherwise read as a negative
    // journey. Show the time alone rather than something absurd.
    return if (elapsed < 0) clock else "$clock · ${DrivingHours.format(elapsed)} ago"
}
