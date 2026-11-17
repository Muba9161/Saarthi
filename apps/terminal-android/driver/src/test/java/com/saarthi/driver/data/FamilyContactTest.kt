package com.saarthi.driver.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * One field takes a family member by mobile number or by email address — kept
 * in step with the server's `rideShareContactSchema`.
 */
class FamilyContactTest {

    @Test
    fun `digits stay a number, and a letter or an @ makes it an address`() {
        assertEquals("9876543210", FamilyContact.typed("+91 98765-43210"))
        assertEquals("98a", FamilyContact.typed("98a"))
        assertEquals("asha@example.com", FamilyContact.typed("asha @example.com"))
        assertFalse(FamilyContact.isEmail("98765 43210"))
        assertTrue(FamilyContact.isEmail("@"))
    }

    @Test
    fun `an address is sent in lower case and checked for its shape`() {
        assertEquals("asha@example.com", FamilyContact.normalised(" Asha@Example.COM "))
        assertTrue(FamilyContact.isValid("asha@example.com"))
        assertFalse(FamilyContact.isValid("asha@example"))
        assertFalse(FamilyContact.isValid("asha"))
        assertFalse(FamilyContact.isValid("a".repeat(250) + "@x.com"))
    }

    @Test
    fun `a number is checked as every other mobile number in the app is`() {
        assertTrue(FamilyContact.isValid(FamilyContact.normalised("98765 43210")))
        assertFalse(FamilyContact.isValid(FamilyContact.normalised("58765 43210")))
    }

    @Test
    fun `read back as a person would say it`() {
        assertEquals("+91 98765 43210", FamilyContact.shown("9876543210"))
        assertEquals("asha@example.com", FamilyContact.shown("asha@example.com"))
    }
}
