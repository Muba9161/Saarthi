// Variable-font weights are marked experimental in this Compose release.
@file:OptIn(ExperimentalTextApi::class)

package com.saarthi.driver.ui.design

import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.driver.R

/**
 * Inter, at the four weights the design uses.
 *
 * One variable file rather than four statics: the weight is chosen by the
 * variation axis, so the whole family costs 100 KB of APK instead of 400.
 * Devanagari is not in Inter; Android falls back to the system's Noto for those
 * glyphs, which is the same face [Devanagari] names explicitly.
 */
val Inter = FontFamily(
    interWeight(FontWeight.Normal),
    interWeight(FontWeight.Medium),
    interWeight(FontWeight.SemiBold),
    interWeight(FontWeight.Bold),
    interWeight(FontWeight.ExtraBold),
)

private fun interWeight(weight: FontWeight) = Font(
    R.font.inter_variable,
    weight = weight,
    variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)),
)

/** Number plates, trip references and MAC addresses. */
val PlateMono = FontFamily(
    Font(R.font.roboto_mono_semibold, FontWeight.Medium),
    Font(R.font.roboto_mono_semibold, FontWeight.SemiBold),
    Font(R.font.roboto_mono_bold, FontWeight.Bold),
)

/** Hindi names in the language list, so they are never drawn in a fallback. */
val Devanagari = FontFamily(
    Font(
        R.font.noto_sans_devanagari_variable,
        weight = FontWeight.Medium,
        variationSettings = FontVariation.Settings(FontVariation.weight(500)),
    ),
    Font(
        R.font.noto_sans_devanagari_variable,
        weight = FontWeight.SemiBold,
        variationSettings = FontVariation.Settings(FontVariation.weight(600)),
    ),
)

/** Line heights exactly as specified, with no extra padding above the first line. */
private val Tight = LineHeightStyle(
    alignment = LineHeightStyle.Alignment.Center,
    trim = LineHeightStyle.Trim.Both,
)

private fun inter(
    size: TextUnit,
    weight: FontWeight = FontWeight.Normal,
    lineHeight: TextUnit = TextUnit.Unspecified,
    tracking: TextUnit = TextUnit.Unspecified,
) = TextStyle(
    fontFamily = Inter,
    fontSize = size,
    fontWeight = weight,
    lineHeight = lineHeight,
    letterSpacing = tracking,
    lineHeightStyle = Tight,
)

/**
 * The type scale, named after the design's own classes.
 *
 * Letter spacing is carried in `em`, as the design writes it, so a heading keeps
 * its tightness at whatever size it is drawn.
 */
object SType {
    /** `.h1` — the one big heading on a step. */
    val display = inter(32.sp, FontWeight.SemiBold, 34.sp, (-0.04).em)

    /** The welcome carousel's headline. */
    val hero = inter(38.sp, FontWeight.SemiBold, 38.sp, (-0.04).em)

    /** Celebration titles: approved, saved, all set. */
    val celebrate = inter(34.sp, FontWeight.SemiBold, 38.sp, (-0.04).em)

    /** A check card's question, a big plate-less title. */
    val title = inter(26.sp, FontWeight.SemiBold, 29.sp, (-0.03).em)

    /** Sheet and panel titles. */
    val sheetTitle = inter(22.sp, FontWeight.SemiBold, 28.sp, (-0.03).em)

    /** Section headings inside a scrolling tab. */
    val section = inter(20.sp, FontWeight.SemiBold, 26.sp, (-0.02).em)

    /** The header's title: "Hi, Ravi", "Your trips". */
    val headerTitle = inter(18.sp, FontWeight.SemiBold, 24.sp, (-0.02).em)

    /** `.eyebrow` — drawn upper-case by the caller. */
    val eyebrow = inter(11.sp, FontWeight.SemiBold, 14.sp, 0.08.em)

    /** `.lead` — the sentence under a heading. */
    val lead = inter(15.sp, FontWeight.Normal, 23.sp)

    val body = inter(14.sp, FontWeight.Normal, 21.sp)
    val bodyMedium = inter(14.sp, FontWeight.Medium, 21.sp)
    val bodyStrong = inter(15.sp, FontWeight.SemiBold, 21.sp)
    val rowTitle = inter(15.sp, FontWeight.Medium, 21.sp)
    val cardTitle = inter(16.sp, FontWeight.SemiBold, 22.sp)
    val small = inter(13.sp, FontWeight.Normal, 19.sp)
    val smallStrong = inter(13.sp, FontWeight.SemiBold, 18.sp)
    val caption = inter(12.sp, FontWeight.Normal, 16.sp)
    val captionStrong = inter(12.sp, FontWeight.SemiBold, 16.sp)
    val micro = inter(11.sp, FontWeight.Normal, 15.sp)
    val microStrong = inter(11.sp, FontWeight.SemiBold, 14.sp)

    /** `.flabel` — the label above a field. */
    val fieldLabel = inter(13.sp, FontWeight.SemiBold, 18.sp)

    /** What goes in a field. */
    val field = inter(17.sp, FontWeight.Medium, 22.sp)

    val button = inter(16.sp, FontWeight.SemiBold, 20.sp)
    val buttonSmall = inter(14.sp, FontWeight.SemiBold, 18.sp)
    val chip = inter(13.sp, FontWeight.SemiBold, 16.sp)

    /** A reading on an instrument card. */
    val metric = inter(24.sp, FontWeight.SemiBold, 28.sp, (-0.03).em)

    /** The big figure on a summary card. */
    val figure = inter(36.sp, FontWeight.SemiBold, 40.sp, (-0.04).em)

    /** A plate, at whatever size the caller asks for. */
    fun plate(size: TextUnit, tracking: TextUnit = 0.08.em) = TextStyle(
        fontFamily = PlateMono,
        fontWeight = FontWeight.Bold,
        fontSize = size,
        letterSpacing = tracking,
        lineHeightStyle = Tight,
    )

    /** A reference or code in monospace, lighter than a plate. */
    fun mono(size: TextUnit, weight: FontWeight = FontWeight.SemiBold, tracking: TextUnit = 0.02.em) =
        TextStyle(
            fontFamily = PlateMono,
            fontWeight = weight,
            fontSize = size,
            letterSpacing = tracking,
            lineHeightStyle = Tight,
        )
}
