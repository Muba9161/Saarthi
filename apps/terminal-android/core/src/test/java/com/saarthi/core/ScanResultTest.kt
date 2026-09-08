package com.saarthi.core

import com.saarthi.core.ui.screens.ScanResult
import com.saarthi.core.ui.screens.terminalPairingCode
import com.saarthi.core.ui.screens.vehicleIdentityCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Reading a square.
 *
 * Saarthi has more than one kind of QR and, to somebody standing at a truck,
 * they all look identical. The two apps look for different ones — a fitted
 * tablet wants a pairing payload carried to it by a fitter, a driver's phone
 * wants the sticker on the vehicle — and accepting the wrong one is worse than
 * refusing it: a token sent to the wrong endpoint fails with a message about
 * something the driver was not doing.
 *
 * The case that matters most operationally is the domain change. Stickers are
 * printed once and glued to a truck for years, and Saarthi has just moved from
 * `saarthi.in` to `vorldxsaarthi.com`. Every vehicle already carrying a code
 * must keep working.
 */
class ScanResultTest {

    private fun tokenOf(result: ScanResult): String? =
        (result as? ScanResult.Accepted)?.token

    private fun reasonOf(result: ScanResult): String? =
        (result as? ScanResult.Refused)?.reason

    // -----------------------------------------------------------------------
    // The vehicle sticker
    // -----------------------------------------------------------------------

    @Test
    fun `reads the token out of a vehicle code`() {
        val result = vehicleIdentityCode("https://app.vorldxsaarthi.com/q/AB12CD34EF")

        assertEquals("AB12CD34EF", tokenOf(result))
    }

    @Test
    fun `still reads a sticker printed before the domain changed`() {
        /*
         * The reason the matcher is anchored on `/q/` and not on a host.
         *
         * A fleet that moved domain must not have to visit every vehicle with a
         * label printer. Both of these are the same truck.
         */
        assertEquals("AB12CD34EF", tokenOf(vehicleIdentityCode("https://fleet.saarthi.in/q/AB12CD34EF")))
        assertEquals("AB12CD34EF", tokenOf(vehicleIdentityCode("https://app.vorldxsaarthi.com/q/AB12CD34EF")))
    }

    @Test
    fun `ignores what a scanner app appends`() {
        // Printed codes carry tracking parameters, and some camera apps add
        // their own. Neither is part of the token.
        assertEquals(
            "AB12CD34EF",
            tokenOf(vehicleIdentityCode("https://app.vorldxsaarthi.com/q/AB12CD34EF?utm=print")),
        )
    }

    @Test
    fun `tolerates the whitespace a camera hands over`() {
        assertEquals(
            "AB12CD34EF",
            tokenOf(vehicleIdentityCode("  https://app.vorldxsaarthi.com/q/AB12CD34EF \n")),
        )
    }

    @Test
    fun `tells a driver when they have scanned a pairing code instead`() {
        /*
         * The likeliest wrong scan by far: a driver pointed at the dashboard's
         * pairing QR rather than the vehicle's sticker. "Invalid code" would
         * leave them scanning the same square again; naming what they found
         * sends them to the right one.
         */
        val payload = """{"v":1,"kind":"saarthi.terminal.pair","token":"abc","api":"x"}"""
        val reason = reasonOf(vehicleIdentityCode(payload))

        assertTrue(reason != null)
        assertTrue(reason!!.contains("vehicle"))
    }

    @Test
    fun `refuses a code that belongs to something else entirely`() {
        assertTrue(vehicleIdentityCode("https://example.com/hello") is ScanResult.Refused)
        assertTrue(vehicleIdentityCode("") is ScanResult.Refused)
        // A `/q/` path with nothing usable after it is not a token.
        assertTrue(vehicleIdentityCode("https://app.vorldxsaarthi.com/q/x") is ScanResult.Refused)
    }

    // -----------------------------------------------------------------------
    // The pairing payload
    // -----------------------------------------------------------------------

    @Test
    fun `reads a terminal pairing payload`() {
        val payload = """{"v":1,"kind":"saarthi.terminal.pair","token":"pair-token","api":"x"}"""

        assertEquals("pair-token", tokenOf(terminalPairingCode(payload)))
    }

    @Test
    fun `refuses a device pairing payload and says where to look`() {
        // Two different products, two different QRs on the same dashboard page.
        val payload = """{"v":1,"kind":"saarthi.device.pair","token":"t","api":"x"}"""
        val reason = reasonOf(terminalPairingCode(payload))

        assertTrue(reason != null)
        assertTrue(reason!!.contains("Device"))
    }

    @Test
    fun `refuses a vehicle sticker when a pairing code was wanted`() {
        // The mirror of the driver's mistake, made by whoever is fitting a
        // tablet. It must not be read as a pairing token.
        val result = terminalPairingCode("https://app.vorldxsaarthi.com/q/AB12CD34EF")

        assertTrue(result is ScanResult.Refused)
    }

    @Test
    fun `the two readers never accept each other's codes`() {
        /*
         * Stated as its own property because it is the whole point of having
         * two readers. Each app is looking for exactly one kind of square, and
         * a change that made either tolerant would let a token reach an endpoint
         * that cannot use it.
         */
        val sticker = "https://app.vorldxsaarthi.com/q/AB12CD34EF"
        val pairing = """{"v":1,"kind":"saarthi.terminal.pair","token":"t","api":"x"}"""

        assertTrue(vehicleIdentityCode(sticker) is ScanResult.Accepted)
        assertTrue(terminalPairingCode(sticker) is ScanResult.Refused)

        assertTrue(terminalPairingCode(pairing) is ScanResult.Accepted)
        assertTrue(vehicleIdentityCode(pairing) is ScanResult.Refused)
    }
}
