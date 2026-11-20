package com.saarthi.owner.ui.festive

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.saarthi.owner.festive.BandColors
import com.saarthi.owner.festive.FestiveDrop
import com.saarthi.owner.festive.FestiveKit
import com.saarthi.owner.festive.FestiveMotif
import com.saarthi.owner.festive.argbOf

/** How tall the garland hangs, as the design draws it. */
val FestiveBandHeight: Dp = 52.dp

/**
 * The festival's garland: one tile of its motif repeated across the full
 * width, exactly as the design's SVG `<pattern>` tiles it (`FestiveBand.dc.html`).
 *
 * Drawn in the design's own units (one SVG unit to one dp) and clipped to each
 * tile, as a pattern clips, so a bloom cut by one tile's edge is finished by
 * the next. Purely decorative: it adds no node for a screen reader.
 */
@Composable
fun FestiveBand(kit: FestiveKit, modifier: Modifier = Modifier) {
    val motif = kit.motif ?: return
    val ink = remember(kit.band) { BandInk(kit.band) }
    Spacer(
        modifier
            .fillMaxWidth()
            .height(FestiveBandHeight)
            .drawWithCache {
                val unit = density
                val tile = motif.tileWidth * unit
                onDrawBehind {
                    var x = 0f
                    while (x < size.width) {
                        withTransform({
                            translate(left = x)
                            clipRect(0f, 0f, tile, size.height)
                            scale(unit, unit, pivot = Offset.Zero)
                        }) {
                            drawTile(motif, kit.drop, ink)
                        }
                        x += tile
                    }
                }
            },
    )
}

/** The garland's colours, parsed once. A colour that does not read falls back to the brand's saffron. */
private class BandInk(band: BandColors) {
    val a = colour(band.a)
    val b = colour(band.b)
    val c = colour(band.c)
    val d = colour(band.d)
    val rope = colour(band.rope)
    val leaf = colour(band.leaf)
}

internal fun colour(hex: String, fallback: Color = Color(0xFFF59E0B)): Color = argbOf(hex)?.let { Color(it) } ?: fallback

/** One repeat of each motif, in SVG units. */
private val FestiveMotif.tileWidth: Float
    get() = when (this) {
        FestiveMotif.TORAN -> 96f
        FestiveMotif.LIGHTS -> 80f
        FestiveMotif.SPARKLE -> 72f
        FestiveMotif.KITES -> 110f
        FestiveMotif.BUNTING -> 72f
        FestiveMotif.LANTERNS -> 96f
        FestiveMotif.DRIP -> 120f
    }

private fun DrawScope.drawTile(motif: FestiveMotif, drop: FestiveDrop?, ink: BandInk) = when (motif) {
    FestiveMotif.TORAN -> toran(drop, ink)
    FestiveMotif.LIGHTS -> lights(ink)
    FestiveMotif.SPARKLE -> sparkle(ink)
    FestiveMotif.KITES -> kites(ink)
    FestiveMotif.BUNTING -> bunting(ink)
    FestiveMotif.LANTERNS -> lanterns(ink)
    FestiveMotif.DRIP -> drip(ink)
}

// ---------------------------------------------------------------------------
// The seven tiles, element for element and in the design's painting order.
// ---------------------------------------------------------------------------

