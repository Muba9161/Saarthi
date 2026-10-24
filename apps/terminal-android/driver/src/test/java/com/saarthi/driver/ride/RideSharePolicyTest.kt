package com.saarthi.driver.ride

import com.saarthi.driver.network.RideSharesApi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * The rules behind riding along — sharing a ride with family.
 *
 * The cases that matter are the quiet ones: riding along offered to an
 * account the server did not allow, a share shown as live once the server has
 * let it go, a mistyped number refusing the whole list, the owner app offered
 * to a login that has none, a single bad fix costing a whole upload, and a
 * phone that keeps reporting for a share that has already ended.
 */
class RideSharePolicyTest {

    private val now: Instant = Instant.parse("2026-10-22T12:00:00Z")

    private fun share(status: String, sharedWithSelf: Boolean = false) = RideSharesApi.ShareView(
        id = "share-1",
        status = status,
        registrationNumber = "UP16GH7788",
        link = "https://saarthi.example/s/abc",
        reportingToken = "key-1",
        sharedWithSelf = sharedWithSelf,
    )

    // -----------------------------------------------------------------------
    // Who is asked "How are you travelling?"
    // -----------------------------------------------------------------------

    @Test
    fun `an account the server allows to ride along is asked the question`() {
        assertEquals(RideSharePolicy.Home.CHOOSE_ROLE, RideSharePolicy.homeFor(rideAlong = true))
    }

    @Test
    fun `without riding along, or without an answer, it is the vehicle screen as before`() {
        // The app never guesses from the account type: no clear yes means the driver's screen.
        assertEquals(RideSharePolicy.Home.CHOOSE_VEHICLE, RideSharePolicy.homeFor(rideAlong = false))
        assertEquals(RideSharePolicy.Home.CHOOSE_VEHICLE, RideSharePolicy.homeFor(rideAlong = null))
    }

    @Test
    fun `only a 403 says this account may not ride along`() {
        assertTrue(RideSharePolicy.notAllowed(403))
        for (status in listOf(400, 401, 404, 409, 500)) {
            assertFalse("status $status", RideSharePolicy.notAllowed(status))
        }
    }

    // -----------------------------------------------------------------------
    // Which screen
    // -----------------------------------------------------------------------

    @Test
    fun `a share on is shown as sharing`() {
        assertEquals(RideSharePolicy.Phase.SHARING, RideSharePolicy.phaseOf(share("SHARING")))
    }

    @Test
    fun `no share at all is over - the server answers nothing once time runs out`() {
        assertEquals(RideSharePolicy.Phase.OVER, RideSharePolicy.phaseOf(null))
    }

    @Test
    fun `an ended share and a status this build does not know are over`() {
        assertEquals(RideSharePolicy.Phase.OVER, RideSharePolicy.phaseOf(share("ENDED")))
        assertEquals(RideSharePolicy.Phase.OVER, RideSharePolicy.phaseOf(share("PAUSED")))
    }

    // -----------------------------------------------------------------------
    // The vehicle's number
    // -----------------------------------------------------------------------

    @Test
    fun `the vehicle number is required and sent trimmed`() {
        assertNull(RideSharePolicy.plateOf("   "))
        assertEquals("UP16GH7788", RideSharePolicy.plateOf("  UP16GH7788 "))
    }

    @Test
    fun `a vehicle number outside the server's bounds is not sent`() {
        assertNull(RideSharePolicy.plateOf("U"))
        assertNull(RideSharePolicy.plateOf("X".repeat(RideSharePolicy.PLATE_MAX + 1)))
        assertEquals("UP 16 GH 7788", RideSharePolicy.plateOf("UP 16 GH 7788"))
    }

    // -----------------------------------------------------------------------
    // Family numbers
    // -----------------------------------------------------------------------

    @Test
    fun `numbers are sent as ten digits however they were typed`() {
        assertEquals(
            listOf("9876543210", "9123456780", "8012345678"),
            RideSharePolicy.contactsOf(listOf("+91 98765 43210", "09123456780", "80123-45678")),
        )
    }

    @Test
    fun `blank fields are left out and a number named twice is sent once`() {
        assertEquals(
            listOf("9876543210"),
            RideSharePolicy.contactsOf(listOf("", "98765 43210", "  ", "+919876543210")),
        )
        assertEquals(emptyList<String>(), RideSharePolicy.contactsOf(listOf("", "")))
    }

    @Test
    fun `one wrong or half-typed number holds the whole list back`() {
        // The server refuses every number for one bad one, so none is sent.
        assertNull(RideSharePolicy.contactsOf(listOf("9876543210", "5876543210")))
        assertNull(RideSharePolicy.contactsOf(listOf("9876543210", "98765")))
    }

    @Test
    fun `family named by email address are sent in lower case beside numbers`() {
        assertEquals(
            listOf("asha@example.com", "9876543210"),
            RideSharePolicy.contactsOf(listOf(" Asha@Example.com ", "98765 43210", "asha@example.com")),
        )
        assertNull(RideSharePolicy.contactsOf(listOf("9876543210", "asha@example")))
    }

    @Test
    fun `no more numbers than the server takes`() {
        val five = (0..4).map { "98765432$it$it" }
        assertEquals(five, RideSharePolicy.contactsOf(five))
        assertNull(RideSharePolicy.contactsOf(five + "9000000000"))
    }

