package com.saarthi.core.festive

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** How tall the garland is. Screens that put it above their content leave this much room. */
val FestiveBandHeight: Dp = 52.dp

/**
 * The festival garland: one tile repeated across the full width.
 *
 * Drawn from the approved design's SVG pattern tiles (`FestiveBand.dc.html`),
 * one design unit to one dp, so the web's `<pattern>` and this canvas draw the
 * same shapes. Each tile is clipped to its own box, as an SVG pattern tile is,
 * so a bloom on the seam is drawn half by each neighbour.
 *
 * Static and decorative on purpose: nothing moves, and it adds no node for a
 * screen reader. The wish beside it is what carries the meaning.
 */
@Composable
fun FestiveBand(style: FestiveBandStyle, modifier: Modifier = Modifier) {
    val tile = remember(style.motif, style.drop) { tileFor(style.motif, style.drop) }
    val palette = remember(style) { BandPalette(style) }
    Canvas(modifier.fillMaxWidth().height(FestiveBandHeight)) {
        val unit = 1.dp.toPx()
        val tileWidth = tile.width * unit
        clipRect {
            var left = 0f
            while (left < size.width) {
                translate(left = left) {
                    clipRect(right = tileWidth, bottom = size.height) {
                        scale(unit, unit, pivot = Offset.Zero) {
                            tile.marks.forEach { mark -> mark.draw(this, palette) }
                        }
                    }
                }
                left += tileWidth
            }
        }
    }
}

/**
 * A full-screen page with the garland across its top, under the status bar.
 *
 * [content] receives the modifier its page must use: it fills the rest of the
 * screen and no longer pads for the status bar, which the garland has already
 * cleared. With no [band] the page is passed through untouched.
 */
@Composable
fun FestiveBandFrame(
    band: FestiveBandStyle?,
    background: Color,
    content: @Composable (Modifier) -> Unit,
) {
    if (band == null) {
        content(Modifier)
        return
    }
    Column(Modifier.fillMaxSize().background(background)) {
        FestiveBand(band, Modifier.windowInsetsPadding(WindowInsets.statusBars))
        content(Modifier.weight(1f).consumeWindowInsets(WindowInsets.statusBars))
    }
}

/** The design's tile for a motif (and, for a toran, its drop). */
private fun tileFor(motif: FestiveMotif, drop: FestiveDrop?): Tile = when (motif) {
    FestiveMotif.TORAN -> Tiles.toran(drop)
    FestiveMotif.LIGHTS -> Tiles.lights
    FestiveMotif.SPARKLE -> Tiles.sparkle
    FestiveMotif.KITES -> Tiles.kites
    FestiveMotif.BUNTING -> Tiles.bunting
    FestiveMotif.LANTERNS -> Tiles.lanterns
    FestiveMotif.DRIP -> Tiles.drip
}

/** Where a shape takes its colour from: one of the kit's roles, or a colour the design fixes. */
private fun interface Ink {
    fun color(palette: BandPalette): Color
}

private class BandPalette(style: FestiveBandStyle) {
    val a = Color(style.a)
    val b = Color(style.b)
    val c = Color(style.c)
    val d = Color(style.d)
    val rope = Color(style.rope)
    val leaf = Color(style.leaf)
}

private fun fixed(color: Color) = Ink { color }

private val A = Ink { it.a }
private val B = Ink { it.b }
private val C = Ink { it.c }
private val D = Ink { it.d }
private val ROPE = Ink { it.rope }
private val LEAF = Ink { it.leaf }
private val FLAME = fixed(Color(0xFFFFD166))
private val SOCKET = fixed(Color(0xFF374151))
private val TWINKLE = fixed(Color.White)
private val PEACOCK_EYE = fixed(Color(0xFF1E3A8A))
private val CREASE = fixed(Color.Black.copy(alpha = 0.18f))
private val HEM = fixed(Color.Black.copy(alpha = 0.1f))

/** One shape in a tile, in design units. */
private sealed interface Mark {
    fun draw(scope: DrawScope, palette: BandPalette)
}

private class Circle(val cx: Float, val cy: Float, val r: Float, val ink: Ink, val alpha: Float = 1f) : Mark {
    override fun draw(scope: DrawScope, palette: BandPalette) {
        scope.drawCircle(ink.color(palette), radius = r, center = Offset(cx, cy), alpha = alpha)
    }
}

private class Ellipse(
    val cx: Float,
    val cy: Float,
    val rx: Float,
    val ry: Float,
    val ink: Ink,
    val degrees: Float = 0f,
) : Mark {
    override fun draw(scope: DrawScope, palette: BandPalette) {
        scope.rotate(degrees, pivot = Offset(cx, cy)) {
            drawOval(ink.color(palette), topLeft = Offset(cx - rx, cy - ry), size = Size(rx * 2, ry * 2))
        }
    }
}