/** A marigold garland dipping between two blooms, leaves at the ends, and something hanging from the middle. */
private fun DrawScope.toran(drop: FestiveDrop?, ink: BandInk) {
    stroke(Shapes.toranRope, ink.rope, 2f)
    tilted(-16f, 13f, 18f) { oval(ink.leaf, 13f, 18f, 3f, 8f) }
    tilted(16f, 83f, 18f) { oval(ink.leaf, 83f, 18f, 3f, 8f) }
    for ((x, y) in TORAN_BLOOMS) {
        dot(ink.a, x, y, 5.5f)
        dot(ink.b, x, y, 2.2f)
    }
    line(ink.rope, 48f, 21f, 48f, 29f, 1.2f)
    when (drop) {
        FestiveDrop.DIYA -> {
            dot(DIYA_FLAME, 48f, 34f, 7f, alpha = 0.25f)
            oval(DIYA_FLAME, 48f, 33.5f, 2.4f, 4.4f)
            fill(Shapes.diyaBowl, ink.c)
        }
        FestiveDrop.RAKHI -> {
            dot(ink.c, 48f, 36f, 6.5f)
            dot(ink.a, 48f, 29.8f, 2.4f)
            dot(ink.a, 54.2f, 36f, 2.4f)
            dot(ink.a, 48f, 42.2f, 2.4f)
            dot(ink.a, 41.8f, 36f, 2.4f)
            dot(ink.b, 48f, 36f, 2.6f)
        }
        FestiveDrop.FEATHER -> {
            oval(ink.leaf, 48f, 38f, 4.6f, 9f)
            oval(ink.c, 48f, 37f, 3f, 4.6f)
            dot(FEATHER_EYE, 48f, 37f, 1.7f)
        }
        FestiveDrop.LEAF -> {
            tilted(10f, 45f, 37f) { oval(ink.leaf, 45f, 37f, 3f, 8.5f) }
            tilted(-10f, 51f, 37f) { oval(ink.c, 51f, 37f, 3f, 8.5f) }
        }
        FestiveDrop.FLOWER -> {
            for ((x, y) in FLOWER_PETALS) dot(ink.c, x, y, 3f)
            dot(ink.a, 48f, 36.5f, 2.4f)
        }
        null -> Unit
    }
}

/** A string of bulbs, each with its glow and socket, and a few glints. */
private fun DrawScope.lights(ink: BandInk) {
    stroke(Shapes.lightsWire, ink.rope, 1.6f)
    for ((x, y, which) in LIGHT_BULBS) {
        val color = when (which) {
            0 -> ink.a
            1 -> ink.b
            else -> ink.c
        }
        dot(color, x, y, 9f, alpha = 0.22f)
        bar(BULB_SOCKET, x - 2f, y - 9f, 4f, 4f, 1f)
        oval(color, x, y, 4.2f, 6f)
    }
    dot(Color.White, 26f, 38f, 1.5f, alpha = 0.8f)
    dot(Color.White, 56f, 44f, 1.3f, alpha = 0.7f)
    dot(Color.White, 6f, 46f, 1.1f, alpha = 0.6f)
    dot(Color.White, 74f, 36f, 1.2f, alpha = 0.7f)
}

/** Two ribbons of streamer and the stars they leave. */
private fun DrawScope.sparkle(ink: BandInk) {
    stroke(Shapes.streamerHigh, ink.a, 2.5f)
    stroke(Shapes.streamerLow, ink.b, 1.5f, alpha = 0.85f)
    fill(Shapes.sparkleBig, ink.a)
    fill(Shapes.sparkleSmall, ink.c)
    dot(ink.b, 38f, 30f, 1.6f)
    dot(ink.a, 66f, 26f, 1.3f)
}

/** Two kites on a line, one with a ribboned tail. */
private fun DrawScope.kites(ink: BandInk) {
    stroke(Shapes.kiteLine, ink.rope, 1f)
    line(ink.rope, 28f, 7f, 28f, 12f, 1f)
    fill(Shapes.kiteOne, ink.a)
    stroke(Shapes.kiteOneSpars, SPAR, 1f)
    stroke(Shapes.kiteOneTail, ink.a, 1.4f)
    line(ink.rope, 82f, 7f, 82f, 17f, 1f)
    fill(Shapes.kiteTwo, ink.b)
    fill(Shapes.kiteTwoLower, ink.c)
    stroke(Shapes.kiteTwoTail, ink.d, 1.4f)
}

