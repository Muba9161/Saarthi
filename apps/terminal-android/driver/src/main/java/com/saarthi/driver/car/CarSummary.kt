package com.saarthi.driver.car

import com.saarthi.core.domain.TerminalState

/**
 * What the car screen should say, decided without a car.
 *
 * Pulled out of the screens so it can be tested. A `Screen` needs a
 * `CarContext`, which needs a host, which needs Android Auto — so a test of the
 * screen class itself would either need instrumentation the project has no
 * harness for, or a mock that asserts a mocked template exists and proves
 * nothing at all.
 *
 * What is actually worth testing is the decision: whether a driver is told to
 * pick up their phone, whether a trip reads as running, and — the one with real
 * consequences — whether an absent measurement can ever be shown as a number.
 * All three are pure functions of state, and all three are here.
 */
object CarSummary {

    /** What the car screen can show at all. */
    sealed interface Availability {
        /** Nobody signed in. The phone is where that is fixed. */
        data object SignedOut : Availability

        /** Signed in, no vehicle. Also a phone job — scanning needs a camera. */
        data object NoVehicle : Availability

        /** There is a vehicle, and the screen can be drawn. */
        data class Ready(val registrationNumber: String) : Availability
    }

    /**
     * Whether there is anything to show.
     *
     * Both unavailable cases send the driver to the phone rather than offering a
     * way out here: signing in needs a keyboard and scanning needs a camera, and
     * Android Auto refuses both while moving — correctly.
     */
    fun availability(
        signedIn: Boolean,
        registrationNumber: String?,
    ): Availability = when {
        !signedIn -> Availability.SignedOut
        registrationNumber.isNullOrBlank() -> Availability.NoVehicle
        else -> Availability.Ready(registrationNumber)
    }

    /** The one line under the vehicle: what is happening, and to whom. */
    fun statusLine(state: TerminalState, driverName: String): String = when (state) {
        TerminalState.TRIP_ACTIVE -> "On a trip · $driverName"
        TerminalState.READY -> "Ready to start · $driverName"
        TerminalState.PENDING_APPROVAL,
        TerminalState.SELFIE_SUBMITTED,
        -> "Waiting for fleet approval"

        TerminalState.APPROVED,
        TerminalState.CHECKLIST_REQUIRED,
        -> "Safety check due — complete it on your phone"

        TerminalState.DRIVER_IDENTIFIED -> "Arrival photo needed — take it on your phone"
        TerminalState.REJECTED -> "Not approved"
        else -> driverName
    }

    /** Whether a trip is running, about to, or neither. */
    fun tripLine(state: TerminalState, tripStartedAt: String?): String = when {
        tripStartedAt != null -> "In progress"
        state == TerminalState.READY -> "Not started"
        else -> "No active trip"
    }

    /**
     * The engine, in one line.
     *
     * "Adapter not connected" rather than zeroes. Absent is not a reading of
     * nought, and a car screen showing 0 km/h beside a moving truck is the kind
     * of wrong that gets believed — which is precisely what section 19 exists to
     * prevent, and why this returns text rather than a number.
     */
    fun healthLine(readingFromObd: Boolean, speedKph: Double?): String = when {
        !readingFromObd -> "Adapter not connected"
        speedKph != null -> "%.0f km/h".format(speedKph)
        else -> "Connected"
    }
}
