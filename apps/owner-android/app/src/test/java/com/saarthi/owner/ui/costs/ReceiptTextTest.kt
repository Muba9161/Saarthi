package com.saarthi.owner.ui.costs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate

/** Bank messages, payment receipts and FASTag screens as the phone's text recognition returns them. */
class ReceiptTextTest {

    private val today = LocalDate.of(2026, 10, 20)

    @Test
    fun `reads a bank debit message, keeping the balance apart from the payment`() {
        val sms = "A/c *0544 Debited for Rs:32,780.00 on 05-10-2026 10:15:02 by Mob Bk ref no 571790764158 Avl Bal Rs:1,284.47.If not you, Call 1800222243 -Union Bank of India"
        val read = ReceiptText.read(sms, today)
        assertEquals(32_780.0, read.amount!!, 0.001)
        assertEquals(1_284.47, read.balance!!, 0.001)
        assertEquals(LocalDate.of(2026, 10, 5), read.date)
        assertEquals("571790764158", read.reference)
        assertEquals("BANK_TRANSFER", read.method)
    }

    @Test
    fun `reads a printed EMI receipt`() {
        val receipt = """
            SHRIRAM FINANCE LIMITED
            PAYMENT RECEIPT
            Amount Paid: ₹ 32,780
            Paid on: 05/10/2026
            Mode: NACH
            UTR No: HDFCN52026100512345
        """.trimIndent()
        val read = ReceiptText.read(receipt, today)
        assertEquals(32_780.0, read.amount!!, 0.001)
        assertEquals(LocalDate.of(2026, 10, 5), read.date)
        assertEquals("NACH", read.method)
        assertEquals("HDFCN52026100512345", read.reference)
    }

    @Test
    fun `reads a FASTag recharge message and a balance screen`() {
        val recharge = ReceiptText.read(
            "Your FASTag wallet has been recharged with Rs.500.00 on 18-10-2026. Txn ID: FT2610181234. Available balance Rs.1,240.00",
            today,
        )
        assertEquals(500.0, recharge.amount!!, 0.001)
        assertEquals(1_240.0, recharge.balance!!, 0.001)
        assertEquals("FT2610181234", recharge.reference)

        val screen = ReceiptText.read("FASTag\nHR26CD4321\nTag Balance\n₹ 2,315.50\nUpdated 19 Oct 2026", today)
        assertEquals(2_315.5, screen.balance!!, 0.001)
        assertEquals(LocalDate.of(2026, 10, 19), screen.date)
    }

    @Test
    fun `a UPI payment reads as UPI, and nothing readable reads as nothing`() {
        val upi = ReceiptText.read("Paid ₹25,400 to SHRIRAM FINANCE\nUPI Ref No 629812345678\n20 Oct 2026, 9:41 am", today)
        assertEquals(25_400.0, upi.amount!!, 0.001)
        assertEquals("UPI", upi.method)
        assertEquals("629812345678", upi.reference)

        val blank = ReceiptText.read("Thank you", today)
        assertFalse(blank.foundAnything)
        assertNull(blank.amount)
    }
}
