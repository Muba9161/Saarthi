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
 * Taken from the web app's design tokens in `apps/web/src/styles/globals.css`,
 * so a fleet owner looking at the dashboard and a driver looking at the tablet
 * are recognisably in one product: the same indigo, the same saffron accent, the
 * same semantic colours.
 *
 * Two things differ from the web, and both are about where this screen lives.
 *
 * **Light is the default, and dark is a switch.** It used to follow the system,
 * which turned a phone left in dark mode into a near-black cockpit in daylight
 * — unreadable through a windscreen, and not a choice anybody had made about
 * this screen. The night argument is real (a white screen at 3 a.m. costs a
 * driver their night vision for the next minute) but it is the driver's call,
 * so it lives in Terminal settings rather than being inferred from the tablet.
 *
 * **Type is larger and contrast is higher than a desktop app would use.** The
 * reader is at arm's length, sometimes in direct sun, sometimes moving. Speed,
 * navigation, warnings and SOS are the four things that must stay readable when
 * everything else has washed out, so they get the largest sizes and the
 * strongest contrast rather than the prettiest treatment.
 */

// --- Palette ---------------------------------------------------------------
//
// Converted from the HSL tokens the web app defines. Named for what they are in
// the design system rather than for their hue, so a change there can be tracked
// here.

private val SaarthiIndigo = Color(0xFF2B41B8)      // --primary, light
private val SaarthiIndigoBright = Color(0xFF7A93FA) // --primary, dark
private val SaarthiSaffron = Color(0xFFF59E0B)      // --accent
private val SaarthiSaffronBright = Color(0xFFFBA834)

private val NightCanvas = Color(0xFF0B1020)         // --canvas, dark
private val NightSurface = Color(0xFF141A2E)        // --card, dark
private val NightElevated = Color(0xFF1B2338)       // --elevated, dark
private val NightOutline = Color(0xFF2A3350)

private val DayCanvas = Color(0xFFF3F6FB)
private val DaySurface = Color(0xFFFFFFFF)
private val DayOutline = Color(0xFFDBE2ED)
private val DayElevated = Color(0xFFF7F9FD)

private val Ink = Color(0xFF0B1020)
private val Paper = Color(0xFFF1F5F9)

val SaarthiSuccess = Color(0xFF34D399)
val SaarthiWarning = Color(0xFFFBBF24)
val SaarthiDanger = Color(0xFFF87171)
val SaarthiInfo = Color(0xFF38BDF8)

private val DarkColors = darkColorScheme(
    primary = SaarthiIndigoBright,
    onPrimary = Ink,
    primaryContainer = Color(0xFF232D4D),
    onPrimaryContainer = Paper,
    secondary = SaarthiSaffronBright,
    onSecondary = Ink,
    secondaryContainer = Color(0xFF3A2E17),
    onSecondaryContainer = Color(0xFFFFE0A6),
    tertiary = SaarthiInfo,
    onTertiary = Ink,
    background = NightCanvas,
    onBackground = Paper,
    surface = NightSurface,
    onSurface = Paper,
    surfaceVariant = NightElevated,
    onSurfaceVariant = Color(0xFFA5B0C7),
    outline = NightOutline,
    outlineVariant = Color(0xFF212A42),
    error = SaarthiDanger,
    onError = Ink,
    errorContainer = Color(0xFF44161A),
    onErrorContainer = Color(0xFFFFD9DB),
)

private val LightColors = lightColorScheme(
    primary = SaarthiIndigo,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE4E9FB),
    onPrimaryContainer = Color(0xFF141C4A),
    secondary = Color(0xFFB45309),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFFDEBCF),
    onSecondaryContainer = Color(0xFF432C05),
    tertiary = Color(0xFF0369A1),
    onTertiary = Color.White,
    background = DayCanvas,
    onBackground = Ink,
    surface = DaySurface,
    onSurface = Ink,
    surfaceVariant = DayElevated,
    onSurfaceVariant = Color(0xFF4B5768),
    outline = DayOutline,
    outlineVariant = Color(0xFFE7ECF4),
    error = Color(0xFFB91C1C),
    onError = Color.White,
    errorContainer = Color(0xFFFEE2E2),
    onErrorContainer = Color(0xFF7F1D1D),
)

/**
 * Whether the cockpit is currently drawn dark.
 *
 * Needed by the chrome that sits *over the map*, which cannot ask the colour
 * scheme: a panel floating on a basemap has to pick its own scrim and its own
 * text colour, and those differ by more than a surface swap. Provided here so
 * a composable four levels down is not handed a boolean through every caller.
 */
val LocalDarkCockpit = compositionLocalOf { false }

/**
 * Type scale.
 *
 * `displayLarge` is the speed readout and nothing else: 96sp, tabular, at a
 * weight that survives a windscreen reflection. Body text is 16sp rather than
 * the Material default of 14, because the reader is 60 cm away in a moving
 * vehicle rather than 40 cm away at a desk.
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
        fontWeight = FontWeight.Medium,
        fontSize = 40.sp,
        lineHeight = 46.sp,
    ),
    headlineMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 28.sp, lineHeight = 34.sp),
    headlineSmall = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 24.sp, lineHeight = 30.sp),
    titleLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 22.sp, lineHeight = 28.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 18.sp, lineHeight = 24.sp),
    bodyLarge = TextStyle(fontSize = 17.sp, lineHeight = 25.sp),
    bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.Medium, fontSize = 15.sp, letterSpacing = 0.3.sp),
    labelMedium = TextStyle(
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        letterSpacing = 1.sp,
    ),
)

/**
 * Whether animation should be suppressed.
 *
 * A driver-set accessibility preference (section 60), not a performance switch.
 * Every animated surface in this app reads it: the AI blob stops pulsing, state
 * transitions cut rather than cross-fade, and the map camera jumps rather than
 * eases. Provided as a CompositionLocal so a composable deep in the tree does
 * not need it threaded through six parameters.
 */
val LocalReducedMotion = compositionLocalOf { false }

/** Minimum touch target. Larger than Material's 48dp, and deliberately so. */
val TouchTarget = 64.dp

/** The gap the layout is built on. */
val Gutter = 16.dp

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
