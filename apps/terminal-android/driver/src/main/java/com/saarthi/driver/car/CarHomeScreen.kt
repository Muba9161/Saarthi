package com.saarthi.driver.car

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import com.saarthi.core.domain.TerminalState
import com.saarthi.driver.SaarthiDriverApp
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/**
 * What Saarthi shows when the car screen is opened.
 *
 * Deliberately a short list. A driver reads this at a glance while moving, so it
 * answers three questions and stops: which vehicle, what is happening, and what
 * can be reached from here.
 *
 * When there is nothing to show — nobody signed in, or no vehicle yet — it says
 * so and sends the driver to their phone rather than offering a way to fix it
 * here. Signing in and scanning need a keyboard and a camera, and Android Auto
 * is right to refuse both.
 */
class CarHomeScreen(carContext: CarContext) : Screen(carContext) {

    private val app = carContext.applicationContext as SaarthiDriverApp

    init {
        /*
         * Redraw when the app's state changes, rather than on a timer.
         *
         * The car screen is a window onto state the phone already maintains. A
         * poll here would show a driver stale information between ticks — and
         * on the one screen where "the trip has started" needs to be true the
         * moment it is true.
         */
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                owner.lifecycleScope.launch {
                    combine(
                        app.repository.state,
                        app.telemetry.snapshot,
                        app.account.account,
                    ) { _, _, _ -> Unit }.collect { invalidate() }
                }
            }
        })
    }

    override fun onGetTemplate(): Template {
        val account = app.account.account.value
        val server = app.repository.state.value

        val vehicle = when (
            val availability = CarSummary.availability(
                signedIn = account != null,
                registrationNumber = server?.vehicle?.registrationNumber,
            )
        ) {
            CarSummary.Availability.SignedOut ->
                return signedOut("Sign in to Saarthi on your phone to get started.")

            CarSummary.Availability.NoVehicle ->
                return signedOut(
                    "Choose your vehicle on your phone — scan its code or enter its " +
                        "number. Saarthi will follow here once your fleet has approved you.",
                )

            is CarSummary.Availability.Ready -> availability.registrationNumber
        }

        val state = TerminalState.parse(server?.state)

        val items = ItemList.Builder()
            .addItem(
                Row.Builder()
                    .setTitle(vehicle)
                    .addText(describe(state, account?.name.orEmpty()))
                    .setBrowsable(false)
                    .build(),
            )
            .addItem(
                Row.Builder()
                    .setTitle("Trip")
                    .addText(tripSummary())
                    .setBrowsable(true)
                    .setOnClickListener { screenManager.push(CarTripScreen(carContext)) }
                    .build(),
            )
            .addItem(
                Row.Builder()
                    .setTitle("Vehicle health")
                    .addText(healthSummary())
                    .setBrowsable(true)
                    .setOnClickListener { screenManager.push(CarHealthScreen(carContext)) }
                    .build(),
            )
            .addItem(
                Row.Builder()
                    .setTitle("Nearby")
                    .addText("Fuel, workshops, tyres, parking")
                    .setBrowsable(true)
                    .setOnClickListener { screenManager.push(CarNearbyScreen(carContext)) }
                    .build(),
            )
            .build()

        return ListTemplate.Builder()
            .setTitle("Saarthi")
            .setSingleList(items)
            .setHeaderAction(Action.APP_ICON)
            /*
             * Emergency, on every screen, one press away.
             *
             * In the action strip rather than the list: a list scrolls, and a
             * driver reaching for this is not in a position to scroll. It opens
             * a confirmation rather than raising immediately — see
             * `CarSosScreen` for why a single tap is the wrong shape for this.
             */
            .setActionStrip(
                androidx.car.app.model.ActionStrip.Builder()
                    .addAction(
                        Action.Builder()
                            .setTitle("SOS")
                            .setBackgroundColor(CarColor.RED)
                            .setOnClickListener { screenManager.push(CarSosScreen(carContext)) }
                            .build(),
                    )
                    .build(),
            )
            .build()
    }

    /** Nothing to show, and the fix is on the phone. */
    private fun signedOut(message: String): Template =
        MessageTemplate.Builder(message)
            .setTitle("Saarthi")
            .setHeaderAction(Action.APP_ICON)
            .setIcon(CarIcon.APP_ICON)
            .build()

    // The wording lives in `CarSummary`, which is testable without a car. See
    // `CarSummaryTest` for the rules these three follow.
    private fun describe(state: TerminalState, driver: String): String =
        CarSummary.statusLine(state, driver)

    private fun tripSummary(): String {
        val server = app.repository.state.value
        return CarSummary.tripLine(
            TerminalState.parse(server?.state),
            server?.session?.tripStartedAt,
        )
    }

    private fun healthSummary(): String {
        val telemetry = app.telemetry.snapshot.value
        return CarSummary.healthLine(
            readingFromObd = telemetry.isReadingFromObd,
            speedKph = telemetry.value(com.saarthi.core.telemetry.Metric.SPEED),
        )
    }
}
