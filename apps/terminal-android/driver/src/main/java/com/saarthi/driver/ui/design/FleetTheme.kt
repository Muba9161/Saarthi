package com.saarthi.driver.ui.design

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.core.ui.LocalDarkCockpit
import com.saarthi.core.ui.LocalReducedMotion

/**
 * Saarthi for drivers, as a night cab sees it.
 *
 * The fitted terminal is a bright instrument panel bolted to a dashboard; this
 * is a phone held in a hand, usually in a yard before dawn or a lay-by after
 * dark, and it is dark-first for that reason rather than for fashion. One
 * accent carries every action in the app — a single ember orange, the colour of
 * a hazard light — and everything else is ground, edge or type. A driver
 * glancing at this screen has to find the one thing they can press without
 * reading, and an interface with three accent colours has no such thing.
 *
 * Deliberately a driver-only surface. `:core` still owns the terminal's own
 * palette and the tablet is untouched by anything here — but this theme feeds a
 * real Material colour scheme, so the shared cockpit, scanner and glass panels
 * the driver app borrows from `:core` all pick the night palette up without a
 * line of `:core` changing.
 */

// --- Ground ---------------------------------------------------------------
//
// Four steps, and no more. A card, the tile inside it and the field inside that
// have to be distinguishable at arm's length in daylight through a windscreen,
// which four well-separated values do and eight subtly different greys do not.

/** The page itself. Near-black rather than black, so an OLED panel keeps depth. */
val Obsidian = Color(0xFF0A0B0D)

/** A card on the page. */
val Onyx = Color(0xFF131417)

/** A control on a card: a tile, a field, an icon chip. */
val OnyxRaised = Color(0xFF1B1D21)

/** A control pressed, or a track behind one. */
val OnyxDeep = Color(0xFF232529)

/** The hairline that separates two surfaces the eye would otherwise merge. */
val Hairline = Color(0xFF2A2D33)

// --- Accent ---------------------------------------------------------------

/** The one action colour. Every button a driver may press is this orange. */
val Ember = Color(0xFFF26522)

/** The lit edge of it, for gradients and glows. */
val EmberBright = Color(0xFFFF8A3D)

/** The shadowed edge, and the pressed state. */
val EmberDeep = Color(0xFFC9500F)

/**
 * Ink on orange.
 *
 * 5:1 against [Ember], which white is not. Small type on an orange card — a
 * date, a place name — uses this; only large bold type uses white, where 3:1 is
 * the standard and white clears it.
 */
val EmberInk = Color(0xFF2B1002)

// --- Type -----------------------------------------------------------------

val Chalk = Color(0xFFF7F7F8)
val Ash = Color(0xFF9AA0A8)
val Slate = Color(0xFF70767E)

// --- State ----------------------------------------------------------------

val LiveGreen = Color(0xFF34D399)
val AlertRed = Color(0xFFFF5A5F)
val CautionAmber = Color(0xFFFBBF24)

/**
 * The page ground.
 *
 * Not a flat fill: a fractionally warmer top and a colder bottom, which is what
 * stops a full-screen black reading as a dead panel and gives the cards
 * something to sit on.
 */
val FleetGround = Brush.verticalGradient(
    0f to Color(0xFF101114),
    0.45f to Obsidian,
    1f to Color(0xFF08090B),
)

/** The fill of a primary action, and of the cards that stand for one. */
val EmberGradient = Brush.verticalGradient(listOf(EmberBright, Ember, EmberDeep))

/** The same, on the diagonal, for wide cards where a vertical ramp bands. */
val EmberSweep = Brush.linearGradient(listOf(EmberBright, Ember))

/**
 * Corner radii.
 *
 * Larger than the terminal's, and that is the single biggest reason this reads
 * as a phone app rather than a shrunken dashboard. Defined once so a card, a
 * tile and a chip cannot drift into three ideas of "rounded".
 */
object FleetRadius {
    val chip = 12.dp
    val field = 16.dp
    val tile = 20.dp
    val card = 26.dp
    val hero = 40.dp
    val pill = 999.dp
}

/** The rhythm everything is spaced on. 4dp increments, no exceptions. */
object FleetSpace {
    val hair = 4.dp
    val tight = 8.dp
    val snug = 12.dp
    val base = 16.dp
    val roomy = 20.dp
    val section = 24.dp
    val wide = 32.dp
}

/**
 * The smallest thing a driver may be asked to press.
 *
 * 56dp rather than Material's 48dp. The reader is standing beside a running
 * vehicle or sitting in one, and a target sized for a desk is not a target
 * here. Icon-only controls get 44dp of visual with the rest as hit area.
 */
