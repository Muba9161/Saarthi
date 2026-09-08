package com.saarthi.driver.car

import com.saarthi.core.domain.TerminalState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the car screen decides to say.
 *
 * These are the parts of Android Auto that can be tested without Android Auto.
 * A `Screen` needs a `CarContext` and therefore a host, so a test of the screen
 * class would be a test of a mock — and the specification is explicit that a
 * test asserting a mocked success while the feature is unproven is worse than
 * no test. What is left, and what genuinely matters, is the decision each screen
 * makes about state.
 *
 * The case worth the most is the last one: a car screen must never show a
 * fabricated zero for a measurement the vehicle did not give.
 */
class CarSummaryTest {

    // -----------------------------------------------------------------------
    // Whether there is anything to show
    // -----------------------------------------------------------------------

    @Test
    fun `sends an unauthenticated driver to the phone`() {
        // Signing in needs a keyboard, which Android Auto will not offer while
        // moving. Saying so is the only correct answer here.
        assertEquals(
            CarSummary.Availability.SignedOut,
            CarSummary.availability(signedIn = false, registrationNumber = "DL01AB1234"),
        )
    }

    @Test
    fun `sends a driver with no vehicle to the phone`() {
        // Scanning needs a camera and typing a registration needs a keyboard.
        // Both are phone jobs, and the car screen says so rather than pretending.
        assertEquals(
            CarSummary.Availability.NoVehicle,
            CarSummary.availability(signedIn = true, registrationNumber = null),
        )
        assertEquals(
            CarSummary.Availability.NoVehicle,
            CarSummary.availability(signedIn = true, registrationNumber = "   "),
        )
    }

    @Test
    fun `shows the vehicle once there is one`() {
        assertEquals(
            CarSummary.Availability.Ready("DL01AB1234"),
            CarSummary.availability(signedIn = true, registrationNumber = "DL01AB1234"),
        )
    }

    // -----------------------------------------------------------------------
    // What is happening
    // -----------------------------------------------------------------------

    @Test
    fun `names the driver while working`() {
        assertEquals(
            "On a trip · Ravi Kumar",
            CarSummary.statusLine(TerminalState.TRIP_ACTIVE, "Ravi Kumar"),
        )
        assertEquals(
            "Ready to start · Ravi Kumar",
            CarSummary.statusLine(TerminalState.READY, "Ravi Kumar"),
        )
    }

    @Test
    fun `points every unfinished step back at the phone`() {
        /*
         * Each of these needs something the car screen cannot offer — a camera,
         * a form, a decision by somebody in an office. A driver stuck on one of
         * them needs to know where to go, not merely that they are stuck.
         */
        assertTrue(
            CarSummary.statusLine(TerminalState.DRIVER_IDENTIFIED, "Ravi").contains("phone"),
        )
        assertTrue(
            CarSummary.statusLine(TerminalState.CHECKLIST_REQUIRED, "Ravi").contains("phone"),
        )
        assertEquals(
            "Waiting for fleet approval",
            CarSummary.statusLine(TerminalState.PENDING_APPROVAL, "Ravi"),
        )
    }

    @Test
    fun `does not put the driver's name where a decision belongs`() {
        // Waiting for approval is about the fleet, not the driver, and a line
        // reading "Ravi Kumar" there would look like everything was fine.
        assertTrue(
            !CarSummary.statusLine(TerminalState.PENDING_APPROVAL, "Ravi Kumar").contains("Ravi"),
        )
    }

    // -----------------------------------------------------------------------
    // The trip
    // -----------------------------------------------------------------------

    @Test
    fun `distinguishes a running trip from one not yet started`() {
        assertEquals("In progress", CarSummary.tripLine(TerminalState.TRIP_ACTIVE, "2026-09-08T06:00:00Z"))
        assertEquals("Not started", CarSummary.tripLine(TerminalState.READY, null))
        assertEquals("No active trip", CarSummary.tripLine(TerminalState.PENDING_APPROVAL, null))
    }

    // -----------------------------------------------------------------------
    // The engine
    // -----------------------------------------------------------------------

    @Test
    fun `never shows a fabricated zero for a missing measurement`() {
        /*
         * The case with real consequences.
         *
         * An adapter that is not connected produces no speed. Rendering that as
         * "0 km/h" beside a moving truck is a number a driver would believe, and
         * section 19 forbids exactly this — a value that was never measured
         * presenting as one that was.
         */
        val line = CarSummary.healthLine(readingFromObd = false, speedKph = null)

        assertEquals("Adapter not connected", line)
        assertTrue(!line.contains("0"))
    }

    @Test
    fun `says connected when the adapter answers but the value has not arrived`() {
        // Connected and silent is a real state — an ECU that has not yet
        // replied to the speed PID — and it is not the same as disconnected.
        assertEquals("Connected", CarSummary.healthLine(readingFromObd = true, speedKph = null))
    }

    @Test
    fun `shows a measured speed`() {
        assertEquals("54 km/h", CarSummary.healthLine(readingFromObd = true, speedKph = 53.7))
    }

    @Test
    fun `shows a measured standstill, which is not the same as no reading`() {
        // A genuine 0 km/h from a stopped vehicle *is* a measurement and must be
        // shown. The rule is about absence, not about the digit.
        assertEquals("0 km/h", CarSummary.healthLine(readingFromObd = true, speedKph = 0.0))
    }
}
