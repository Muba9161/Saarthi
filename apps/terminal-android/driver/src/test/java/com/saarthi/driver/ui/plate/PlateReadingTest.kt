package com.saarthi.driver.ui.plate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlateReadingTest {

    private fun read(vararg lines: String) = PlateReading.read(lines.toList())

    @Test
    fun `reads an ordinary plate on one line`() {
        assertEquals("MH 12 AB 1234", read("MH 12 AB 1234"))
        assertEquals("MH 12 AB 1234", read("MH12AB1234"))
        assertEquals("KA 01 MJ 2345", read("KA-01-MJ-2345"))
    }

    @Test
    fun `reads a delhi plate with a one-digit district and three-letter series`() {
        assertEquals("DL 3 CAB 1234", read("DL 3C AB 1234"))
    }

    @Test
    fun `reads a plate split over two rows`() {
        assertEquals("UP 16 AB 1234", read("UP 16", "AB 1234"))
    }

    @Test
    fun `ignores the IND strip and other text around the plate`() {
        assertEquals("GJ 05 CD 4321", read("IND", "GJ 05 CD 4321", "Maruti Suzuki"))
        assertEquals("GJ 05 CD 4321", read("INDGJ05CD4321"))
    }

    @Test
    fun `puts right the usual misreads by position`() {
        // O read for 0 in the RTO, B read for 8 in the number.
        assertEquals("TN 09 AK 4858", read("TN O9 AK 4B58"))
        // 0 read for O in the state code.
        assertEquals("OD 02 AB 1234", read("0D 02 AB 1234"))
        // S read for 5: a four-digit number beats a longer series with a short one.
        assertEquals("UP 65 EP 5205", read("UP 65 EPS205"))
        assertEquals("UP 65 EP 5205", read("UP 65 EPS 2O5"))
        // S read for 5 in the RTO: only Delhi has a one-digit RTO.
        assertEquals("UP 65 EP 5205", read("UP 6SEP 5205"))
        // Read off a hand-written plate on a phone: every 5 came back as s.
        assertEquals("UP 65 EP 5205", read("UP 65 eP s2os"))
        assertEquals("UP 65 EP 5205", read("UP 6SeP s2oS"))
    }

    @Test
    fun `an unreadable symbol breaks the line rather than gluing it`() {
        // `@` for a scrawled E must not leave `UP 65 P 5205` behind.
        assertNull(read("UP 65 @P 5205"))
    }

    @Test
    fun `refuses text that needs too many guesses`() {
        assertNull(read("MH IZ AB IZS4"))
    }

    @Test
    fun `a plate only partly in view fills in nothing`() {
        // Seen on a phone: the plate ran off the frame's edge and `UP 6 EPS 2` was filled in.
        assertNull(read("UP 6 EPS 2"))
        assertNull(read("UP 65 EP 52"))
        assertEquals("DL 1 CA 0007", read("DL 1 CA 0007"))
    }

    @Test
    fun `reads a bharat series plate`() {
        assertEquals("22 BH 1234 AA", read("22 BH 1234 AA"))
        assertEquals("21 BH 0420 C", read("21BH0420C"))
    }

    @Test
    fun `finds nothing in text that is not a plate`() {
        assertNull(read())
        assertNull(read("HORN OK PLEASE"))
        assertNull(read("IN 01 AB 1234"))
        assertNull(read("MH 12 0000"))
        assertNull(read("MH 12"))
        assertNull(read("12345"))
    }

    @Test
    fun `consensus waits for three agreeing frames`() {
        val consensus = PlateConsensus()
        assertNull(consensus.offer("MH 12 AB 1234"))
        assertNull(consensus.offer(null))
        assertNull(consensus.offer("MH 12 AB 1Z34"))
        assertNull(consensus.offer("MH 12 AB 1234"))
        assertEquals("MH 12 AB 1234", consensus.offer("MH 12 AB 1234"))
    }

    @Test
    fun `consensus forgets readings older than its window`() {
        val consensus = PlateConsensus(needed = 2, window = 2)
        consensus.offer("MH 12 AB 1234")
        consensus.offer("KA 01 MJ 2345")
        assertNull(consensus.offer("DL 3 CAB 1234"))
        assertNull(consensus.offer("MH 12 AB 1234"))
    }
}