/** A rectangle, its corners rounded by [radius] as an SVG `rx` rounds them. */
private class Block(
    val x: Float,
    val y: Float,
    val w: Float,
    val h: Float,
    val ink: Ink,
    val radius: Float = 0f,
) : Mark {
    override fun draw(scope: DrawScope, palette: BandPalette) {
        scope.drawRoundRect(ink.color(palette), Offset(x, y), Size(w, h), CornerRadius(radius))
    }
}

/** An SVG path, filled, stroked, or both, exactly as the tile's `style` says. */
private class Shape(
    d: String,
    val fill: Ink? = null,
    val stroke: Ink? = null,
    val strokeWidth: Float = 1f,
    val alpha: Float = 1f,
) : Mark {
    private val path: Path = PathParser().parsePathString(d).toPath()

    override fun draw(scope: DrawScope, palette: BandPalette) {
        fill?.let { scope.drawPath(path, it.color(palette), alpha = alpha) }
        stroke?.let { scope.drawPath(path, it.color(palette), alpha = alpha, style = Stroke(width = strokeWidth)) }
    }
}

private class Tile(val width: Float, val marks: List<Mark>)

/** The design's tiles, one per motif. Built lazily, so only the festival on show is parsed. */
private object Tiles {

    private val toranBody: List<Mark> by lazy {
        listOf(
            Shape("M0 5 Q48 27 96 5", stroke = ROPE, strokeWidth = 2f),
            Ellipse(13f, 18f, 3f, 8f, LEAF, degrees = -16f),
            Ellipse(83f, 18f, 3f, 8f, LEAF, degrees = 16f),
        ) + listOf(0f to 5f, 24f to 13.3f, 48f to 16f, 72f to 13.3f, 96f to 5f).flatMap { (x, y) ->
            listOf(Circle(x, y, 5.5f, A), Circle(x, y, 2.2f, B))
        } + Shape("M48 21 V29", stroke = ROPE, strokeWidth = 1.2f)
    }

    private val drops: Map<FestiveDrop, List<Mark>> by lazy {
        mapOf(
            FestiveDrop.DIYA to listOf(
                Circle(48f, 34f, 7f, FLAME, alpha = 0.25f),
                Ellipse(48f, 33.5f, 2.4f, 4.4f, FLAME),
                Shape("M39.5 37.5 Q48 47 56.5 37.5 Z", fill = C),
            ),
            FestiveDrop.RAKHI to listOf(
                Circle(48f, 36f, 6.5f, C),
                Circle(48f, 29.8f, 2.4f, A),
                Circle(54.2f, 36f, 2.4f, A),
                Circle(48f, 42.2f, 2.4f, A),
                Circle(41.8f, 36f, 2.4f, A),
                Circle(48f, 36f, 2.6f, B),
            ),
            FestiveDrop.FEATHER to listOf(
                Ellipse(48f, 38f, 4.6f, 9f, LEAF),
                Ellipse(48f, 37f, 3f, 4.6f, C),
                Circle(48f, 37f, 1.7f, PEACOCK_EYE),
            ),
            FestiveDrop.LEAF to listOf(
                Ellipse(45f, 37f, 3f, 8.5f, LEAF, degrees = 10f),
                Ellipse(51f, 37f, 3f, 8.5f, C, degrees = -10f),
            ),
            FestiveDrop.FLOWER to listOf(
                Circle(48f, 31.5f, 3f, C),
                Circle(52.8f, 35f, 3f, C),
                Circle(51f, 40.5f, 3f, C),
                Circle(45f, 40.5f, 3f, C),
                Circle(43.2f, 35f, 3f, C),
                Circle(48f, 36.5f, 2.4f, A),
            ),
        )
    }

    /** A marigold toran, with [drop] hanging from its middle string (none when null). */
    fun toran(drop: FestiveDrop?): Tile = Tile(96f, toranBody + drop?.let { drops.getValue(it) }.orEmpty())

    val lights: Tile by lazy {
        val bulbs = listOf(Triple(12f, 19f, A), Triple(40f, 23f, B), Triple(68f, 19f, C)).flatMap { (x, y, ink) ->
            listOf(
                Circle(x, y, 9f, ink, alpha = 0.22f),
                Block(x - 2f, y - 9f, 4f, 4f, SOCKET, radius = 1f),
                Ellipse(x, y, 4.2f, 6f, ink),
            )
        }
        Tile(
            80f,
            listOf(Shape("M0 6 Q40 24 80 6", stroke = ROPE, strokeWidth = 1.6f)) + bulbs + listOf(
                Circle(26f, 38f, 1.5f, TWINKLE, alpha = 0.8f),
                Circle(56f, 44f, 1.3f, TWINKLE, alpha = 0.7f),
                Circle(6f, 46f, 1.1f, TWINKLE, alpha = 0.6f),
                Circle(74f, 36f, 1.2f, TWINKLE, alpha = 0.7f),
            ),
        )
    }

