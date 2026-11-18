package com.saarthi.owner.ui.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** How far a downloaded picture is sampled down before it is drawn. */
class RemoteImageTest {

    @Test
    fun `a phone photo for a small circle is sampled well down, and still covers it`() {
        // A 4000 x 3000 web upload in a 48 dp circle at 3x: a 144 px box.
        val sample = sampleSizeFor(4000, 3000, 144, 144)
        assertEquals(16, sample)
        assertTrue(3000 / sample >= 144)
    }

    @Test
    fun `a cover keeps enough width for the banner it fills`() {
        // A 1600 x 533 cover across a 1080 x 360 px banner: halving would leave it too narrow.
        assertEquals(1, sampleSizeFor(1600, 533, 1080, 360))
        assertEquals(2, sampleSizeFor(3200, 1066, 1080, 360))
    }

    @Test
    fun `a picture already smaller than its box is decoded as it is`() {
        assertEquals(1, sampleSizeFor(100, 100, 144, 144))
    }

    @Test
    fun `an unreadable picture or an empty box never divides by nothing`() {
        assertEquals(1, sampleSizeFor(0, 0, 144, 144))
        assertEquals(1, sampleSizeFor(-1, 300, 144, 144))
        assertEquals(1, sampleSizeFor(100, 100, 0, 0))
    }

    @Test
    fun `a huge picture is held to a sane size whatever box asks for it`() {
        val sample = sampleSizeFor(12_000, 9_000, 12_000, 9_000)
        assertTrue((12_000L / sample) * (9_000L / sample) <= 4_000_000L)
    }
}
