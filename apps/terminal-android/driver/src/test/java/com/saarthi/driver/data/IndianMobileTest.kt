package com.saarthi.driver.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the app takes as a mobile number — at registration and when naming
 * family to share a ride with. One rule for both, kept in step with the
 * server's `phoneSchema`.
 */
class IndianMobileTest {

    @Test
    fun `spaces, a pasted +91 and a leading 0 all come down to ten digits`() {
        assertEquals("9876543210", IndianMobile.digits("98765 43210"))
        assertEquals("9876543210", IndianMobile.digits("+91 98765-43210"))
        assertEquals("9876543210", IndianMobile.digits("919876543210"))
        assertEquals("9876543210", IndianMobile.digits("09876543210"))
    }

    @Test
    fun `typing past ten digits is cut off rather than kept`() {
        assertEquals("9876543210", IndianMobile.digits("98765432109"))
    }

    @Test
    fun `only ten digits starting 6 to 9 are a mobile number`() {
        assertTrue(IndianMobile.isValid("6000000000"))
        assertTrue(IndianMobile.isValid("9876543210"))
        assertFalse(IndianMobile.isValid("5876543210"))
        assertFalse(IndianMobile.isValid("987654321"))
        assertFalse(IndianMobile.isValid(""))
    }

    @Test
    fun `a number reads back in two fives`() {
        assertEquals("98765 43210", IndianMobile.spaced("9876543210"))
        assertEquals("98765", IndianMobile.spaced("98765"))
    }
}
