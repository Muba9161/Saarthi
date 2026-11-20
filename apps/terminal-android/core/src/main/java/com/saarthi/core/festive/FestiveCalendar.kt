package com.saarthi.core.festive

import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.LocalDate

/*
 * The festival calendar, as `GET /api/v1/festive` sends it.
 *
 * A mirror of `FestiveCalendarResponse` in `packages/shared/src/festive/api.ts`,
 * kept to the fields the apps draw from. Nothing here decides *which* festivals
 * exist or when: the server sends every window that has not ended, and the app
 * picks today's by the phone's own local date (see [FestiveCalendar.activeWindowOn]),
 * so a device offline past midnight still switches on the right day.
 */

/** The answer's `data`. Unknown fields are ignored, so a newer server never breaks an older app. */
@Serializable
data class FestiveCalendarDto(
    /** The language the wishes are in, after the server resolved it (`hi` → `hi-IN`). */
    val locale: String = "",
    /** "from everyone at VorldX Saarthi", already in [locale]. */
    val signature: String = "",
    /** Windows that have not ended, in calendar order. */
    val windows: List<FestiveWindowDto> = emptyList(),
    /** One entry per festival in [windows], keyed by festival key. */
    val festivals: Map<String, FestivalDto> = emptyMap(),
)

/** When a festival shows. Every date is `YYYY-MM-DD`, and [start] and [end] are inclusive. */
@Serializable
data class FestiveWindowDto(val key: String, val day: String, val start: String, val end: String)

@Serializable
data class FestivalDto(
    val key: String = "",
    /** The wish, already in the calendar's language. */
    val wish: String = "",
    val kit: FestiveKitDto? = null,
)

/** `FestiveKit` in `packages/shared/src/festive/kits.ts`, as far as the apps draw it. */
@Serializable
data class FestiveKitDto(
    val motif: String = "",
    /** What hangs from a toran's middle. Only for `toran`. */
    val drop: String? = null,
    val band: FestiveBandColorsDto? = null,
    val wishOnDark: String = "",
    val wishOnLight: String = "",
)

/** Garland colours, `#RRGGBB`: a = main bloom, b = bloom centre, c and d = accents. */
@Serializable
data class FestiveBandColorsDto(
    val a: String,
    val b: String,
    val c: String,
    val d: String,
    val rope: String,
    val leaf: String,
)

/** The shape of the garland strip. */
enum class FestiveMotif { TORAN, LIGHTS, SPARKLE, KITES, BUNTING, LANTERNS, DRIP }

/** What hangs from the middle of a toran. */
enum class FestiveDrop { DIYA, RAKHI, FEATHER, LEAF, FLOWER }

/** How to draw one festival's garland. Colours are ARGB ints, so this stays free of Compose. */
data class FestiveBandStyle(
    val motif: FestiveMotif,
    val drop: FestiveDrop?,
    val a: Int,
    val b: Int,
    val c: Int,
    val d: Int,
    val rope: Int,
    val leaf: Int,
)

/**
 * Today's festival, ready to show.
 *
 * [band] is null when this build does not know the server's motif; the wish
 * still shows, the garland simply does not.
 */
data class FestiveLook(
    val key: String,
    val wish: String,
    val signature: String,
    /** The language [wish] and [signature] are in, as the server resolved it. */
    val locale: String,
    val band: FestiveBandStyle?,
    /** The wish's colour on a dark surface. */
    val wishOnDark: Int,
    /** The wish's colour on a light surface (4.5:1 or better on white). */
    val wishOnLight: Int,
) {
    /**
     * The wish addressed to someone: "Happy Gurpurab, Ravi".
     *
     * The same rule as `festiveGreeting` in `wishes.ts`: the first word of the
     * name, at most 24 characters; anything that looks like an email address
     * (the account name falls back to one) gives the wish alone. Urdu takes
     * the Arabic comma.
     */
    fun greeting(name: String?): String {
        val first = name.orEmpty().trim().split(WHITESPACE).first().take(MAX_NAME_LENGTH)
        if (first.isEmpty() || '@' in first) return wish
        val comma = if (locale.equals(URDU, ignoreCase = true)) "، " else ", "
        return wish + comma + first
    }

    private companion object {
        val WHITESPACE = Regex("\\s+")
        const val MAX_NAME_LENGTH = 24
        const val URDU = "ur-IN"
    }
}

