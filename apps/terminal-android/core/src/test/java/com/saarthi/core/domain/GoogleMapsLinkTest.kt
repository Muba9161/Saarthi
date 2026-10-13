package com.saarthi.core.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** The link that hands a journey to Google Maps. */
class GoogleMapsLinkTest {

    @Test
    fun `navigates straight to the destination by road, with no stops on the way`() {
        assertEquals(
            "https://www.google.com/maps/dir/?api=1&destination=26.882600,81.030600" +
                "&travelmode=driving&dir_action=navigate",
            GoogleMapsLink.navigate(26.8826, 81.0306),
        )
    }

    @Test
    fun `writes coordinates the same on a phone set to Hindi or Bengali`() {
        val before = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("bn-IN"))
            assertTrue(GoogleMapsLink.navigate(26.8826, 81.0306).contains("destination=26.882600,81.030600"))
        } finally {
            Locale.setDefault(before)
        }
    }
}