/** Pennants on a rope. */
private fun DrawScope.bunting(ink: BandInk) {
    stroke(Shapes.buntingRope, ink.rope, 1.2f)
    fill(Shapes.pennantOne, ink.a)
    fill(Shapes.pennantTwo, ink.b)
    stroke(Shapes.pennantTwo, PENNANT_EDGE, 0.6f)
    fill(Shapes.pennantThree, ink.c)
}

/** Lanterns and a crescent from a straight line, two stars below. */
private fun DrawScope.lanterns(ink: BandInk) {
    line(ink.rope, 0f, 2f, 96f, 2f, 1f)
    line(ink.rope, 20f, 2f, 20f, 14f, 1f)
    dot(ink.a, 20f, 26f, 13f, alpha = 0.18f)
    bar(ink.rope, 16f, 14f, 8f, 4f, 1f)
    fill(Shapes.lanternBig, ink.a)
    fill(Shapes.lanternBigWindow, ink.b, alpha = 0.92f)
    line(ink.rope, 58f, 2f, 58f, 11f, 1f)
    fill(Shapes.crescent, ink.a)
    line(ink.rope, 82f, 2f, 82f, 8f, 1f)
    bar(ink.rope, 79f, 8f, 6f, 3f, 1f)
    fill(Shapes.lanternSmall, ink.c)
    fill(Shapes.lanternSmallWindow, ink.b, alpha = 0.9f)
    fill(Shapes.lanternStarOne, ink.b)
    fill(Shapes.lanternStarTwo, ink.a)
}

/** Colour poured along the top edge and running down in drips. */
private fun DrawScope.drip(ink: BandInk) {
    val colors = listOf(ink.a, ink.b, ink.c, ink.d)
    for ((index, color) in colors.withIndex()) {
        bar(color, index * 30f, 0f, 30f, 9f)
    }
    for ((which, x, w, h) in DRIPS) {
        bar(colors[which], x, 4f, w, h, w / 2f)
    }
    dot(ink.c, 24f, 40f, 5f, alpha = 0.35f)
    dot(ink.a, 84f, 38f, 4f, alpha = 0.35f)
}

// ---------------------------------------------------------------------------
// Geometry the tiles share, parsed once from the design's own path data.
// ---------------------------------------------------------------------------

private val TORAN_BLOOMS = listOf(0f to 5f, 24f to 13.3f, 48f to 16f, 72f to 13.3f, 96f to 5f)
private val FLOWER_PETALS = listOf(48f to 31.5f, 52.8f to 35f, 51f to 40.5f, 45f to 40.5f, 43.2f to 35f)
private val LIGHT_BULBS = listOf(Triple(12f, 19f, 0), Triple(40f, 23f, 1), Triple(68f, 19f, 2))

/** Each drip: which pour it belongs to, then x, width and length. */
private data class Drip(val pour: Int, val x: Float, val width: Float, val length: Float)

private val DRIPS = listOf(
    Drip(0, 7f, 6f, 20f), Drip(0, 20f, 5f, 11f),
    Drip(1, 36f, 5f, 13f), Drip(1, 48f, 6f, 25f),
    Drip(2, 65f, 6f, 17f), Drip(2, 80f, 5f, 9f),
    Drip(3, 96f, 5f, 12f), Drip(3, 108f, 6f, 22f),
)

private val DIYA_FLAME = Color(0xFFFFD166)
private val FEATHER_EYE = Color(0xFF1E3A8A)
private val BULB_SOCKET = Color(0xFF374151)
private val SPAR = Color.Black.copy(alpha = 0.18f)
private val PENNANT_EDGE = Color.Black.copy(alpha = 0.1f)