/** Reading the calendar and choosing today's festival from it. */
object FestiveCalendar {

    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        explicitNulls = false
    }

    /** The calendar from its JSON (the answer's `data`), or null when it cannot be read. */
    fun parse(raw: String?): FestiveCalendarDto? {
        if (raw.isNullOrBlank()) return null
        return try {
            json.decodeFromString(FestiveCalendarDto.serializer(), raw)
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    /**
     * The window showing on [ymd] (`YYYY-MM-DD`), or null.
     *
     * Exactly `activeWindowOn` in `packages/shared/src/festive/calendar.ts`, so
     * the web and the apps agree on every day: among the windows covering the
     * date, the festival whose own day it is wins; else the nearest still to
     * come; else the one that passed most recently. ISO dates compare as plain
     * strings, as they do there.
     */
    fun activeWindowOn(ymd: String, windows: List<FestiveWindowDto>): FestiveWindowDto? {
        var best: FestiveWindowDto? = null
        for (window in windows) {
            if (ymd < window.start || ymd > window.end) continue
            if (best == null || showsBefore(window, best, ymd)) best = window
        }
        return best
    }

    private fun showsBefore(a: FestiveWindowDto, b: FestiveWindowDto, ymd: String): Boolean {
        val ra = rank(a, ymd)
        val rb = rank(b, ymd)
        if (ra != rb) return ra < rb
        return if (ra == RANK_UPCOMING) a.day < b.day else a.day > b.day
    }

    private fun rank(window: FestiveWindowDto, ymd: String): Int = when {
        window.day == ymd -> RANK_TODAY
        window.day > ymd -> RANK_UPCOMING
        else -> RANK_PASSED
    }

    /** The festival to show on [date], or null when none is showing or its kit is unreadable. */
    fun lookOn(calendar: FestiveCalendarDto, date: LocalDate): FestiveLook? {
        val window = activeWindowOn(date.toString(), calendar.windows) ?: return null
        val festival = calendar.festivals[window.key] ?: return null
        val kit = festival.kit ?: return null
        if (festival.wish.isBlank()) return null
        val onDark = parseColor(kit.wishOnDark) ?: return null
        val onLight = parseColor(kit.wishOnLight) ?: return null
        return FestiveLook(
            key = window.key,
            wish = festival.wish,
            signature = calendar.signature,
            locale = calendar.locale,
            band = bandStyle(kit),
            wishOnDark = onDark,
            wishOnLight = onLight,
        )
    }

    private fun bandStyle(kit: FestiveKitDto): FestiveBandStyle? {
        val motif = FestiveMotif.entries.firstOrNull { it.name.equals(kit.motif, ignoreCase = true) } ?: return null
        val colors = kit.band ?: return null
        return FestiveBandStyle(
            motif = motif,
            drop = kit.drop?.let { drop -> FestiveDrop.entries.firstOrNull { it.name.equals(drop, ignoreCase = true) } },
            a = parseColor(colors.a) ?: return null,
            b = parseColor(colors.b) ?: return null,
            c = parseColor(colors.c) ?: return null,
            d = parseColor(colors.d) ?: return null,
            rope = parseColor(colors.rope) ?: return null,
            leaf = parseColor(colors.leaf) ?: return null,
        )
    }

    /** `#RRGGBB` as an opaque ARGB int, or null for anything else. */
    fun parseColor(hex: String): Int? {
        if (!HEX_COLOR.matches(hex)) return null
        return (OPAQUE or hex.substring(1).toLong(16)).toInt()
    }

    private val HEX_COLOR = Regex("^#[0-9a-fA-F]{6}$")
    private const val OPAQUE = 0xFF000000L
    private const val RANK_TODAY = 0
    private const val RANK_UPCOMING = 1
    private const val RANK_PASSED = 2
}
