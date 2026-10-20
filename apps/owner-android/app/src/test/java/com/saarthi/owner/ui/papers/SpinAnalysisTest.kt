package com.saarthi.owner.ui.papers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin

/** The web's `frame-selection.test.ts`, case for case, so both apps choose frames alike. */
class SpinAnalysisTest {

    private fun flat(value: Float, length: Int = 64) = FloatArray(length) { value }

    @Test
    fun `reads luma with the Rec 601 weights`() {
        val luma = toLuma(intArrayOf(0xFFFFFFFF.toInt(), 0xFFFF0000.toInt()))
        assertEquals(255f, luma[0], 0.01f)
        assertEquals(76.245f, luma[1], 0.01f)
    }

    @Test
    fun `scores a sharp edge above a smeared one`() {
        val width = 8
        val height = 8
        val edge = FloatArray(width * height) { at -> if (at % width < 4) 0f else 255f }
        val smeared = FloatArray(width * height) { at -> (at % width) / (width - 1f) * 255f }

        assertTrue(sharpness(edge, width, height) > sharpness(smeared, width, height))
        assertEquals(0.0, sharpness(flat(128f), 8, 8), 1e-9)
    }

    @Test
    fun `measures how different two samples are`() {
        assertEquals(0.0, meanAbsoluteDifference(flat(10f), flat(10f)), 1e-9)
        assertEquals(20.0, meanAbsoluteDifference(flat(10f), flat(30f)), 1e-9)
    }

    @Test
    fun `finds where a walk comes back to its starting view`() {
        // The view drifts away from the start and back, returning at sample 16 of 20.
        val samples = (0 until 20).map { index ->
            val distance = if (index <= 16) sin(PI * index / 16) * 100 else (index - 16) * 20.0
            flat(distance.toFloat())
        }
        assertEquals(16, findLoopClosure(samples))
    }

    @Test
    fun `reports no loop when the walk never returns`() {
        val samples = (0 until 20).map { flat(it * 10f) }
        assertNull(findLoopClosure(samples))
        assertNull(findLoopClosure(samples.take(4)))
    }

    @Test
    fun `keeps the sharpest candidate from each step and fills empty steps`() {
        val picks = pickSharpestPerSlot(
            listOf(FrameCandidate(200, 5.0), FrameCandidate(700, 9.0), FrameCandidate(1100, 3.0), FrameCandidate(1600, 1.0)),
            start = 0,
            end = 3000,
            slots = 3,
        )
        assertEquals(listOf(700L, 1100L, 2500L), picks)
    }

    private val frames = listOf("a", "b", "c", "d", "e")

    @Test
    fun `opens the loop on any frame`() {
        assertEquals(listOf("c", "d", "e", "a", "b"), startAt(frames, 2))
        assertEquals(listOf("e", "a", "b", "c", "d"), startAt(frames, -1))
        assertEquals(emptyList<String>(), startAt(emptyList<String>(), 3))
    }

    @Test
    fun `reverses the turn but keeps the opening view`() {
        val reversed = reverseTurn(frames)
        assertEquals(listOf("a", "e", "d", "c", "b"), reversed)
        assertEquals("b", reversed[reversedIndex(1, frames.size)])
        assertEquals("a", reversed[reversedIndex(0, frames.size)])
    }

    @Test
    fun `drops a single frame`() {
        assertEquals(listOf("a", "c", "d", "e"), withoutFrame(frames, 1))
    }
}