private object Shapes {
    val toranRope by svg("M0 5 Q48 27 96 5")
    val diyaBowl by svg("M39.5 37.5 Q48 47 56.5 37.5 Z")
    val lightsWire by svg("M0 6 Q40 24 80 6")
    val streamerHigh by svg("M0 4 C 18 14, 30 -2, 48 8 S 66 14, 72 4")
    val streamerLow by svg("M0 12 C 20 22, 34 6, 52 16 S 68 20, 72 12")
    val sparkleBig by svg("M20 25 L21.7 30.3 L27 32 L21.7 33.7 L20 39 L18.3 33.7 L13 32 L18.3 30.3 Z")
    val sparkleSmall by svg("M54 34 L55 37 L58 38 L55 39 L54 42 L53 39 L50 38 L53 37 Z")
    val kiteLine by svg("M0 3 Q55 13 110 3")
    val kiteOne by svg("M28 12 L37 24 L28 38 L19 24 Z")
    val kiteOneSpars by svg("M28 12 V38 M19 24 H37")
    val kiteOneTail by svg("M28 38 q-3 4 0 7 q3 3 0 6")
    val kiteTwo by svg("M82 17 L90 28 L82 40 L74 28 Z")
    val kiteTwoLower by svg("M74 28 L90 28 L82 40 Z")
    val kiteTwoTail by svg("M82 40 q3 3 0 6")
    val buntingRope by svg("M0 3 Q36 11 72 3")
    val pennantOne by svg("M2 3.4 L22 5.6 L12 28 Z")
    val pennantTwo by svg("M26 6.3 L46 6.3 L36 30 Z")
    val pennantThree by svg("M50 5.6 L70 3.4 L60 28 Z")
    val lanternBig by svg("M14 18 L26 18 L28 25 L26 34 L14 34 L12 25 Z")
    val lanternBigWindow by svg("M16 21 L24 21 L25 25 L24 31 L16 31 L15 25 Z")
    val crescent by svg("M58 11 A10 10 0 1 0 58 31 A8 8 0 1 1 58 11 Z")
    val lanternSmall by svg("M77 11 L87 11 L88.5 17 L87 24 L77 24 L75.5 17 Z")
    val lanternSmallWindow by svg("M79 13.5 L85 13.5 L86 17 L85 21.5 L79 21.5 L78 17 Z")
    val lanternStarOne by svg("M40 36 L41 39 L44 40 L41 41 L40 44 L39 41 L36 40 L39 39 Z")
    val lanternStarTwo by svg("M70 40 L70.8 42.2 L73 43 L70.8 43.8 L70 46 L69.2 43.8 L67 43 L69.2 42.2 Z")
}

/** A path from SVG path data, built the first time a garland needs it. */
private fun svg(data: String): Lazy<Path> = lazy(LazyThreadSafetyMode.NONE) { PathParser().parsePathString(data).toPath() }

// Small drawing words, so each tile reads like the SVG it copies.

private fun DrawScope.stroke(path: Path, color: Color, width: Float, alpha: Float = 1f) =
    drawPath(path, color, alpha, Stroke(width))

private fun DrawScope.fill(path: Path, color: Color, alpha: Float = 1f) = drawPath(path, color, alpha)

private fun DrawScope.dot(color: Color, cx: Float, cy: Float, radius: Float, alpha: Float = 1f) =
    drawCircle(color, radius, Offset(cx, cy), alpha)

private fun DrawScope.oval(color: Color, cx: Float, cy: Float, rx: Float, ry: Float) =
    drawOval(color, Offset(cx - rx, cy - ry), Size(rx * 2f, ry * 2f))

private fun DrawScope.line(color: Color, x1: Float, y1: Float, x2: Float, y2: Float, width: Float) =
    drawLine(color, Offset(x1, y1), Offset(x2, y2), width)

private fun DrawScope.bar(color: Color, x: Float, y: Float, width: Float, height: Float, radius: Float = 0f) =
    drawRoundRect(color, Offset(x, y), Size(width, height), CornerRadius(radius))

private inline fun DrawScope.tilted(degrees: Float, cx: Float, cy: Float, block: DrawScope.() -> Unit) =
    rotate(degrees, Offset(cx, cy), block)