    val sparkle: Tile by lazy {
        Tile(
            72f,
            listOf(
                Shape("M0 4 C 18 14, 30 -2, 48 8 S 66 14, 72 4", stroke = A, strokeWidth = 2.5f),
                Shape("M0 12 C 20 22, 34 6, 52 16 S 68 20, 72 12", stroke = B, strokeWidth = 1.5f, alpha = 0.85f),
                Shape("M20 25 L21.7 30.3 L27 32 L21.7 33.7 L20 39 L18.3 33.7 L13 32 L18.3 30.3 Z", fill = A),
                Shape("M54 34 L55 37 L58 38 L55 39 L54 42 L53 39 L50 38 L53 37 Z", fill = C),
                Circle(38f, 30f, 1.6f, B),
                Circle(66f, 26f, 1.3f, A),
            ),
        )
    }

    val kites: Tile by lazy {
        Tile(
            110f,
            listOf(
                Shape("M0 3 Q55 13 110 3", stroke = ROPE, strokeWidth = 1f),
                Shape("M28 7 V12", stroke = ROPE, strokeWidth = 1f),
                Shape("M28 12 L37 24 L28 38 L19 24 Z", fill = A),
                Shape("M28 12 V38 M19 24 H37", stroke = CREASE, strokeWidth = 1f),
                Shape("M28 38 q-3 4 0 7 q3 3 0 6", stroke = A, strokeWidth = 1.4f),
                Shape("M82 7 V17", stroke = ROPE, strokeWidth = 1f),
                Shape("M82 17 L90 28 L82 40 L74 28 Z", fill = B),
                Shape("M74 28 L90 28 L82 40 Z", fill = C),
                Shape("M82 40 q3 3 0 6", stroke = D, strokeWidth = 1.4f),
            ),
        )
    }

    val bunting: Tile by lazy {
        Tile(
            72f,
            listOf(
                Shape("M0 3 Q36 11 72 3", stroke = ROPE, strokeWidth = 1.2f),
                Shape("M2 3.4 L22 5.6 L12 28 Z", fill = A),
                Shape("M26 6.3 L46 6.3 L36 30 Z", fill = B, stroke = HEM, strokeWidth = 0.6f),
                Shape("M50 5.6 L70 3.4 L60 28 Z", fill = C),
            ),
        )
    }

    val lanterns: Tile by lazy {
        Tile(
            96f,
            listOf(
                Shape("M0 2 H96", stroke = ROPE, strokeWidth = 1f),
                Shape("M20 2 V14", stroke = ROPE, strokeWidth = 1f),
                Circle(20f, 26f, 13f, A, alpha = 0.18f),
                Block(16f, 14f, 8f, 4f, ROPE, radius = 1f),
                Shape("M14 18 L26 18 L28 25 L26 34 L14 34 L12 25 Z", fill = A),
                Shape("M16 21 L24 21 L25 25 L24 31 L16 31 L15 25 Z", fill = B, alpha = 0.92f),
                Shape("M58 2 V11", stroke = ROPE, strokeWidth = 1f),
                Shape("M58 11 A10 10 0 1 0 58 31 A8 8 0 1 1 58 11 Z", fill = A),
                Shape("M82 2 V8", stroke = ROPE, strokeWidth = 1f),
                Block(79f, 8f, 6f, 3f, ROPE, radius = 1f),
                Shape("M77 11 L87 11 L88.5 17 L87 24 L77 24 L75.5 17 Z", fill = C),
                Shape("M79 13.5 L85 13.5 L86 17 L85 21.5 L79 21.5 L78 17 Z", fill = B, alpha = 0.9f),
                Shape("M40 36 L41 39 L44 40 L41 41 L40 44 L39 41 L36 40 L39 39 Z", fill = B),
                Shape("M70 40 L70.8 42.2 L73 43 L70.8 43.8 L70 46 L69.2 43.8 L67 43 L69.2 42.2 Z", fill = A),
            ),
        )
    }

    val drip: Tile by lazy {
        // Four bands of colour, each with two drips running down from it.
        val bands = listOf(
            Triple(0f, A, listOf(Drip(7f, 6f, 20f), Drip(20f, 5f, 11f))),
            Triple(30f, B, listOf(Drip(36f, 5f, 13f), Drip(48f, 6f, 25f))),
            Triple(60f, C, listOf(Drip(65f, 6f, 17f), Drip(80f, 5f, 9f))),
            Triple(90f, D, listOf(Drip(96f, 5f, 12f), Drip(108f, 6f, 22f))),
        ).flatMap { (x, ink, drips) ->
            listOf(Block(x, 0f, 30f, 9f, ink)) + drips.map { Block(it.x, 4f, it.width, it.length, ink, radius = it.width / 2f) }
        }
        Tile(
            120f,
            bands + listOf(
                Circle(24f, 40f, 5f, C, alpha = 0.35f),
                Circle(84f, 38f, 4f, A, alpha = 0.35f),
            ),
        )
    }

    private class Drip(val x: Float, val width: Float, val length: Float)
}
