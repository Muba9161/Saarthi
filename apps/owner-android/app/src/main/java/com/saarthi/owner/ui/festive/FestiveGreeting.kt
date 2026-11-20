package com.saarthi.owner.ui.festive

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.festive.FestiveFx
import com.saarthi.owner.festive.FestiveGlow
import com.saarthi.owner.festive.FestiveKit
import com.saarthi.owner.festive.greetingLine
import com.saarthi.owner.festive.greetingName
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi

/**
 * The festival's greeting card on a home screen: the wish addressed to the
 * person by first name, who it is from, and a button that hides it until
 * tomorrow. Nothing at all on an ordinary day, with festive looks off, or once
 * hidden today.
 *
 * Always the design's dark surface with the festival's two glows, whatever the
 * appearance setting: it is one card at the edge of the screen, not a
 * recolouring of the screen's own controls.
 */
@Composable
fun FestiveGreeting(app: OwnerApp, modifier: Modifier = Modifier) {
    val look by app.festive.look.collectAsStateWithLifecycle()
    val account by app.session.account.collectAsStateWithLifecycle()
    val shown = look?.takeUnless { it.greetingHidden } ?: return
    val name = account?.let { greetingName(it.firstName, it.fullName) }
    GreetingCard(
        line = greetingLine(shown.festival.wish, name, shown.locale),
        signature = shown.signature,
        kit = shown.kit,
        onHide = app.festive::hideGreetingToday,
        modifier = modifier,
    )
}

