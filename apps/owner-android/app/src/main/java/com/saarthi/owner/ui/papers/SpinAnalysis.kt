package com.saarthi.owner.ui.papers

import kotlin.math.abs

/*
 * Choosing and ordering a 360° spin's frames — pure arithmetic over small
 * greyscale samples, the same rules as the web's `frame-analysis.ts` and
 * `frame-order.ts`, so a spin made on the phone turns like one made on the web.
 *
 *  - Which frame in each step of the walk is sharpest? A phone carried at
 *    walking pace smears every few frames; the one beside a smeared frame is
 *    usually clean, so sampling more than needed and keeping the best is the
 *    cheapest real improvement available.
 *  - Where does the walk come back to where it started? People rarely stop on
 *    the exact spot they began from, and a spin that overshoots jumps
 *    backwards every time it passes the front.
 */

/** Rec. 601 luma of ARGB pixels (as `Bitmap.getPixels` gives them), 0–255. */
internal fun toLuma(argb: IntArray): FloatArray = FloatArray(argb.size) { index ->
    val pixel = argb[index]
    0.299f * ((pixel shr 16) and 0xFF) + 0.587f * ((pixel shr 8) and 0xFF) + 0.114f * (pixel and 0xFF)
}

/** Variance of the Laplacian, the standard focus measure: edges raise it, blur flattens it. */
internal fun sharpness(luma: FloatArray, width: Int, height: Int): Double {
    var sum = 0.0
    var sumOfSquares = 0.0
    var samples = 0
    for (y in 1 until height - 1) {
        for (x in 1 until width - 1) {
            val at = y * width + x
            val laplacian = 4.0 * luma[at] - luma[at - 1] - luma[at + 1] - luma[at - width] - luma[at + width]
            sum += laplacian
            sumOfSquares += laplacian * laplacian
            samples++
        }
    }
    if (samples == 0) return 0.0
    val mean = sum / samples
    return sumOfSquares / samples - mean * mean
}

/** How different two same-sized samples look; 0 for identical. */
internal fun meanAbsoluteDifference(a: FloatArray, b: FloatArray): Double {
    val length = minOf(a.size, b.size)
    if (length == 0) return 0.0
    var total = 0.0
    for (index in 0 until length) total += abs(a[index] - b[index])
    return total / length
}

/** Fewer samples than this cannot say anything reliable about a loop. */
private const val MIN_SAMPLES_FOR_LOOP = 8

/**
 * The sample at which the walk arrives back at its starting view, or null when
 * it never clearly does. Measured against the typical difference from the
 * start rather than a fixed threshold, because "similar" depends on the
 * vehicle, the light and the background.
 */
internal fun findLoopClosure(samples: List<FloatArray>, searchFrom: Double = 0.6, maxRatio: Double = 0.6): Int? {
    val first = samples.firstOrNull() ?: return null
    if (samples.size < MIN_SAMPLES_FOR_LOOP) return null
    val differences = samples.map { meanAbsoluteDifference(first, it) }
    val typical = differences.drop(1).sorted()
    val median = typical.getOrNull(typical.size / 2) ?: 0.0
    if (median == 0.0) return null

    var best = -1
    var bestDifference = Double.POSITIVE_INFINITY
    for (index in (samples.size * searchFrom).toInt() until samples.size) {
        if (differences[index] < bestDifference) {
            best = index
            bestDifference = differences[index]
        }
    }
    return if (best > 0 && bestDifference < median * maxRatio) best else null
}

/** A moment of the video that could become a frame. */
internal data class FrameCandidate(val timeMs: Long, val sharpness: Double)

/**
 * The sharpest candidate's time in each of [slots] equal steps between [start]
 * and [end]. A step with no candidate in it falls back to its own midpoint, so
 * the spin never loses an angle.
 */
internal fun pickSharpestPerSlot(candidates: List<FrameCandidate>, start: Long, end: Long, slots: Int): List<Long> {
    val span = (end - start).toDouble() / slots
    return (0 until slots).map { slot ->
        val from = start + slot * span
        val to = from + span
        candidates.filter { it.timeMs >= from && it.timeMs < to }.maxByOrNull { it.sharpness }?.timeMs
            ?: (from + span / 2).toLong()
    }
}

/** The loop opened on another frame: that frame becomes the first view. */
internal fun <T> startAt(frames: List<T>, index: Int): List<T> {
    if (frames.isEmpty()) return frames
    val at = Math.floorMod(index, frames.size)
    return frames.drop(at) + frames.take(at)
}

/** The other way round, keeping the opening view first. */
internal fun <T> reverseTurn(frames: List<T>): List<T> =
    if (frames.size < 2) frames else listOf(frames.first()) + frames.drop(1).reversed()

/** Where frame [index] lands once the turn is reversed. */
internal fun reversedIndex(index: Int, count: Int): Int = if (index == 0) 0 else count - index

internal fun <T> withoutFrame(frames: List<T>, index: Int): List<T> = frames.filterIndexed { at, _ -> at != index }
