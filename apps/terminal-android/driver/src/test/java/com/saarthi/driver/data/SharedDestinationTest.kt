package com.saarthi.driver.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The shapes a shared location actually arrives in.
 *
 * Every case here was taken from a real share rather than invented: Google
 * Maps' own links, Android's `geo:` scheme, and the text WhatsApp forwards.
 * They are worth pinning down because the failure mode is not a blank screen —
 * it is a lorry routed somewhere nobody chose.
 */
class SharedDestinationTest {

    private fun at(latitude: Double, longitude: Double, parsed: SharedDestination?) {
        requireNotNull(parsed) { "expected a destination" }
        assertEquals(latitude, parsed.latitude, 0.0001)
        assertEquals(longitude, parsed.longitude, 0.0001)
    }

    @Test
    fun `reads a bare geo uri`() {
        at(28.6139, 77.2090, SharedDestination.parse("geo:28.6139,77.2090"))
    }

    @Test
    fun `reads the geo uri android actually sends`() {
        // The coordinates live in the query and the path is parked at zero.
        // Reading the path alone puts the driver in the Atlantic.
        val parsed = SharedDestination.parse("geo:0,0?q=28.6139,77.2090(Warehouse 4)")
        at(28.6139, 77.2090, parsed)
        assertEquals("Warehouse 4", parsed?.label)
    }

    @Test
    fun `reads a maps link with a place anchor`() {
        at(
            19.0760,
            72.8777,
            SharedDestination.parse("https://www.google.com/maps/@19.0760,72.8777,17z"),
        )
    }

    @Test
    fun `prefers the place over the camera in a full maps url`() {
        // `@` is where the camera sits; `!3d!4d` is the place itself. A link
        // contains both and they are not the same point.
        val url = "https://www.google.com/maps/place/Depot/@19.0000,72.0000,17z/" +
            "data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d19.0760!4d72.8777"
        at(19.0760, 72.8777, SharedDestination.parse(url))
    }

    @Test
    fun `reads a q parameter link`() {
        at(12.9716, 77.5946, SharedDestination.parse("https://maps.google.com/?q=12.9716,77.5946"))
    }

    @Test
    fun `reads a destination parameter link`() {
        at(
            22.5726,
            88.3639,
            SharedDestination.parse(
                "https://www.google.com/maps/dir/?api=1&destination=22.5726,88.3639",
            ),
        )
    }

    @Test
    fun `reads a coordinate pair out of a forwarded message`() {
        val message = "Bhai yahan aa jao 26.8467, 80.9462 gate ke paas"
        at(26.8467, 80.9462, SharedDestination.parse(message))
    }

    @Test
    fun `decodes an escaped query`() {
        at(
            17.3850,
            78.4867,
            SharedDestination.parse("https://maps.google.com/?q=17.3850%2C78.4867"),
        )
    }

    @Test
    fun `refuses a null island coordinate`() {
        // What a broken parser produces, never what a person shares.
        assertNull(SharedDestination.parse("geo:0,0"))
        assertNull(SharedDestination.parse("https://maps.google.com/?q=0.0000,0.0000"))
    }

    @Test
    fun `refuses numbers that are not coordinates`() {
        assertNull(SharedDestination.parse("Invoice 4471 for 2000.500 rupees"))
        assertNull(SharedDestination.parse("call me on 9876500022"))
        assertNull(SharedDestination.parse(""))
        assertNull(SharedDestination.parse(null))
    }

    @Test
    fun `refuses an out of range pair`() {
        assertNull(SharedDestination.parse("geo:191.5000,777.2000"))
    }

    @Test
    fun `recognises a short link as needing resolution`() {
        assertTrue(SharedDestination.isShortLink("https://maps.app.goo.gl/aBcDeF12345"))
        assertTrue(SharedDestination.isShortLink("Here you go https://maps.app.goo.gl/xY7 thanks"))
        assertFalse(SharedDestination.isShortLink("https://www.google.com/maps/@19.07,72.87,17z"))
        // A short link carries no coordinates until it has been followed.
        assertNull(SharedDestination.parse("https://maps.app.goo.gl/aBcDeF12345"))
    }

    @Test
    fun `finds the link inside a shared message`() {
        val message = "Location: https://maps.app.goo.gl/xY7abc — reach by 6pm"
        assertEquals("https://maps.app.goo.gl/xY7abc", SharedDestination.firstUrl(message))
    }

    @Test
    fun `the inbox hands a destination over exactly once`() {
        val inbox = SharedDestinationInbox()
        assertNull(inbox.take())

        inbox.offer(SharedDestination(28.6, 77.2, "Gate 3"))
        assertEquals("Gate 3", inbox.take()?.label)
        assertNull(inbox.take())
    }
}
