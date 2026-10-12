package com.saarthi.core.telemetry

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Moving or parked, one fix at a time — and a parked phone indoors kept parked. */
class MotionGateTest {

    @Test
    fun `a single indoor speed spike does not set a parked vehicle moving`() {
        val gate = MotionGate()
        assertFalse(gate.update(speedMps = 2.6f, speedAccuracyMps = null, accuracyMetres = 12f))
        assertFalse(gate.update(speedMps = 0.2f, speedAccuracyMps = null, accuracyMetres = 12f))
        assertFalse(gate.update(speedMps = 2.6f, speedAccuracyMps = null, accuracyMetres = 12f))
    }

    @Test
    fun `a speed from a badly placed fix does not count`() {
        val gate = MotionGate()
        repeat(3) { assertFalse(gate.update(speedMps = 3f, speedAccuracyMps = null, accuracyMetres = 65f)) }
    }

    @Test
    fun `a speed smaller than its own error is no speed`() {
        val gate = MotionGate()
        repeat(3) { assertFalse(gate.update(speedMps = 2.5f, speedAccuracyMps = 3f, accuracyMetres = 8f)) }
    }

    @Test
    fun `pulling away outdoors counts on the second fix`() {
        val gate = MotionGate()
        assertFalse(gate.update(speedMps = 3f, speedAccuracyMps = 0.5f, accuracyMetres = 6f))
        assertTrue(gate.update(speedMps = 4f, speedAccuracyMps = 0.5f, accuracyMetres = 6f))
    }

    @Test
    fun `keeps moving under a flyover and stops below walking pace`() {
        val gate = MotionGate()
        gate.update(speedMps = 8f, speedAccuracyMps = 0.5f, accuracyMetres = 6f)
        gate.update(speedMps = 8f, speedAccuracyMps = 0.5f, accuracyMetres = 6f)
        assertTrue(gate.update(speedMps = 8f, speedAccuracyMps = 1f, accuracyMetres = 45f))
        assertTrue(gate.update(speedMps = 1.5f, speedAccuracyMps = 0.5f, accuracyMetres = 6f))
        assertFalse(gate.update(speedMps = 0.5f, speedAccuracyMps = 0.3f, accuracyMetres = 6f))
    }

    @Test
    fun `a fix with no speed holds the last verdict`() {
        val gate = MotionGate()
        gate.update(speedMps = 8f, speedAccuracyMps = null, accuracyMetres = 6f)
        gate.update(speedMps = 8f, speedAccuracyMps = null, accuracyMetres = 6f)
        assertTrue(gate.update(speedMps = null, speedAccuracyMps = null, accuracyMetres = 20f))
    }
}
