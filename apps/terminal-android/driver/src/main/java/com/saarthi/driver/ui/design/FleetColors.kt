package com.saarthi.driver.ui.design

import android.graphics.ComposeShader
import android.graphics.Matrix
import android.graphics.PorterDuff
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.LinearGradientShader
import androidx.compose.ui.graphics.RadialGradientShader
import androidx.compose.ui.graphics.Shader
import androidx.compose.ui.graphics.ShaderBrush
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/**
 * The driver app's palette, in the website's vocabulary.
 *
 * Every slot mirrors a token in `apps/web/src/styles/globals.css`, converted
 * from its HSL triplet exactly, so a driver who has seen the web app on a
 * fleet office screen recognises the phone as the same product. Screens never
 * name a hex value: they ask for a role — `foreground`, `primary`,
 * `success` — and the theme answers for light or dark.
 *
 * Read through [Fleet.colors]. Code inside a `Canvas` or a `remember` block
 * cannot read a composition local, so it captures the colours it needs into a
 * local first.
 */
@Immutable
data class FleetColors(
    val isDark: Boolean,

    /** The page. `--canvas`. */
    val canvas: Color,
    /** A panel on the page. `--card`. */
    val card: Color,
    /** A control on a panel: a field, a floating button. `--elevated`. */
    val elevated: Color,
    /** An inset well: a track, a resting chip. `--muted`. */
    val sunken: Color,

    /** Body and heading text. `--foreground`. */
    val foreground: Color,
    /** Secondary text. `--muted-foreground`. */
    val mutedForeground: Color,
    /** Tertiary text: units, placeholders, footnotes. */
    val subtle: Color,

    /** A divider inside a panel. `--border`. */
    val border: Color,
    /** An outline that must be seen: a switch track, a hover ring. `--border-strong`. */
    val borderStrong: Color,
    /** A field's resting edge. `--input`. */
    val input: Color,
    /** The focus ring. `--ring`. */
    val ring: Color,
    /** The hairline that bounds a panel instead of a border. */
    val cardRing: Color,
    /** The tint of a panel's shadow. */
    val shadow: Color,

    /** The one action colour. `--primary`. */
    val primary: Color,
    val onPrimary: Color,
    /** A selected chip, an icon well. `--primary-soft`. */
    val primarySoft: Color,

    /** Saffron, for emphasis only. `--accent`. */
    val accent: Color,
    val onAccent: Color,
    val accentSoft: Color,

    val success: Color,
    val onSuccess: Color,
    val successSoft: Color,
    val warning: Color,
    val onWarning: Color,
    val warningSoft: Color,
    val destructive: Color,
    val onDestructive: Color,
    val destructiveSoft: Color,
    val info: Color,
    val infoSoft: Color,

    /**
     * The logo's navy, as it can be drawn on this ground.
     *
     * The artwork's own navy on the light theme; on the dark one it lifts to the
     * pale blue the web's splash uses, because #011C45 on a near-black page is
     * a hole rather than a line.
     */
    val brandNavyInk: Color,
)

/** `:root` in globals.css. */
val LightFleetColors = FleetColors(
    isDark = false,
    canvas = Color(0xFFEFEFF1),
    card = Color(0xFFFFFFFF),
    elevated = Color(0xFFFFFFFF),
    sunken = Color(0xFFF4F4F5),
    foreground = Color(0xFF18181B),
    mutedForeground = Color(0xFF71717A),
    subtle = Color(0xFF85858E),
    border = Color(0xFFE4E4E7),
    borderStrong = Color(0xFFCFCFD3),
    input = Color(0xFFE1E1E5),
    ring = Color(0xFF4552C4),
    cardRing = Color(0x0D18181B),
    shadow = Color(0xFF18181B),
    primary = Color(0xFF3B47BA),
    onPrimary = Color(0xFFFFFFFF),
    primarySoft = Color(0xFFE5E7F5),
    accent = Color(0xFFF38516),
    onAccent = Color(0xFF381B05),
    accentSoft = Color(0xFFFEF2E7),
    success = Color(0xFF2A845A),
    onSuccess = Color(0xFFF7FDFA),
    successSoft = Color(0xFFE9F7F0),
    warning = Color(0xFFD3770D),
    onWarning = Color(0xFF3A1F03),
    warningSoft = Color(0xFFFDF3E2),
    destructive = Color(0xFFD6292F),
    onDestructive = Color(0xFFFFFFFF),
    destructiveSoft = Color(0xFFFDEDEE),
    info = Color(0xFF197CC8),
    infoSoft = Color(0xFFE8F4FC),
    brandNavyInk = BrandNavy,
)

/** `.dark` in globals.css. */
val DarkFleetColors = FleetColors(
    isDark = true,
    canvas = Color(0xFF0E0E10),
    card = Color(0xFF161618),
    elevated = Color(0xFF1D1D20),
    sunken = Color(0xFF222225),
    foreground = Color(0xFFF4F4F5),
    mutedForeground = Color(0xFF9F9FA8),
    subtle = Color(0xFF7E7E8B),
    border = Color(0xFF29292E),
    borderStrong = Color(0xFF3F3F46),
    input = Color(0xFF2E2E33),
    ring = Color(0xFF727FF3),
    cardRing = Color(0x0FFFFFFF),
    shadow = Color(0xFF000000),
    primary = Color(0xFF727FF3),
    onPrimary = Color(0xFF0F0F24),
    primarySoft = Color(0xFF232748),
    accent = Color(0xFFF49434),
    onAccent = Color(0xFF2F1704),
    accentSoft = Color(0xFF3F2D1C),
    success = Color(0xFF3DAE79),
    onSuccess = Color(0xFF071D12),
    successSoft = Color(0xFF1D392C),
    warning = Color(0xFFF2952C),
    onWarning = Color(0xFF2C1702),
    warningSoft = Color(0xFF40301C),
    destructive = Color(0xFFDF494E),
    onDestructive = Color(0xFFFFFFFF),
    destructiveSoft = Color(0xFF421F20),
    info = Color(0xFF379AE6),
    infoSoft = Color(0xFF1C3040),
    brandNavyInk = Color(0xFF9DB7E6),
)

