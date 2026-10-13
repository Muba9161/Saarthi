package com.saarthi.owner.ui.design

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Every colour the driver app draws with, in its light and dark forms.
 *
 * Taken token for token from the Saarthi driver design, so a screen built here
 * and the same screen on the design canvas agree to the hex. Screens read these
 * through [Saarthi.colors] and never hard-code a value, which is what lets the
 * Phone / Light / Dark switch in Profile repaint the whole app at once.
 *
 * The live map follows the same switch with its own colours, [MapInk].
 */
@Immutable
data class SaarthiPalette(
    val dark: Boolean,
    val canvas: Color,
    val card: Color,
    val elevated: Color,
    val sunken: Color,
    val segment: Color,
    val segmentOn: Color,
    val fg: Color,
    val muted: Color,
    val subtle: Color,
    val border: Color,
    val borderStrong: Color,
    val input: Color,
    val track: Color,
    val primary: Color,
    val onPrimary: Color,
    val primarySoft: Color,
    val primaryWash: Color,
    val primaryRing: Color,
    val glow: Color,
    val glowStrong: Color,
    val joinWash: Color,
    val success: Color,
    val successSoft: Color,
    val successBg: Color,
    val successWash: Color,
    val successGlow: Color,
    val warning: Color,
    val warningSoft: Color,
    val warningBg: Color,
    val warningWash: Color,
    val warningRing: Color,
    val warningGlow: Color,
    val danger: Color,
    val dangerSoft: Color,
    val dangerBg: Color,
    val dangerWash: Color,
    val dangerRing: Color,
    val accent: Color,
    val accentSoft: Color,
    val info: Color,
    val infoSoft: Color,
    /** The 1px outline every card carries. */
    val ring: Color,
    /** The shadow a card casts; transparent in dark, where shadows vanish. */
    val shadow: Color,
    /** The sweep across a loading skeleton. */
    val shine: Color,
    /** The drawn street map behind the waiting-for-approval screen. */
    val stage: Color,
    val street: Color,
    val artery: Color,
    /** The SOS button, which is brighter on dark so it still reads as alarm. */
    val sos: Color,
)

val LightPalette = SaarthiPalette(
    dark = false,
    canvas = Color(0xFFEFEFF1),
    card = Color(0xFFFFFFFF),
    elevated = Color(0xFFFFFFFF),
    sunken = Color(0xFFF4F4F5),
    segment = Color(0xFFE4E4E7),
    segmentOn = Color(0xFFFFFFFF),
    fg = Color(0xFF18181B),
    muted = Color(0xFF71717A),
    subtle = Color(0xFF85858E),
    border = Color(0xFFE4E4E7),
    borderStrong = Color(0xFFCFCFD3),
    input = Color(0xFFE1E1E5),
    track = Color(0xFFE4E4E7),
    primary = Color(0xFF3B47BA),
    onPrimary = Color(0xFFFFFFFF),
    primarySoft = Color(0xFFE5E7F5),
    primaryWash = Color(0x123B47BA),
    primaryRing = Color(0x473B47BA),
    glow = Color(0x1F3B47BA),
    glowStrong = Color(0x383B47BA),
    joinWash = Color(0xFFF6F7FD),
    success = Color(0xFF2A845A),
    successSoft = Color(0xFFE9F7F0),
    successBg = Color(0x1F2A845A),
    successWash = Color(0x142A845A),
    successGlow = Color(0x402A845A),
    warning = Color(0xFFB4650B),
    warningSoft = Color(0xFFFDF3E2),
    warningBg = Color(0x24D3770D),
    warningWash = Color(0x12D3770D),
    warningRing = Color(0x59D3770D),
    warningGlow = Color(0x42D3770D),
    danger = Color(0xFFD6292F),
    dangerSoft = Color(0xFFFDEDEE),
    dangerBg = Color(0x1AD6292F),
    dangerWash = Color(0x0DD6292F),
    dangerRing = Color(0x4DD6292F),
    accent = Color(0xFFC2650A),
    accentSoft = Color(0xFFFEF2E7),
    info = Color(0xFF197CC8),
    infoSoft = Color(0xFFE8F4FC),
    ring = Color(0x0D18181B),
    shadow = Color(0x2418181B),
    shine = Color(0xB3FFFFFF),
    stage = Color(0xFFF7F7F8),
    street = Color(0xFFE7E7EA),
    artery = Color(0xFFDADADF),
    sos = Color(0xFFD6292F),
)

