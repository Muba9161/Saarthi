package com.saarthi.core.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which pump price a vehicle is shown.
 *
 * The card used to say "Diesel today" to every vehicle on the platform, so an
 * electric scooter was told the price of diesel. These cases pin down the rule
 * that replaced it.
 */
class PumpPriceTest {

    @Test
    fun `a recorded fuel type shows only its own rate`() {
        assertEquals(listOf(PumpPrice.Fuel.DIESEL), PumpPrice.shownFor("DIESEL"))
        assertEquals(listOf(PumpPrice.Fuel.PETROL), PumpPrice.shownFor("PETROL"))
        assertEquals(listOf(PumpPrice.Fuel.CNG), PumpPrice.shownFor("CNG"))
    }

    @Test
    fun `an electric vehicle is shown no pump price at all`() {
        // There is no pump price for a battery, and no electricity tariff
        // provider behind this card.
        assertEquals(emptyList<PumpPrice.Fuel>(), PumpPrice.shownFor("ELECTRIC"))
        assertFalse(PumpPrice.worthFetching("ELECTRIC"))
    }

    @Test
    fun `an LNG vehicle is shown nothing rather than the diesel rate`() {
        // A real fuel for heavy haulage that the rate provider does not publish.
        // Silence is honest; substituting diesel is not.
        assertEquals(emptyList<PumpPrice.Fuel>(), PumpPrice.shownFor("LNG"))
    }

    @Test
    fun `a hybrid gets the liquid fuel it actually burns`() {
        // Every hybrid sold in India is petrol-electric.
        assertEquals(listOf(PumpPrice.Fuel.PETROL), PumpPrice.shownFor("HYBRID"))
    }

    @Test
    fun `an unrecorded fuel type shows every rate rather than guessing one`() {
        val all = listOf(PumpPrice.Fuel.DIESEL, PumpPrice.Fuel.PETROL, PumpPrice.Fuel.CNG)
        assertEquals(all, PumpPrice.shownFor(null))
        assertEquals(all, PumpPrice.shownFor(""))
        assertEquals(all, PumpPrice.shownFor("SOMETHING_NEW"))
    }

    @Test
    fun `the fuel type is read whatever case the server sends`() {
        assertEquals(listOf(PumpPrice.Fuel.DIESEL), PumpPrice.shownFor("diesel"))
        assertEquals(listOf(PumpPrice.Fuel.DIESEL), PumpPrice.shownFor("Diesel"))
    }

    @Test
    fun `CNG is priced by weight and the others by volume`() {
        // Printing "a litre" against a CNG rate would be wrong by about a third
        // — an error a driver would only discover at the till.
        assertEquals(PumpPrice.Unit.KILOGRAM, PumpPrice.unitOf(PumpPrice.Fuel.CNG))
        assertEquals(PumpPrice.Unit.LITRE, PumpPrice.unitOf(PumpPrice.Fuel.DIESEL))
        assertEquals(PumpPrice.Unit.LITRE, PumpPrice.unitOf(PumpPrice.Fuel.PETROL))
    }

    @Test
    fun `a lookup is only worth making when something can be shown`() {
        assertTrue(PumpPrice.worthFetching("DIESEL"))
        assertTrue(PumpPrice.worthFetching(null))
        assertFalse(PumpPrice.worthFetching("LNG"))
    }
}