val FleetTouchTarget = 56.dp

/**
 * Registration numbers and tracking codes.
 *
 * Monospaced, always. An `8` and a `B` in a proportional face at six in the
 * morning is how a driver ends up standing beside the wrong trailer.
 */
val FleetMono = FontFamily.Monospace

/**
 * Type.
 *
 * Two jobs, and they are not the same job. Headings and figures are tight and
 * heavy, because they are read at a glance and never read twice. Body is loose
 * and plain, because it is read once, carefully, and usually explains something
 * a driver did not expect.
 */
private val FleetTypography = Typography(
    displayLarge = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 88.sp,
        lineHeight = 88.sp,
        letterSpacing = (-3).sp,
    ),
    displayMedium = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 52.sp,
        lineHeight = 56.sp,
        letterSpacing = (-1.5).sp,
    ),
    displaySmall = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 36.sp,
        lineHeight = 42.sp,
        letterSpacing = (-1).sp,
    ),
    headlineLarge = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 32.sp,
        lineHeight = 38.sp,
        letterSpacing = (-0.8).sp,
    ),
    headlineMedium = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 27.sp,
        lineHeight = 33.sp,
        letterSpacing = (-0.6).sp,
    ),
    headlineSmall = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 23.sp,
        lineHeight = 29.sp,
        letterSpacing = (-0.4).sp,
    ),
    titleLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 26.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 23.sp),
    titleSmall = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 20.sp),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 21.sp),
    bodySmall = TextStyle(fontSize = 13.sp, lineHeight = 19.sp),
    labelLarge = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 15.sp,
        letterSpacing = 0.2.sp,
    ),
    labelMedium = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 12.sp,
        letterSpacing = 0.8.sp,
    ),
    labelSmall = TextStyle(
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        letterSpacing = 0.6.sp,
    ),
)

/**
 * The night scheme, expressed in Material's vocabulary.
 *
 * Every role is filled deliberately rather than left to Material's tonal
 * derivation, because the shared cockpit reads `surfaceVariant` and `outline`
 * directly and a derived value there would be a colour nobody chose.
 */
private val FleetColorScheme = darkColorScheme(
    primary = Ember,
    onPrimary = Color.White,
    primaryContainer = Color(0xFF3A1808),
    onPrimaryContainer = Color(0xFFFFD9C2),
    inversePrimary = EmberDeep,

    secondary = EmberBright,
    onSecondary = EmberInk,
    secondaryContainer = OnyxRaised,
    onSecondaryContainer = Chalk,

    tertiary = LiveGreen,
    onTertiary = Color(0xFF04231A),
    tertiaryContainer = Color(0xFF10352A),
    onTertiaryContainer = Color(0xFFB6F5E0),

    background = Obsidian,
    onBackground = Chalk,
    surface = Onyx,
    onSurface = Chalk,
    surfaceVariant = OnyxRaised,
    onSurfaceVariant = Ash,
    surfaceTint = Ember,
    inverseSurface = Chalk,
    inverseOnSurface = Obsidian,

    outline = Hairline,
    outlineVariant = Color(0xFF202329),
    scrim = Color(0xCC000000),

    error = AlertRed,
    onError = Color(0xFF2B0507),
    errorContainer = Color(0xFF3A1315),
    onErrorContainer = Color(0xFFFFD5D6),
)

/**
 * Wrap the driver app in its own visual language.
 *
 * Drop-in for `SaarthiTerminalTheme`: it provides the same two composition
 * locals the shared `:core` surfaces read — [LocalReducedMotion] so a driver
 * who has asked for stillness gets it everywhere, and [LocalDarkCockpit] so
 * chrome floating over the map picks a scrim that works on a dark basemap.
 *
 * There is no light variant, and that is a decision rather than an omission. A
 * driver's phone is used at the two ends of a shift and the app is dark at
 * both; a light mode would be a second palette to keep honest for a case that
 * does not arise. The `darkTheme` parameter is kept so the existing call site
 * and the stored setting continue to work unchanged.
 */
@Composable
fun FleetTheme(
    @Suppress("UNUSED_PARAMETER") darkTheme: Boolean = true,
    reducedMotion: Boolean = false,
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(
        LocalReducedMotion provides reducedMotion,
        LocalDarkCockpit provides true,
    ) {
        MaterialTheme(
            colorScheme = FleetColorScheme,
            typography = FleetTypography,
            content = content,
        )
    }
}
