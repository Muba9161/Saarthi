package com.saarthi.terminal.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Saarthi Terminal's visual language.
 *
 * Every colour here is a direct conversion of a token in the web app's
 * `apps/web/src/styles/globals.css`, computed from the same HSL triples rather
 * than matched by eye. That matters more than it sounds: a fleet owner on the
 * dashboard and a driver in the cab are looking at one product, and the two had
 * drifted into different blues, different greys and — worst — different ideas of
 * how far apart two surfaces should sit.
 *
 * Two things differ from the web, and both are about where this screen lives.
 *
 * **Light is the default, and dark is a switch.** It used to follow the system,
 * which turned a phone left in dark mode into a near-black cockpit in daylight.
 * The night argument is real — a white screen at 3 a.m. costs a driver their
 * night vision for the next minute — but it is the driver's call, so it lives in
 * Terminal settings rather than being inferred from the tablet.
 *
 * **Type is larger and contrast higher than a desktop app would use.** The
 * reader is at arm's length, sometimes in direct sun, sometimes moving.
 */

// --- Palette ---------------------------------------------------------------
//
// Named for the web token each one comes from, so a change there can be tracked
// here. The trailing comment is the HSL it was converted from.

private val Canvas = Color(0xFFF4F7FA)          // --canvas          214 40% 97%
private val Ink = Color(0xFF0F1729)             // --foreground      222 47% 11%
private val CardWhite = Color(0xFFFFFFFF)       // --card              0  0% 100%
private val Primary = Color(0xFF2B40B6)         // --primary         231 62% 44%
private val PrimaryMuted = Color(0xFFEEF0FB)    // --primary-muted   231 62% 96%
private val Accent = Color(0xFFF89012)          // --accent           33 94% 52%
private val Muted = Color(0xFFEFF2F6)           // --muted           214 28% 95%
private val MutedInk = Color(0xFF5E6F87)        // --muted-foreground 215 18% 45%
private val BorderLine = Color(0xFFDCE2EA)      // --border          215 24% 89%
private val BorderStrong = Color(0xFFC8D0DA)    // --border-strong   215 20% 82%

/** Semantic colours, also from the web tokens. State, never decoration. */
val SaarthiSuccess = Color(0xFF1D8660)          // --success         158 64% 32%
val SaarthiWarning = Color(0xFFDA7707)          // --warning          32 94% 44%
val SaarthiDanger = Color(0xFFC0392B)           // --danger
val SaarthiInfo = Color(0xFF107AC6)             // --info            205 85% 42%

// The dark ramp, from the web's `.dark` block. Deep indigo rather than grey, so
// the accents sit on it the way they do on the dashboard at night.
private val NightCanvas = Color(0xFF0B1020)
private val NightSurface = Color(0xFF141B2E)
private val NightElevated = Color(0xFF1C2540)
private val NightBorder = Color(0xFF2A3350)
private val Paper = Color(0xFFEEF2F9)
private val NightPrimary = Color(0xFF7A93FA)

private val LightColors = lightColorScheme(
    primary = Primary,
    onPrimary = Color.White,
    primaryContainer = PrimaryMuted,
    onPrimaryContainer = Color(0xFF141C4A),
    secondary = Accent,
    onSecondary = Color(0xFF3A2004),
    secondaryContainer = Color(0xFFFDECD2),
    onSecondaryContainer = Color(0xFF432C05),
    tertiary = SaarthiInfo,
    onTertiary = Color.White,
    background = Canvas,
    onBackground = Ink,
    surface = CardWhite,
    onSurface = Ink,
    // `surfaceVariant` is the web's `--muted`: the fill behind a control that
    // sits *on* a card. Kept a clear step from both, because when these three
    // collapsed together every button and chip became invisible.
    surfaceVariant = Muted,
    onSurfaceVariant = MutedInk,
    outline = BorderLine,
    outlineVariant = BorderStrong,
    error = SaarthiDanger,
    onError = Color.White,
    errorContainer = Color(0xFFFDE7E4),
    onErrorContainer = Color(0xFF7A1C12),
)

