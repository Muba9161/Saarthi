package com.saarthi.terminal

import com.saarthi.terminal.telemetry.Metric
import com.saarthi.terminal.telemetry.MetricSource
import com.saarthi.terminal.telemetry.ObdSession
import java.io.ByteArrayOutputStream
import java.io.InputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The ELM327 conversation, without a car.
 *
 * These are the cases that decide whether a driver is shown the truth. An
 * adapter answers in a loose, chatty, only-approximately-standard dialect, and
 * every one of these replies is something a real one sends: a PID the vehicle
 * does not support, a `NO DATA` for one it claims to, an error string where a
 * frame should be. The rule under test throughout is section 18 — a value that
 * was not measured is absent, never zero.
 */
class ObdSessionTest {

    /**
     * A scripted adapter.
     *
     * Answers a fixed table and appends the `>` prompt the real hardware uses to
     * end every reply, so the session's framing is exercised rather than
     * bypassed.
     */
    private class FakeElm(private val answers: Map<String, String>) {
        val written = ByteArrayOutputStream()
        private var pending: ByteArray = ByteArray(0)
        private var offset = 0

        val output = object : ByteArrayOutputStream() {
            override fun write(b: ByteArray, off: Int, len: Int) {
                written.write(b, off, len)
                val command = String(b, off, len).trim().uppercase()
                val reply = answers[command] ?: "NO DATA"
                pending = "$reply\r>".toByteArray()
                offset = 0
            }
        }

        val input = object : InputStream() {
            override fun read(): Int =
                if (offset < pending.size) pending[offset++].toInt() and 0xFF else -1

            override fun available(): Int = pending.size - offset
        }
    }

    private fun session(answers: Map<String, String>): ObdSession {
        val fake = FakeElm(answers)
        return ObdSession(fake.input, fake.output)
    }

    /** Support masks that advertise the six PIDs the cockpit actually reads. */
    private val supportAll = mapOf(
        "ATZ" to "ELM327 v1.5",
        "ATE0" to "OK",
        "ATL0" to "OK",
        "ATS0" to "OK",
        "ATH0" to "OK",
        "ATSP0" to "OK",
        // 0x04, 0x05, 0x0C, 0x0D, 0x0F, 0x10, 0x11 supported, and bit 32 set so
        // the next block is probed.
        "0100" to "4100BE3FA813",
        // 0x2F (fuel level) in the 0x21-0x40 block; last bit continues the chain.
        "0120" to "412000020001",
        // 0x5E (fuel rate) in the 0x41-0x60 block; chain continues.
        "0140" to "414000000005",
        // Nothing here, but the chain has to reach the odometer's block.
        "0160" to "416000000001",
        "0180" to "418000000001",
        // 0xA6 is offset 6, which is bit 26 — the third bit of the first byte.
        "01A0" to "41A004000000",
    )

    @Test
    fun `decodes the readings a cockpit shows`() {
        val obd = session(
            supportAll + mapOf(
                "010C" to "410C1AF8",  // (0x1A*256 + 0xF8) / 4 = 1726 rpm
                "010D" to "410D3C",    // 60 km/h
                "0105" to "41055A",    // 0x5A - 40 = 50 °C
                "012F" to "412F80",    // 0x80 * 100 / 255 = 50.2 %
                "0104" to "41044D",    // 0x4D * 100 / 255 = 30.2 %
                "0111" to "41111A",    // 0x1A * 100 / 255 = 10.2 %
                "ATRV" to "13.8V",
            ),
        )
        assertTrue(obd.initialise())

        val values = obd.readAll(at = 1_000L)
        assertEquals(1726.0, values[Metric.RPM]!!.value, 0.01)
        assertEquals(60.0, values[Metric.SPEED]!!.value, 0.01)
        assertEquals(50.0, values[Metric.COOLANT_TEMPERATURE]!!.value, 0.01)
        assertEquals(50.2, values[Metric.FUEL_LEVEL]!!.value, 0.1)
        assertEquals(13.8, values[Metric.BATTERY_VOLTAGE]!!.value, 0.01)

        // Provenance travels with the value all the way to the screen.
        assertEquals(MetricSource.OBD, values[Metric.SPEED]!!.source)
    }

    @Test
    fun `omits a PID the vehicle does not support`() {
        // The mask advertises nothing in the second block, so fuel level is not
        // asked for at all — and must not appear as 0%, which on a full tank
        // would send a driver looking for a pump.
        val obd = session(
            supportAll + mapOf("0120" to "412000000000", "010D" to "410D3C"),
        )
        assertTrue(obd.initialise())

        val values = obd.readAll(at = 0L)
        assertNull(values[Metric.FUEL_LEVEL])
        assertEquals(60.0, values[Metric.SPEED]!!.value, 0.01)
    }

    @Test
    fun `omits a supported PID that answers NO DATA`() {
        // Advertised and unanswered: a sensor can be unplugged, and some ECUs
        // claim more than they deliver. The mask decides what to ask; the reply
        // decides what is reported.
        val obd = session(supportAll + mapOf("010D" to "NO DATA", "010C" to "410C1AF8"))
        assertTrue(obd.initialise())

        val values = obd.readAll(at = 0L)
        assertNull(values[Metric.SPEED])
        assertEquals(1726.0, values[Metric.RPM]!!.value, 0.01)
    }