    // -----------------------------------------------------------------------
    // The rider's own owner app
    // -----------------------------------------------------------------------

    @Test
    fun `a login with an owner account is offered its own owner app`() {
        assertEquals(RideSharePolicy.SelfShare.OFFERED, RideSharePolicy.selfShareOf(true, share("SHARING")))
    }

    @Test
    fun `a login with no owner account is offered nothing`() {
        assertEquals(RideSharePolicy.SelfShare.HIDDEN, RideSharePolicy.selfShareOf(false, share("SHARING")))
    }

    @Test
    fun `a ride already on the owner app says so, whatever this session has heard`() {
        val showing = share("SHARING", sharedWithSelf = true)
        assertEquals(RideSharePolicy.SelfShare.SHOWING, RideSharePolicy.selfShareOf(true, showing))
        assertEquals(RideSharePolicy.SelfShare.SHOWING, RideSharePolicy.selfShareOf(false, showing))
    }

    @Test
    fun `a new share asks for the owner app only when the login holds one and the rider chose it`() {
        assertTrue(RideSharePolicy.shareWithSelf(hasOwnerAccount = true, chosen = true))
        assertFalse(RideSharePolicy.shareWithSelf(hasOwnerAccount = true, chosen = false))
        assertFalse(RideSharePolicy.shareWithSelf(hasOwnerAccount = false, chosen = true))
    }

    @Test
    fun `a refused owner app is no account, an ended share, or the server's own words`() {
        assertEquals(RideSharePolicy.SelfRefusal.NO_OWNER_ACCOUNT, RideSharePolicy.afterSelfRefusal(422))
        assertEquals(RideSharePolicy.SelfRefusal.SHARE_ENDED, RideSharePolicy.afterSelfRefusal(409))
        for (status in listOf(400, 403, 404, 429, 500)) {
            assertEquals("status $status", RideSharePolicy.SelfRefusal.OTHER, RideSharePolicy.afterSelfRefusal(status))
        }
    }

    // -----------------------------------------------------------------------
    // Which fixes are sent
    // -----------------------------------------------------------------------

    @Test
    fun `a fix becomes a point the server accepts`() {
        val point = RideSharePolicy.pointOf(26.85, 80.95, speedMps = 10f, bearingDegrees = 90f, accuracyMetres = 8f, atMillis = now.toEpochMilli())

        assertNotNull(point)
        point!!
        assertEquals(36.0, point.speedKph!!, 0.001)
        assertEquals(90.0, point.heading!!, 0.001)
        assertEquals(8.0, point.accuracy!!, 0.001)
        assertEquals("2026-10-22T12:00:00Z", point.recordedAt)
    }

    @Test
    fun `readings outside the server's limits are pulled inside them`() {
        /*
         * The server refuses a whole upload for one value out of range, so a
         * GPS glitch at 240 km/h must not cost the good fixes either side of it.
         */
        val glitch = RideSharePolicy.pointOf(26.85, 80.95, speedMps = 67f, bearingDegrees = 361f, accuracyMetres = 9_000f, atMillis = 0L)!!

        assertEquals(200.0, glitch.speedKph!!, 0.001)
        assertEquals(360.0, glitch.heading!!, 0.001)
        assertEquals(5_000.0, glitch.accuracy!!, 0.001)
    }

    @Test
    fun `what the phone did not measure is left out, never sent as zero`() {
        val bare = RideSharePolicy.pointOf(26.85, 80.95, speedMps = null, bearingDegrees = Float.NaN, accuracyMetres = null, atMillis = 0L)!!

        assertNull(bare.speedKph)
        assertNull(bare.heading)
        assertNull(bare.accuracy)
    }

    @Test
    fun `a fix that is not a place is dropped`() {
        assertNull(RideSharePolicy.pointOf(Double.NaN, 80.95, null, null, null, 0L))
        assertNull(RideSharePolicy.pointOf(91.0, 80.95, null, null, null, 0L))
        assertNull(RideSharePolicy.pointOf(26.85, -181.0, null, null, null, 0L))
    }

    // -----------------------------------------------------------------------
    // When the server says no
    // -----------------------------------------------------------------------

    @Test
    fun `a share that has ended stops the reporting`() {
        // 409 is the server's "this share is over". Asking again would only drain the battery.
        assertEquals(RideSharePolicy.Refusal.STOP, RideSharePolicy.afterRefusal(409))
    }

    @Test
    fun `a wrong key or a missing share stops too`() {
        for (status in listOf(401, 403, 404)) {
            assertEquals("status $status", RideSharePolicy.Refusal.STOP, RideSharePolicy.afterRefusal(status))
        }
    }

    @Test
    fun `no signal, a busy server or the rate limit keep the fixes for later`() {
        for (status in listOf(null, 408, 429, 500, 503)) {
            assertEquals("status $status", RideSharePolicy.Refusal.RETRY, RideSharePolicy.afterRefusal(status))
        }
    }

    @Test
    fun `fixes the server rejected outright are not sent again`() {
        assertEquals(RideSharePolicy.Refusal.DISCARD, RideSharePolicy.afterRefusal(400))
        assertEquals(RideSharePolicy.Refusal.DISCARD, RideSharePolicy.afterRefusal(422))
    }
}