private val DarkColors = darkColorScheme(
    primary = NightPrimary,
    onPrimary = NightCanvas,
    primaryContainer = Color(0xFF232D4D),
    onPrimaryContainer = Paper,
    secondary = Color(0xFFFBA834),
    onSecondary = NightCanvas,
    secondaryContainer = Color(0xFF3A2E17),
    onSecondaryContainer = Color(0xFFFFE0A6),
    tertiary = Color(0xFF38BDF8),
    onTertiary = NightCanvas,
    background = NightCanvas,
    onBackground = Paper,
    surface = NightSurface,
    onSurface = Paper,
    surfaceVariant = NightElevated,
    onSurfaceVariant = Color(0xFFA5B0C7),
    outline = NightBorder,
    outlineVariant = Color(0xFF212A42),
    error = Color(0xFFF87171),
    onError = NightCanvas,
    errorContainer = Color(0xFF44161A),
    onErrorContainer = Color(0xFFFFD9DB),
)

/**
 * Type scale.
 *
 * `displayLarge` is the speed readout and nothing else: 96sp, at a weight that
 * survives a windscreen reflection. Body text is 16sp rather than Material's 14,
 * because the reader is 60 cm away in a moving vehicle rather than 40 cm away at
 * a desk.
 */
private val TerminalTypography = Typography(
    displayLarge = TextStyle(
        fontFamily = FontFamily.Default,
        fontWeight = FontWeight.SemiBold,
        fontSize = 96.sp,
        lineHeight = 96.sp,
        letterSpacing = (-2).sp,
    ),
    displayMedium = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 56.sp,
        lineHeight = 60.sp,
        letterSpacing = (-1).sp,
    ),
    displaySmall = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 40.sp,
        lineHeight = 44.sp,
        letterSpacing = (-0.5).sp,
    ),
    headlineMedium = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 28.sp,
        lineHeight = 34.sp,
    ),
    headlineSmall = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 24.sp,
        lineHeight = 30.sp,
    ),
    titleLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 22.sp, lineHeight = 28.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 18.sp, lineHeight = 24.sp),
    bodyLarge = TextStyle(fontSize = 17.sp, lineHeight = 25.sp),
    bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.Medium, fontSize = 15.sp, letterSpacing = 0.3.sp),
    labelMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 12.sp, letterSpacing = 1.sp),
)

/**
 * Whether animation should be suppressed.
 *
 * A driver-set accessibility preference (section 60), not a performance switch.
 * Every animated surface reads it: the AI blob stops pulsing, state transitions
 * cut rather than cross-fade, and the map camera jumps rather than eases.
 */
val LocalReducedMotion = compositionLocalOf { false }

/**
 * Whether the cockpit is currently drawn dark.
 *
 * Needed by chrome that sits *over the map*, which cannot ask the colour scheme:
 * a panel floating on a basemap picks its own scrim and its own ink, and those
 * differ by more than a surface swap.
 */
val LocalDarkCockpit = compositionLocalOf { false }

/** Minimum touch target. Larger than Material's 48dp, and deliberately so. */
val TouchTarget = 64.dp

/** The gap the layout is built on. */
val Gutter = 16.dp

/**
 * Corner radii, matching the web's scale.
 *
 * Defined once so a card, a sheet and a chip cannot drift into three different
 * ideas of "rounded" — which is most of what makes an interface look assembled
 * rather than designed.
 */
object Radius {
    val sm = 10.dp
    val md = 14.dp
    val lg = 18.dp
    val xl = 22.dp
    val pill = 999.dp
}

@Composable
fun SaarthiTerminalTheme(
    /** The driver's own choice, from Terminal settings. Light unless asked. */
    darkTheme: Boolean = false,
    reducedMotion: Boolean = false,
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(
        LocalReducedMotion provides reducedMotion,
        LocalDarkCockpit provides darkTheme,
    ) {
        MaterialTheme(
            colorScheme = if (darkTheme) DarkColors else LightColors,
            typography = TerminalTypography,
            content = content,
        )
    }
}