    @Test
    fun `refuses a reply meant for another PID`() {
        // A slow adapter can answer the previous question. Matching on the echo
        // is what stops an rpm frame being read as a speed.
        val obd = session(supportAll + mapOf("010D" to "410C1AF8"))
        assertTrue(obd.initialise())
        assertNull(obd.readAll(at = 0L)[Metric.SPEED])
    }

    @Test
    fun `treats an error string as no reading`() {
        val obd = session(supportAll + mapOf("010D" to "CAN ERROR"))
        assertTrue(obd.initialise())
        assertNull(obd.readAll(at = 0L)[Metric.SPEED])
    }

    @Test
    fun `reports a connected adapter with a sleeping engine as having no vehicle`() {
        // Ignition off: the adapter is fine and the ECU answers nothing. That is
        // a state to report, not a fault to raise.
        val obd = session(
            mapOf(
                "ATZ" to "ELM327 v1.5",
                "ATE0" to "OK",
                "ATL0" to "OK",
                "ATS0" to "OK",
                "ATH0" to "OK",
                "ATSP0" to "OK",
                "0100" to "NO DATA",
            ),
        )
        assertTrue(obd.initialise())
        assertTrue(!obd.hasVehicle)
        assertTrue(obd.readAll(at = 0L).none { it.key != Metric.BATTERY_VOLTAGE })
    }

    @Test
    fun `fails initialisation when the adapter is not an ELM327`() {
        // Something is on the serial port and it is not an OBD adapter. Better
        // to refuse than to spend the shift polling it.
        val obd = session(mapOf("ATZ" to "ELM327 v1.5", "ATE0" to "?"))
        assertTrue(!obd.initialise())
    }

    @Test
    fun `derives fuel rate from air flow when the vehicle has no fuel rate PID`() {
        // 0x0140 advertises PID 0x5E in the third block; here it does not, so
        // the air-flow route has to carry it. 5 g/s of air ÷ (14.5 × 835 g/L)
        // × 3600 = 1.49 L/h.
        val obd = session(
            supportAll + mapOf(
                "0110" to "411001F4",  // 500 ÷ 100 = 5.00 g/s
                "015E" to "NO DATA",
            ),
        )
        assertTrue(obd.initialise())
        assertEquals(1.49, obd.readAll(at = 0L)[Metric.FUEL_RATE]!!.value, 0.02)
    }

    @Test
    fun `prefers a measured fuel rate over a derived one`() {
        // Both available: the ECU's own figure wins, because the derivation
        // assumes a stoichiometric mixture and the ECU does not have to.
        val obd = session(
            supportAll + mapOf(
                "015E" to "415E0064",  // 100 ÷ 20 = 5.0 L/h
                "0110" to "411001F4",  // would derive 1.49
            ),
        )
        assertTrue(obd.initialise())
        assertEquals(5.0, obd.readAll(at = 0L)[Metric.FUEL_RATE]!!.value, 0.01)
    }

    @Test
    fun `refuses an air-flow reading that cannot be an engine`() {
        // A decode error rather than a truck drinking 300 L/h. Publishing it
        // would poison every average built on the series.
        val obd = session(supportAll + mapOf("0110" to "4110FFFF", "015E" to "NO DATA"))
        assertTrue(obd.initialise())
        assertNull(obd.readAll(at = 0L)[Metric.FUEL_RATE])
    }

    @Test
    fun `decodes the odometer as tenths of a kilometre`() {
        // 0x00139D22 = 1,285,410 tenths = 128,541.0 km
        val obd = session(supportAll + mapOf("01A6" to "41A600139D22"))
        assertTrue(obd.initialise())
        assertEquals(128_541.0, obd.readAll(at = 0L)[Metric.ODOMETER]!!.value, 0.1)
    }

    @Test
    fun `reads a VIN and refuses a truncated one`() {
        val full = "MAT445023N4C12345".toByteArray().joinToString("") { "%02X".format(it) }
        val obd = session(supportAll + mapOf("0902" to "490201$full"))
        assertTrue(obd.initialise())
        assertEquals("MAT445023N4C12345", obd.readVin())

        // Sixteen characters is a partial read. A VIN that looks plausible and
        // is not would quietly fail every check made against it.
        val short = "MAT445023N4C1234".toByteArray().joinToString("") { "%02X".format(it) }
        val truncated = session(supportAll + mapOf("0902" to "490201$short"))
        assertTrue(truncated.initialise())
        assertNull(truncated.readVin())
    }

    @Test
    fun `decodes stored fault codes`() {
        // 0x0143 -> P0143 and 0x6301 -> C2301: the top two bits pick the letter
        // and the remaining fourteen are the number. 0x6301 has those bits set
        // to 01, which is the chassis range — the same digits under 0x2301 would
        // be P2301, and getting that backwards is how a powertrain fault gets
        // reported as a brake one.
        val obd = session(supportAll + mapOf("03" to "4301436301"))
        assertTrue(obd.initialise())
        assertEquals(listOf("P0143", "C2301"), obd.readFaultCodes())
    }

    @Test
    fun `reports no fault codes rather than a fake one`() {
        val obd = session(supportAll + mapOf("03" to "NO DATA"))
        assertTrue(obd.initialise())
        assertTrue(obd.readFaultCodes().isEmpty())
    }
}
