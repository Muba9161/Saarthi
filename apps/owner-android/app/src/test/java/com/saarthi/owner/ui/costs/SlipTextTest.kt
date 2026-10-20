package com.saarthi.owner.ui.costs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime

/** Pump slips and workshop bills as the phone's text recognition returns them. */
class SlipTextTest {

    private val today = LocalDate.of(2026, 10, 20)

    @Test
    fun `reads a labelled pump slip`() {
        val slip = """
            INDIAN OIL
            SHREE BALAJI FILLING STATION
            NH 48 GURUGRAM
            RECEIPT NO: 004512
            DATE: 18/10/2026 TIME: 14:32:10
            PRODUCT: HSD
            RATE(RS/LTR): 89.62
            VOLUME(LTR): 55.80
            AMOUNT(RS): 5000.00
            VEHICLE NO: HR26CD4321
            THANK YOU
        """.trimIndent()
        val read = SlipText.fillUp(slip, today)
        assertEquals(55.8, read.litres!!, 0.001)
        assertEquals(89.62, read.rate!!, 0.001)
        assertEquals(5000.0, read.amount!!, 0.001)
        assertEquals(LocalDate.of(2026, 10, 18), read.filledOn)
        assertEquals(LocalTime.of(14, 32), read.filledAt)
        assertEquals("HR26CD4321", read.plate)
        assertEquals("Shree Balaji Filling Station", read.station)
    }

    @Test
    fun `finds the three numbers that agree when the labels come out in a column`() {
        val slip = """
            BHARAT PETROLEUM
            RATE
            VOLUME
            AMOUNT
            94.72
            31.67
            3000.00
            18-10-2026 09:05
        """.trimIndent()
        val read = SlipText.fillUp(slip, today)
        assertEquals(31.67, read.litres!!, 0.001)
        assertEquals(94.72, read.rate!!, 0.001)
        assertEquals(3000.0, read.amount!!, 0.001)
        assertEquals(LocalTime.of(9, 5), read.filledAt)
        assertEquals("Bharat Petroleum", read.station)
    }

    @Test
    fun `works out the litres from the amount and the rate`() {
        val read = SlipText.fillUp("AMOUNT 2,500.00\nPRICE 101.35", today)
        assertEquals(2500.0, read.amount!!, 0.001)
        assertEquals(24.67, read.litres!!, 0.001)
    }

    @Test
    fun `a slip with nothing on it reads as nothing, and an old date is not taken`() {
        assertFalse(SlipText.fillUp("THANK YOU VISIT AGAIN", today).foundAnything)
        assertNull(SlipText.fillUp("DATE 01/01/2025", today).filledOn)
    }

    @Test
    fun `reads a workshop bill`() {
        val bill = """
            SHARMA MOTORS & AUTOMOBILES
            PLOT 12, TRANSPORT NAGAR, JAIPUR
            TAX INVOICE
            INVOICE NO: SM/2026/1187   DATE: 12/10/2026
            VEHICLE: RJ14EF1122   KM READING: 84,512
            ENGINE OIL 15W40       2,450.00
            OIL FILTER               380.00
            GENERAL SERVICE LABOUR 1,200.00
            SUB TOTAL              4,030.00
            CGST 9%                  362.70
            SGST 9%                  362.70
            GRAND TOTAL            4,755.40
        """.trimIndent()
        val read = SlipText.bill(bill, today)
        assertEquals(4755.4, read.total!!, 0.001)
        assertEquals(LocalDate.of(2026, 10, 12), read.date)
        assertEquals("SM/2026/1187", read.invoiceNumber)
        assertEquals("Sharma Motors & Automobiles", read.workshop)
        assertEquals(84512.0, read.odometerKm!!, 0.001)
        assertEquals("PREVENTIVE", read.type)
        assertEquals("RJ14EF1122", read.plate)
    }

    @Test
    fun `a tyre shop's bill reads as tyre work, totalled without a sub-total`() {
        val bill = """
            NEW INDIA TYRES
            BILL NO 2231
            TYRE 10.00 R20 X 2     36,000.00
            ALIGNMENT                 600.00
            TOTAL                  36,600.00
        """.trimIndent()
        val read = SlipText.bill(bill, today)
        assertEquals(36600.0, read.total!!, 0.001)
        assertEquals("2231", read.invoiceNumber)
        assertEquals("TYRE", read.type)
        assertEquals("New India Tyres", read.workshop)
    }

    @Test
    fun `reads a toll receipt`() {
        val slip = """
            NHAI
            UNNAO TOLL PLAZA
            TICKET NO: 12345
            VEH NO: UP32AB1234
            CLASS: LCV
            DATE: 18/10/2026 10:21
            AMOUNT: Rs. 265.00
        """.trimIndent()
        val read = SlipText.expense(slip, today)
        assertEquals(265.0, read.amount!!, 0.001)
        assertEquals("TOLL", read.category)
        assertEquals("Unnao Toll Plaza", read.vendor)
        assertEquals(LocalDate.of(2026, 10, 18), read.date)
        assertEquals("UP32AB1234", read.plate)
    }

    @Test
    fun `reads a dhaba bill and a parking ticket`() {
        val dhaba = """
            SHER-E-PUNJAB DHABA
            NH 44 KARNAL
            2 THALI          360.00
            2 TEA             40.00
            TOTAL            400.00
        """.trimIndent()
        val food = SlipText.expense(dhaba, today)
        assertEquals(400.0, food.amount!!, 0.001)
        assertEquals("FOOD", food.category)
        assertEquals("Sher-e-punjab Dhaba", food.vendor)

        val parking = SlipText.expense("CITY PARKING\nTRUCK 12 HRS\nFEE 150", today)
        assertEquals(150.0, parking.amount!!, 0.001)
        assertEquals("PARKING", parking.category)
    }

    @Test
    fun `a bill in lakhs keeps its Indian grouping, and a decimal comma still reads`() {
        val bill = SlipText.bill("SAINI MOTORS WORKSHOP\nENGINE OVERHAUL\nGRAND TOTAL 1,25,400.00", today)
        assertEquals(125_400.0, bill.total!!, 0.001)
        assertEquals(listOf(94.27), SlipText.numbersOn("RATE 94,27"))
        assertEquals(listOf(5000.0), SlipText.numbersOn("AMOUNT 5,000"))
    }
}