val DarkPalette = SaarthiPalette(
    dark = true,
    canvas = Color(0xFF0E0E10),
    card = Color(0xFF161618),
    elevated = Color(0xFF1D1D20),
    sunken = Color(0xFF222225),
    segment = Color(0xFF1D1D20),
    segmentOn = Color(0xFF2E2E33),
    fg = Color(0xFFF4F4F5),
    muted = Color(0xFF9F9FA8),
    subtle = Color(0xFF7E7E8B),
    border = Color(0xFF29292E),
    borderStrong = Color(0xFF3F3F46),
    input = Color(0xFF2E2E33),
    track = Color(0xFF29292E),
    primary = Color(0xFF727FF3),
    onPrimary = Color(0xFF0F0F24),
    primarySoft = Color(0xFF232748),
    primaryWash = Color(0x1F727FF3),
    primaryRing = Color(0x66727FF3),
    glow = Color(0x2E727FF3),
    glowStrong = Color(0x4D727FF3),
    joinWash = Color(0xFF191B2C),
    success = Color(0xFF3DAE79),
    successSoft = Color(0xFF1D392C),
    successBg = Color(0x243DAE79),
    successWash = Color(0x1A3DAE79),
    successGlow = Color(0x4D3DAE79),
    warning = Color(0xFFF2952C),
    warningSoft = Color(0xFF40301C),
    warningBg = Color(0x26F2952C),
    warningWash = Color(0x14F2952C),
    warningRing = Color(0x4DF2952C),
    warningGlow = Color(0x4DF2952C),
    danger = Color(0xFFDF494E),
    dangerSoft = Color(0xFF421F20),
    dangerBg = Color(0x24DF494E),
    dangerWash = Color(0x14DF494E),
    dangerRing = Color(0x59DF494E),
    accent = Color(0xFFF49434),
    accentSoft = Color(0xFF3F2D1C),
    info = Color(0xFF379AE6),
    infoSoft = Color(0xFF1C3040),
    ring = Color(0x0FFFFFFF),
    shadow = Color(0x59000000),
    shine = Color(0x0DFFFFFF),
    stage = Color(0xFF131316),
    street = Color(0xFF1E1E22),
    artery = Color(0xFF26262B),
    sos = Color(0xFFDF494E),
)

/**
 * The live map's own colours, in a dark and a light form.
 *
 * The map used to stay dark whatever the appearance setting said. It now
 * follows the setting — a driver who chose Light at midday was handed a
 * near-black map that sunlight washes out — so these come from the theme as
 * [LocalMapInk], and [MapInk] reads whichever the theme provides. The SOS and
 * assistant overlays still pin the dark form through [AlwaysDark].
 */
@Immutable
data class MapInkPalette(
    val ground: Color,
    val canvas: Color,
    /** A panel floating over the map — translucent, so the map shows at its edge. */
    val panel: Color,
    /** The same panel where it must be nearly opaque, such as the foot bar. */
    val panelSolid: Color,
    val panelRing: Color,
    val card: Color,
    val well: Color,
    val sunken: Color,
    val line: Color,
    val lineStrong: Color,
    /** A round button on a panel. */
    val button: Color,
    val fg: Color,
    val muted: Color,
    val subtle: Color,
    val soft: Color,
    val primary: Color,
    val primaryInk: Color,
    val primarySoft: Color,
    val onPrimary: Color,
    val success: Color,
    val warning: Color,
    val danger: Color,
    val accent: Color,
    val accentSoft: Color,
    /** A filter chip at rest, its outline and its text. */
    val chip: Color,
    val chipRing: Color,
    val chipInk: Color,
    /** A list row's divider on a sheet. */
    val rule: Color,
    /** The grab handle on a sheet. */
    val handle: Color,
    /** The OpenStreetMap credits, printed over the map. */
    val credit: Color,
    val shadow: Color,
)