// --- Brand ----------------------------------------------------------------
//
// The logo's own inks. Fixed in both themes, because the artwork is fixed:
// `primary` is a desaturated indigo chosen to sit quietly behind operational
// data, and the logo is not that colour.

/** The V and the road. */
val BrandNavy = Color(0xFF011C45)

/** The pin and the X's upper stroke. */
val BrandSaffron = Color(0xFFFE5D09)

/** The X's lower stroke. */
val BrandGreen = Color(0xFF02783F)

/**
 * The ground of a photograph: `hsl(240 6% 7%)`, the website's STAGE ink.
 *
 * A photo panel is a dark stage in both themes, and its text-protection
 * gradients are written against this colour so they dissolve into it.
 */
val StageInk = Color(0xFF111113)

/**
 * The logo's colours arranged for a control — `bg-brand-gradient` on the web.
 *
 * Not the sweep as stripes. The body is the V's deep navy, and the X's green
 * and saffron arrive as light off the right edge, where the X sits in the mark.
 * White type stays on navy. Three CSS layers, composed into one shader so the
 * result is an ordinary [Brush] any `background` accepts:
 *
 * ```
 * radial-gradient(38% 110% at 100% 100%, saffron .85 0%, .35 35%, 0 100%),
 * radial-gradient(30% 90% at 100% 0%,   green  .75 0%,  0 100%),
 * linear-gradient(100deg, #021d40 0%, #022a59 55%, #07346f 100%)
 * ```
 */
val BrandGradient: Brush = object : ShaderBrush() {
    override fun createShader(size: Size): Shader {
        val w = size.width
        val h = size.height

        val (from, to) = cssLinearEnds(100f, size)
        val base = LinearGradientShader(
            from = from,
            to = to,
            colors = listOf(Color(0xFF021D40), Color(0xFF022A59), Color(0xFF07346F)),
            colorStops = listOf(0f, 0.55f, 1f),
        )
        val green = ellipse(
            center = Offset(w, 0f),
            radiusX = w * 0.30f,
            radiusY = h * 0.90f,
            colors = listOf(Color(0xBF028C48), Color(0x0002783F)),
            stops = listOf(0f, 1f),
        )
        val saffron = ellipse(
            center = Offset(w, h),
            radiusX = w * 0.38f,
            radiusY = h * 1.10f,
            colors = listOf(Color(0xD9FE5D09), Color(0x59FE5D09), Color(0x00FE5D09)),
            stops = listOf(0f, 0.35f, 1f),
        )
        return ComposeShader(
            ComposeShader(base, green, PorterDuff.Mode.SRC_OVER),
            saffron,
            PorterDuff.Mode.SRC_OVER,
        )
    }
}

/**
 * The logo's sweep for type — `.brand-logo-gradient` — lifted in the dark theme
 * because navy at 12% lightness disappears into a near-black page.
 */
fun brandInkGradient(dark: Boolean): Brush = Brush.horizontalGradient(
    if (dark) {
        listOf(Color(0xFF5B8AE0), Color(0xFF86ABF2), Color(0xFFFF7A2E), Color(0xFFFFA95E))
    } else {
        listOf(Color(0xFF062A66), Color(0xFF2360BE), Color(0xFFE8590F), Color(0xFFFF8C2E))
    },
)

/**
 * Where a CSS `linear-gradient(<angle>deg, …)` starts and ends in a box.
 *
 * CSS measures the angle clockwise from "to top" and sizes the gradient line so
 * its ends touch the box's far corners; Compose wants the two points.
 */
private fun cssLinearEnds(degrees: Float, size: Size): Pair<Offset, Offset> {
    val radians = Math.toRadians(degrees.toDouble())
    val dx = sin(radians).toFloat()
    val dy = -cos(radians).toFloat()
    val half = (abs(size.width * dx) + abs(size.height * dy)) / 2f
    val center = Offset(size.width / 2f, size.height / 2f)
    return (center - Offset(dx, dy) * half) to (center + Offset(dx, dy) * half)
}

/** An elliptical radial gradient, which Compose only offers as a circle. */
private fun ellipse(
    center: Offset,
    radiusX: Float,
    radiusY: Float,
    colors: List<Color>,
    stops: List<Float>,
): Shader = RadialGradientShader(
    center = center,
    radius = radiusX.coerceAtLeast(1f),
    colors = colors,
    colorStops = stops,
).apply {
    setLocalMatrix(
        Matrix().apply { setScale(1f, radiusY / radiusX.coerceAtLeast(1f), center.x, center.y) },
    )
}

/** Which palette is in force. Provided by [FleetTheme]. */
val LocalFleetColors = staticCompositionLocalOf { LightFleetColors }

/** The driver app's theme values, read the way `MaterialTheme` is read. */
object Fleet {
    val colors: FleetColors
        @Composable
        @ReadOnlyComposable
        get() = LocalFleetColors.current
}