@Composable
private fun GreetingCard(line: String, signature: String, kit: FestiveKit, onHide: () -> Unit, modifier: Modifier) {
    val reduced = Saarthi.reducedMotion
    var leaving by remember { mutableStateOf(false) }
    val presence by animateFloatAsState(
        targetValue = if (leaving) 0f else 1f,
        animationSpec = tween(LEAVE_MS),
        label = "festive-greeting",
        finishedListener = { if (leaving) onHide() },
    )
    val glows = remember(kit.glow) { kit.glow.map { it.toColor() } }
    val wish = remember(kit.wishOnDark) { colour(kit.wishOnDark, fallback = Color.White) }

    Box(
        modifier
            .fillMaxWidth()
            .graphicsLayer { alpha = presence }
            .clip(RoundedCornerShape(20.dp))
            .background(SURFACE)
            .drawBehind {
                // The design's two washes: `80% 140% at 0% 100%` and `70% 140% at 100% 0%`.
                glows.getOrNull(0)?.let { wash(it, Offset(0f, size.height), size.width * 0.8f, size.height * 1.4f) }
                glows.getOrNull(1)?.let { wash(it, Offset(size.width, 0f), size.width * 0.7f, size.height * 1.4f) }
            },
    ) {
        val fx = kit.fx
        if (!reduced && fx != null && kit.fxColors.isNotEmpty()) {
            FallingPieces(fx, kit.fxColors, Modifier.matchParentSize())
        }
        Row(
            Modifier
                .fillMaxWidth()
                .padding(18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(line, style = SType.sheetTitle.copy(lineHeight = 26.sp), color = wish)
                Text(
                    signature,
                    style = SType.caption.copy(fontSize = 12.5.sp),
                    color = Color.White.copy(alpha = 0.78f),
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            CircleButton(
                Lucide.close,
                stringResource(R.string.ui_festive_hide_greeting),
                onClick = { if (reduced) onHide() else leaving = true },
                size = 44.dp,
                iconSize = 16.dp,
                background = Color.White.copy(alpha = 0.08f),
                ink = Color.White,
                elevated = false,
                stroke = 2f,
                shape = RoundedCornerShape(12.dp),
            )
        }
    }
}

/** A soft elliptical wash of [color] centred on [centre], fading out at 70% of its radii. */
private fun DrawScope.wash(color: Color, centre: Offset, rx: Float, ry: Float) {
    if (rx <= 0f || ry <= 0f) return
    scale(scaleX = 1f, scaleY = ry / rx, pivot = centre) {
        drawCircle(
            Brush.radialGradient(0f to color, 0.7f to color.copy(alpha = 0f), center = centre, radius = rx),
            radius = rx,
            center = centre,
        )
    }
}

private fun FestiveGlow.toColor(): Color = colour(color, fallback = Color.Transparent).copy(alpha = alpha.coerceIn(0f, 1f))

/**
 * The festival's pieces drifting through the card, and only the card: petals,
 * snow, confetti, stars or kites falling, embers rising. The caller leaves
 * them out entirely under reduced motion.
 *
 * The clock is read while drawing, never while composing, so a frame redraws
 * the pieces without recomposing anything.
 */
@Composable
private fun FallingPieces(fx: FestiveFx, colors: List<String>, modifier: Modifier) {
    val inks = remember(colors) { colors.map { colour(it, fallback = Color.White) } }
    var seconds by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) {
        val start = withFrameNanos { it }
        while (true) withFrameNanos { now -> seconds = (now - start) / 1_000_000_000f }
    }
    Canvas(modifier) {
        val t = seconds
        val unit = density
        for (index in 0 until PIECES) {
            val duration = 4.5f + (index % 4) * 0.8f
            val lead = (index * 0.8f) % 5f
            val progress = ((t + lead) / duration) % 1f
            val rising = fx == FestiveFx.EMBERS
            val x = size.width * (((index * 37 + 9) % 100) / 100f) + DRIFT_DP * unit * progress
            val travel = FALL_DP * unit
            val y = if (rising) size.height + 10f * unit - travel * progress else -10f * unit + travel * progress
            val alpha = if (rising) PIECE_ALPHA * (1f - progress) else PIECE_ALPHA
            translate(x, y) {
                rotate(SPIN_DEGREES * progress, pivot = Offset.Zero) {
                    piece(fx, inks[index % inks.size], alpha, unit)
                }
            }
        }
    }
}

/** One piece, centred on the origin, sized in dp as the design's 6 × 5 px pieces. */
private fun DrawScope.piece(fx: FestiveFx, color: Color, alpha: Float, unit: Float) {
    when (fx) {
        FestiveFx.PETALS -> scale(unit, unit, pivot = Offset.Zero) { translate(-3f, -2.5f) { drawPath(PETAL, color, alpha) } }
        FestiveFx.SNOW -> drawCircle(color, 2.2f * unit, Offset.Zero, alpha)
        FestiveFx.CONFETTI -> drawRect(color, Offset(-3f * unit, -1.5f * unit), Size(6f * unit, 3f * unit), alpha)
        FestiveFx.STARS -> scale(unit, unit, pivot = Offset.Zero) { drawPath(STAR, color, alpha) }
        FestiveFx.KITES -> scale(unit, unit, pivot = Offset.Zero) { drawPath(KITE, color, alpha) }
        FestiveFx.EMBERS -> drawCircle(color, 1.8f * unit, Offset.Zero, alpha)
    }
}

/** `border-radius: 60% 0` on a 6 × 5 box: rounded at top left and bottom right, pointed at the other two. */
private val PETAL = Path().apply {
    moveTo(0f, 5f)
    quadraticTo(0f, 0f, 6f, 0f)
    quadraticTo(6f, 5f, 0f, 5f)
    close()
}

/** A small four-pointed star, about 8 dp across. */
private val STAR = Path().apply {
    moveTo(0f, -4f)
    lineTo(1f, -1f)
    lineTo(4f, 0f)
    lineTo(1f, 1f)
    lineTo(0f, 4f)
    lineTo(-1f, 1f)
    lineTo(-4f, 0f)
    lineTo(-1f, -1f)
    close()
}

/** A small diamond kite, 6 × 8 dp. */
private val KITE = Path().apply {
    moveTo(0f, -4f)
    lineTo(3f, 0f)
    lineTo(0f, 4f)
    lineTo(-3f, 0f)
    close()
}

/** The card's ground, as the design paints it in light and dark alike. */
private val SURFACE = Color(0xFF121215)

private const val PIECES = 12
private const val PIECE_ALPHA = 0.85f
private const val FALL_DP = 150f
private const val DRIFT_DP = 8f
private const val SPIN_DEGREES = 240f
private const val LEAVE_MS = 220
