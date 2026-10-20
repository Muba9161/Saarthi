package com.saarthi.owner.ui.papers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/** Business certificates, weighbridge slips and a licence's holder, as the phone's text recognition returns them. */
class BusinessPapersTest {

    private val today = LocalDate.of(2026, 10, 20)

    @Test
    fun `a GSTIN is taken only when its check character proves it`() {
        assertTrue(CertificateText.isGstin("27AAPFU0939F1ZV"))
        assertFalse(CertificateText.isGstin("27AAPFU0939F1ZW"))
        assertEquals('V', CertificateText.checkCharacter("27AAPFU0939F1Z"))
    }

    @Test
    fun `reads a GST registration certificate, repairing OCR swaps in the GSTIN`() {
        val reg06 = """
            Government of India
            Form GST REG-06
            Registration Certificate
            Registration Number: 27AAPFU0939F1ZV
            1. Legal Name: SHARMA ROADLINES PRIVATE LIMITED
            2. Trade Name, if any: SHARMA TRANSPORT CO
            Date of Liability: 01/07/2017
        """.trimIndent()
        val read = CertificateText.read(reg06, today)
        assertEquals("27AAPFU0939F1ZV", read.gstin)
        assertEquals("Sharma Transport Co", read.name)
        assertNull(read.foundedYear)

        // "O" for "0" and "I" for "1" where digits belong, as a phone often reads them.
        assertEquals("27AAPFU0939F1ZV", CertificateText.read("GSTIN 27AAPFUO939FIZV", today).gstin)
        assertNull(CertificateText.read("GSTIN 27AAPFU0939F1ZW", today).gstin)
    }

    @Test
    fun `reads an Udyam certificate's number and the year the business began`() {
        val udyam = """
            UDYAM REGISTRATION CERTIFICATE
            UDYAM REGISTRATION NUMBER UDYAM-MH-26-0012345
            NAME OF ENTERPRISE M/S SHARMA ROADLINES
            DATE OF INCORPORATION / REGISTRATION OF ENTERPRISE 14/03/2009
        """.trimIndent()
        val read = CertificateText.read(udyam, today)
        assertEquals("UDYAM-MH-26-0012345", read.registrationNumber)
        assertEquals(2009, read.foundedYear)
        assertEquals("Sharma Roadlines", read.name)
    }

    @Test
    fun `reads a weighbridge slip's net weight, or works it out from gross and tare`() {
        assertEquals(18_340.0, WeighSlipText.netKg("SHIV DHARAM KANTA\nSLIP NO 4521\nGROSS WT 27,560 KG\nTARE WT 9,220 KG\nNET WT 18,340 KG")!!, 0.01)
        assertEquals(18_340.0, WeighSlipText.netKg("GROSS 27560\nTARE 9220\nDATE 18/10/2026 14:22")!!, 0.01)
        assertEquals(18_340.0, WeighSlipText.netKg("NET WEIGHT 18.340 MT")!!, 0.01)
        assertNull(WeighSlipText.netKg("THANK YOU"))
    }

    @Test
    fun `reads a licence's holder and classes, not a parent's name`() {
        val licence = """
            INDIAN UNION DRIVING LICENCE
            Issued by Government of Haryana
            DL No: HR26 20110012345
            Name: RAMESH KUMAR YADAV
            S/D/W of: SURESH YADAV
            DOB: 12-04-1985
            COV: LMV, TRANS, HGMV
        """.trimIndent()
        assertEquals("Ramesh Kumar Yadav", PaperText.holderName(licence))
        assertEquals("LMV, TRANS, HGMV", PaperText.licenceClasses(licence))

        val parentFirst = "Father's Name: SURESH YADAV\nName\nRAMESH YADAV"
        assertEquals("Ramesh Yadav", PaperText.holderName(parentFirst))
        assertEquals("LMV-NT", PaperText.licenceClasses("Class of Vehicle LMV - NT"))
    }
}