val DarkMapInk = MapInkPalette(
    ground = Color(0xFF0C0D10),
    canvas = Color(0xFF0E0E10),
    panel = Color(0xEB161618),
    panelSolid = Color(0xF0161618),
    panelRing = Color(0x12FFFFFF),
    card = Color(0xFF161618),
    well = Color(0xFF1D1D20),
    sunken = Color(0xFF222225),
    line = Color(0x12FFFFFF),
    lineStrong = Color(0x14FFFFFF),
    button = Color(0x14FFFFFF),
    fg = Color(0xFFF4F4F5),
    muted = Color(0xFF9F9FA8),
    subtle = Color(0xFF7E7E8B),
    soft = Color(0xFFD4D4D8),
    primary = Color(0xFF727FF3),
    primaryInk = Color(0xFF8E98F5),
    primarySoft = Color(0xFF232748),
    onPrimary = Color(0xFF0F0F24),
    success = Color(0xFF3DAE79),
    warning = Color(0xFFF2952C),
    danger = Color(0xFFDF494E),
    accent = Color(0xFFF49434),
    accentSoft = Color(0xFF3F2D1C),
    chip = Color(0xFF232326),
    chipRing = Color(0xFF26262A),
    chipInk = Color(0xFFB4B4BC),
    rule = Color(0xFF232326),
    handle = Color(0xFF3F3F46),
    credit = Color(0x80FFFFFF),
    shadow = Color(0xB3000000),
)

val LightMapInk = MapInkPalette(
    ground = Color(0xFFF2F3F5),
    canvas = Color(0xFFEFEFF1),
    panel = Color(0xF0FFFFFF),
    panelSolid = Color(0xFAFFFFFF),
    panelRing = Color(0x1418181B),
    card = Color(0xFFFFFFFF),
    well = Color(0xFFF4F4F5),
    sunken = Color(0xFFE9E9EC),
    line = Color(0x1418181B),
    lineStrong = Color(0x1F18181B),
    button = Color(0x0F18181B),
    fg = Color(0xFF18181B),
    muted = Color(0xFF71717A),
    subtle = Color(0xFF85858E),
    soft = Color(0xFF3F3F46),
    primary = Color(0xFF3B47BA),
    primaryInk = Color(0xFF3B47BA),
    primarySoft = Color(0xFFE5E7F5),
    onPrimary = Color(0xFFFFFFFF),
    success = Color(0xFF2A845A),
    warning = Color(0xFFB4650B),
    danger = Color(0xFFD6292F),
    accent = Color(0xFFC2650A),
    accentSoft = Color(0xFFFEF2E7),
    chip = Color(0xFFF1F1F3),
    chipRing = Color(0xFFE4E4E7),
    chipInk = Color(0xFF52525B),
    rule = Color(0xFFECECEF),
    handle = Color(0xFFD4D4D8),
    credit = Color(0x9918181B),
    shadow = Color(0x2E18181B),
)

val LocalMapInk = staticCompositionLocalOf { DarkMapInk }

/** The map's colours for the current theme. */
val MapInk: MapInkPalette
    @Composable @ReadOnlyComposable get() = LocalMapInk.current

/** The brand colours, which are the same in both themes. */
object Brand {
    val navyDeep = Color(0xFF021D40)
    val navy = Color(0xFF022A59)
    val navyBright = Color(0xFF07346F)
    val ink = Color(0xFF011C45)
    val saffron = Color(0xFFFE5D09)
    val saffronSoft = Color(0xFFFE8A4B)
    val green = Color(0xFF02783F)
    val greenBright = Color(0xFF028C48)
    val live = Color(0xFF4ADE80)
    val sosDeep = Color(0xFF8B1E22)
    val sosNight = Color(0xFF3A0B0D)
    val sosBlack = Color(0xFF140405)
    val sosBanner = Color(0xFFD6292F)
}
