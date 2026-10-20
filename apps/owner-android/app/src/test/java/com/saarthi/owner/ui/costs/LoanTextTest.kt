package com.saarthi.owner.ui.costs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/** Sanction letters and EMI schedules as the phone's text recognition returns them. */
class LoanTextTest {

    @Test
    fun `reads a labelled sanction letter`() {
        val letter = """
            SHRIRAM FINANCE LIMITED
            Regd. Office: Chennai
            SANCTION LETTER
            Date: 02/08/2025
            Loan Account No: CVL/2025/004512
            Vehicle No: HR26CD4321
            Loan Amount: Rs. 12,50,000.00
            Rate of Interest: 11.75% p.a. (Reducing balance)
            Tenure: 48 Months
            EMI Amount: Rs. 32,780
            Date of Disbursement: 05/08/2025
            First EMI Date: 05/09/2025
            EMI to be debited on 5th of every month from HDFC Bank A/c XXXX1234
            Penal interest @ 24% p.a. on overdue amounts
        """.trimIndent()
        val read = LoanText.read(letter)
        assertEquals("Shriram Finance", read.lender)
        assertEquals("CVL/2025/004512", read.loanNumber)
        assertEquals(1_250_000.0, read.principal!!, 0.01)
        assertEquals(11.75, read.ratePercent!!, 0.001)
        assertEquals(false, read.flat)
        assertEquals(48, read.tenureMonths)
        assertEquals(32_780.0, read.emi!!, 0.01)
        assertEquals(LocalDate.of(2025, 8, 5), read.startDate)
        assertEquals(LocalDate.of(2025, 9, 5), read.firstDue)
        assertEquals(5, read.debitDay)
        assertEquals("HR26CD4321", read.plate)
        assertTrue(read.foundAnything)
    }

    @Test
    fun `reads a letter printed as a table, values under their labels`() {
        val letter = """
            Tata Motors Finance Ltd
            Loan Agreement No
            TMF8834120
            Amount Financed
            ₹ 18,40,000
            Interest Rate
            9.5 % Flat
            Tenure
            5 Years
            Monthly EMI
            45,240
            First Instalment Date
            10-Jan-2026
        """.trimIndent()
        val read = LoanText.read(letter)
        assertEquals("Tata Motors Finance", read.lender)
        assertEquals("TMF8834120", read.loanNumber)
        assertEquals(1_840_000.0, read.principal!!, 0.01)
        assertEquals(9.5, read.ratePercent!!, 0.001)
        assertEquals(true, read.flat)
        assertEquals(60, read.tenureMonths)
        assertEquals(45_240.0, read.emi!!, 0.01)
        assertEquals(LocalDate.of(2026, 1, 10), read.firstDue)
        assertEquals(10, read.debitDay)
    }

    @Test
    fun `a premium and a first EMI day are not taken for the EMI`() {
        val letter = """
            ICICI BANK LIMITED
            Insurance premium: 18,500
            First EMI: 05/12/2026
            No. of EMIs: 36
        """.trimIndent()
        val read = LoanText.read(letter)
        assertEquals("ICICI Bank", read.lender)
        assertNull(read.emi)
        assertEquals(36, read.tenureMonths)
        assertEquals(LocalDate.of(2026, 12, 5), read.firstDue)
    }

    @Test
    fun `the letterhead lender wins over a bank named for the auto-debit`() {
        val letter = """
            Ashok Vehicle Finance Pvt Ltd
            Loan No. AVF-77812
            Auto-debit mandate on State Bank of India account
        """.trimIndent()
        val read = LoanText.read(letter)
        assertEquals("Ashok Vehicle Finance Pvt Ltd", read.lender)
        assertEquals("AVF-77812", read.loanNumber)
    }

    @Test
    fun `a penal rate alone is not the loan's rate`() {
        val read = LoanText.read("Penal interest 24% p.a. on delayed payment")
        assertNull(read.ratePercent)
    }

    @Test
    fun `nothing readable reads as nothing`() {
        val read = LoanText.read("Thank you for banking with us")
        assertFalse(read.foundAnything)
        assertNull(read.principal)
        assertNull(read.firstDue)
    }
}
