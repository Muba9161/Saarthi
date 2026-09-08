package com.saarthi.driver.car

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.CarColor
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import com.saarthi.core.telemetry.Metric
import com.saarthi.driver.SaarthiDriverApp
import kotlinx.coroutines.launch

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
                    .addText(app.repository.state.value?.vehicle?.registrationNumber ?: "—")
                    .build(),
            )
            .addRow(
                Row.Builder()
                    .setTitle("Started")
                    .addText(started)
                    .build(),
            )
            .addRow(
                Row.Builder()
                    .setTitle("Driver")
                    .addText(app.account.account.value?.name ?: "—")
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

    private val app = carContext.applicationContext as SaarthiDriverApp

    override fun onGetTemplate(): Template {
        val items = ItemList.Builder()

        /*
         * Categories, not results.
         *
         * Fetching a live list would need a round trip the car screen has no
         * good way to show progress for, and Android Auto caps a list at a
         * handful of rows anyway. Choosing a category here and letting the
         * phone's map do the work keeps one implementation of "nearby" rather
         * than a thinner second one.
         */
        for ((label, hint) in CATEGORIES) {
            items.addItem(
                Row.Builder()
                    .setTitle(label)
                    .addText(hint)
                    .setBrowsable(false)
                    .setOnClickListener {
                        screenManager.push(
                            CarPhoneHandoffScreen(
                                carContext,
                                "Open Saarthi on your phone to see $label near you and start " +
                                    "navigating.",
                            ),
                        )
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

    private companion object {
        val CATEGORIES = listOf(
            "Fuel" to "Filling stations on your route",
            "Workshops" to "Repairs and service centres",
            "Tyres" to "Tyre service",
            "Parking" to "Truck parking and rest",
            "Hospital" to "Emergency services",
        )
    }
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
                                    "to hand — they may call.",
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
