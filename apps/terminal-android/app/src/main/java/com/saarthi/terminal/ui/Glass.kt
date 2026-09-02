package com.saarthi.terminal.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.haze
import dev.chrisbanes.haze.hazeChild

/**
 * Frosted glass, the way the web app does it.
 *
 * The dashboard's `.glass-panel` is `bg-white/55` over `backdrop-blur-2xl`, and
 * the blur is not a flourish — it is the entire effect. Translucency alone, with
 * a detailed basemap showing through unblurred, is mud: every road line and
 * label reads straight through the panel and competes with the text on it. That
 * is exactly what "the frost looks ugly, it is not offering any glass effect"
 * was describing, and no amount of tuning the alpha fixes it.
 *
 * So the backdrop is genuinely blurred, and the panel then carries the same
 * three layers the web pane does:
 *
 *   * a **tint** at the web's own opacity, which only works because what is
 *     behind it has been softened first;
 *   * a **specular highlight** along the top edge — the web draws this as a 1px
 *     white gradient in `::after`, and without it a blurred rectangle reads as a
 *     rendering fault rather than as a pane of glass;
 *   * a **hairline edge**, so the panel has a boundary against a busy map.
 *
 * Blur costs a render pass, and below Android 12 there is no cheap one at all.
 * [GlassPanel] falls back to a denser tint there — slightly more opaque, so it
 * stays legible without the blur that would have made a thin one work.
 */

/**
 * The backdrop every glass panel samples.
 *
 * Provided by [GlassBackdrop] and read by [GlassPanel], so a panel deep in a
 * screen does not need it threaded through six callers.
 */
val LocalHazeState = compositionLocalOf<HazeState?> { null }

/**
 * Marks its content as the thing behind the glass.
 *
 * Wrap whatever should show through — the map, the ambient gradient — and any
 * [GlassPanel] drawn afterwards will blur it.
 *
 * **The content must be Compose-rendered or a `TextureView`.** A `SurfaceView`
 * is composited by the system on a separate layer and cannot be sampled, which
 * is why the cockpit map asks MapLibre for texture mode.
 */
@Composable
fun GlassBackdrop(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val state = remember { HazeState() }
    CompositionLocalProvider(LocalHazeState provides state) {
        Box(modifier.haze(state)) { content() }
    }
}

/**
 * A pane of glass.
 *
 * Falls back to a solid card when there is no backdrop registered — a panel on
 * an ordinary screen has nothing to refract, and pretending otherwise just makes
 * it grey.
 */
@Composable
fun GlassPanel(
    modifier: Modifier = Modifier,
    contentPadding: Dp = Gutter,
    shape: Shape = RoundedCornerShape(Radius.xl),
    content: @Composable ColumnScope.() -> Unit,
) {
    val dark = LocalDarkCockpit.current
    val haze = LocalHazeState.current

    val tint = if (dark) Color(0xFF141B2E) else Color.White
    val edge = if (dark) Color.White.copy(alpha = 0.10f) else Color.White.copy(alpha = 0.55f)

    val blurred = haze != null && Modifier.canBlur()

    Surface(
        modifier = modifier,
        shape = shape,
        // Transparent: the fill is painted below, either through the blur or as
        // a denser tint standing in for it.
        color = Color.Transparent,
        border = BorderStroke(1.dp, if (blurred) edge else MaterialTheme.colorScheme.outline),
        shadowElevation = 8.dp,
    ) {
        Box(
            Modifier.then(
                if (haze != null) {
                    // Clipped first: haze takes its shape from the modifier
                    // chain, so an unclipped child blurs a rectangle behind
                    // rounded corners and leaves four bright wedges.
                    Modifier
                        .clip(shape)
                        .hazeChild(
                            state = haze,
                            style = HazeStyle(
                                backgroundColor = tint,
                                // The web's `bg-white/55`. Legible only because
                                // the backdrop behind it is blurred first.
                                tints = listOf(HazeTint(tint.copy(alpha = 0.55f))),
                                blurRadius = 28.dp,
                                // A trace of noise stops a large blurred area
                                // from banding into steps on an 8-bit panel.
                                noiseFactor = 0.06f,
                            ),
                        )
                } else {
                    // No backdrop to sample. A near-solid card, because a
                    // translucent one over nothing is just a paler card.
                    Modifier.background(tint.copy(alpha = 0.97f))
                },
            ),
        ) {
            /*
             * The specular highlight, matching the web's `::after` hairline.
             *
             * Drawn rather than laid out. As a child `Box` with `fillMaxWidth`
             * it did not just paint a line — it made every panel measure to the
             * full width available, so a registration badge meant to hug its own
             * text stretched the entire width of the screen. Painting it in the
             * draw phase leaves the panel free to size to its content.
             */
            val sheen = Color.White.copy(alpha = if (dark) 0.14f else 0.7f)
            Column(
                Modifier
                    .drawWithContent {
                        drawContent()
                        drawRect(
                            brush = Brush.horizontalGradient(
                                listOf(Color.Transparent, sheen, Color.Transparent),
                            ),
                            size = androidx.compose.ui.geometry.Size(size.width, 1.dp.toPx()),
                        )
                    }
                    .padding(contentPadding),
                content = content,
            )
        }
    }
}

/**
 * Whether this build can blur cheaply enough to be worth it.
 *
 * Haze needs `RenderEffect`, which arrived in Android 12. Below that it falls
 * back to a plain scrim of its own, so the panel is told to use its denser tint
 * instead and skip the pretence.
 */
private fun Modifier.canBlur(): Boolean =
    android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S
