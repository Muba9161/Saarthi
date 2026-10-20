package com.saarthi.owner.ui.papers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate

class PaperTextTest {

    private val today = LocalDate.of(2026, 10, 16)
    private val plate = "RJ 14 EF 1122"

    private fun read(text: String, type: String) = PaperText.read(text.trimIndent(), type, plate, today)

    @Test
    fun `a PUC gives its number, test date and validity`() {
        val paper = read(
            """
            POLLUTION UNDER CONTROL CERTIFICATE
            Certificate SL No: UP01234567
            Vehicle No: RJ14EF1122
            Date: 16/10/2026   Time: 10:30
            Validity Upto: 15/04/2027
            """,
            "POLLUTION_CERTIFICATE",
        )

        assertEquals("UP01234567", paper.number)
        assertEquals(LocalDate.of(2026, 10, 16), paper.issuedOn)
        assertEquals(LocalDate.of(2027, 4, 15), paper.expiresOn)
        assertNull(paper.otherPlate)
    }

    @Test
    fun `an insurance period reads from and to, with month names`() {
        val paper = read(
            """
            Certificate of Insurance
            Policy No. 3001/123456789/00/000
            Period of Insurance: From 16-Oct-2026 To Midnight of 15-Oct-2027
            Registration No: RJ-14-EF-1122
            """,
            "INSURANCE",
        )

        assertEquals("3001/123456789/00/000", paper.number)
        assertEquals(LocalDate.of(2026, 10, 16), paper.issuedOn)
        assertEquals(LocalDate.of(2027, 10, 15), paper.expiresOn)
    }

    @Test
    fun `a zero read for the O of a month name still reads as the month`() {
        // As the phone's reader returned a test insurance photo.
        val paper = read(
            """
            Policy No. 3001/987654321/00/000
            Period of Insurance: From 16-0ct-2026
            To Midnight of 15-Oct-2027
            """,
            "INSURANCE",
        )

        assertEquals(LocalDate.of(2026, 10, 16), paper.issuedOn)
        assertEquals(LocalDate.of(2027, 10, 15), paper.expiresOn)
    }

    @Test
    fun `letters OCR puts in place of digits are repaired inside a date`() {
        val paper = read("Valid Upto: 15/O4/2O27", "PERMIT")

        assertEquals(LocalDate.of(2027, 4, 15), paper.expiresOn)
    }

    @Test
    fun `a label on the line above names the date under it`() {
        val paper = read(
            """
            Valid Upto
            15/04/2027
            """,
            "FITNESS_CERTIFICATE",
        )

        assertEquals(LocalDate.of(2027, 4, 15), paper.expiresOn)
    }

    @Test
    fun `a paper naming another vehicle is flagged`() {
        val paper = read("Permit No: PB/2026/12345\nVehicle: UP 16 GH 7788\nValid upto 01/01/2028", "PERMIT")

        assertEquals("UP16GH7788", paper.otherPlate)
        assertEquals("PB/2026/12345", paper.number)
    }

    @Test
    fun `the RC's number is the registration it names`() {
        val paper = read("CERTIFICATE OF REGISTRATION\nRegn. No. RJ14EF1122\nReg. Date 12/03/2019\nRegn. Validity 11/03/2034", "REGISTRATION_CERTIFICATE")

        assertEquals("RJ14EF1122", paper.number)
        assertEquals(LocalDate.of(2034, 3, 11), paper.expiresOn)
    }

    @Test
    fun `without labels the latest future date is the expiry`() {
        val paper = read("Receipt 01/01/2020 something 31/12/2027", "ROAD_TAX")

        assertEquals(LocalDate.of(2027, 12, 31), paper.expiresOn)
        assertEquals(LocalDate.of(2020, 1, 1), paper.issuedOn)
    }

    @Test
    fun `a labelled expiry is trusted even once it has passed`() {
        val paper = read("Valid upto 01/01/2025", "POLLUTION_CERTIFICATE")

        assertEquals(LocalDate.of(2025, 1, 1), paper.expiresOn)
    }

    @Test
    fun `a two-letter word is not mistaken for a registration`() {
        val paper = read("NO 12 AB 1234 Valid upto 01/01/2028", "PERMIT")

        assertNull(paper.otherPlate)
    }

    @Test
    fun `a driving licence gives its number without gaps, and its validity`() {
        val paper = read(
            """
            Union of India Driving Licence
            DL No: MH12 20110012345
            DOB: 01-02-1985
            Issue Date: 05-06-2011
            Validity (NT): 04-06-2031
            """,
            PaperText.LICENCE,
        )

        assertEquals("MH1220110012345", paper.number)
        assertEquals(LocalDate.of(2031, 6, 4), paper.expiresOn)
    }

    @Test
    fun `letters read for digits inside a licence number are repaired, not the state code`() {
        val paper = read("DL-142O1100I2345 valid till 01/01/2030", PaperText.LICENCE)

        assertEquals("DL1420110012345", paper.number)
    }

    @Test
    fun `nothing readable gives nothing`() {
        val paper = read("a blurry photo of a dashboard", "INSURANCE")

        assertFalse(paper.foundAnything)
    }
}
