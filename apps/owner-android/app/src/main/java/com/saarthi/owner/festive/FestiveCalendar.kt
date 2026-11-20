package com.saarthi.owner.festive

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/*
 * The festive calendar as `GET /api/v1/festive` returns it, and the few pure
 * rules the app applies to it. The server's source of truth is
 * `packages/shared/src/festive` (api.ts, calendar.ts, kits.ts); nothing here
 * decides a date, it only reads the windows the server sent by this phone's
 * own local date.
 */

/** How the calendar is read from the server and kept on the phone: lenient, so a newer server never breaks it. */
internal val FestiveJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

/** `FestiveCalendarResponse`: the festivals ahead, their wishes in one language, and how each looks. */
@Serializable
data class FestiveCalendar(
    /** The language the wishes are in, after the server resolved it (`hi` → `hi-IN`). */
    val locale: String = "",
    /** "from everyone at VorldX Saarthi", already in [locale]. */
    val signature: String = "",
    /** Windows that had not ended when this was fetched, in calendar order. */
    val windows: List<FestiveWindow> = emptyList(),
    /** One entry per festival in [windows], by its key. */
    val festivals: Map<String, Festival> = emptyMap(),
)

/** When one festival shows: from [start] to [end], both inclusive, around its own [day]. All YYYY-MM-DD. */
@Serializable
data class FestiveWindow(val key: String, val day: String, val start: String, val end: String)

@Serializable
data class Festival(
    val key: String,
    /** English name, for logs and accessible labels. */
    val name: String = "",
    /** The wish, already translated: "Happy Gurpurab". */
    val wish: String = "",
    val kit: FestiveKit,
)

/** How a festival looks (`kits.ts` `FestiveKit`), the parts this app draws. Colours are `#RRGGBB`. */
@Serializable
data class FestiveKit(
    /** Null for a motif this build does not know: no garland rather than a wrong one. */
    val motif: FestiveMotif? = null,
    /** What hangs from the middle of a toran. */
    val drop: FestiveDrop? = null,
    val band: BandColors,
    /** Two washes of light behind the dark greeting card. */
    val glow: List<FestiveGlow> = emptyList(),
    /** The wish's colour on a dark surface. */
    val wishOnDark: String = "#FFFFFF",
    /** What drifts across the greeting card; null draws nothing. */
    val fx: FestiveFx? = null,
    val fxColors: List<String> = emptyList(),
)

/** The garland's colours: a main bloom, b bloom centre, c and d accents, the rope and the leaves. */
@Serializable
data class BandColors(
    val a: String,
    val b: String,
    val c: String,
    val d: String,
    val rope: String,
    val leaf: String,
)

@Serializable
data class FestiveGlow(val color: String, val alpha: Float)

@Serializable
enum class FestiveMotif {
    @SerialName("toran") TORAN,
    @SerialName("lights") LIGHTS,
    @SerialName("sparkle") SPARKLE,
    @SerialName("kites") KITES,
    @SerialName("bunting") BUNTING,
    @SerialName("lanterns") LANTERNS,
    @SerialName("drip") DRIP,
}

@Serializable
enum class FestiveDrop {
    @SerialName("diya") DIYA,
    @SerialName("rakhi") RAKHI,
    @SerialName("feather") FEATHER,
    @SerialName("leaf") LEAF,
    @SerialName("flower") FLOWER,
}

/** What drifts across the greeting card. [EMBERS] rise; everything else falls. */
@Serializable
enum class FestiveFx {
    @SerialName("petals") PETALS,
    @SerialName("snow") SNOW,
    @SerialName("confetti") CONFETTI,
    @SerialName("stars") STARS,
    @SerialName("kites") KITES,
    @SerialName("embers") EMBERS,
}

/** Today's festival, ready to draw: what the garland, the greeting and the splash read. */
data class FestiveLook(
    val festival: Festival,
    val window: FestiveWindow,
    /** The language [Festival.wish] and [signature] are in. */
    val locale: String,
    val signature: String,
    /** The person hid today's greeting card; the garland still shows. */
    val greetingHidden: Boolean,
) {
    val kit: FestiveKit get() = festival.kit
}

/**
 * The window showing on [ymd], or null: `activeWindowOn` in calendar.ts, rule
 * for rule. Of the windows covering the date, the festival whose own day it is
 * wins; else the nearest still to come; else the one that passed most recently.
 */
fun activeWindowOn(ymd: String, windows: List<FestiveWindow>): FestiveWindow? {
    var best: FestiveWindow? = null
    for (window in windows) {
        if (ymd < window.start || ymd > window.end) continue
        if (best == null || showsBefore(window, best, ymd)) best = window
    }
    return best
}

/** Whether [a] shows rather than [b] when both cover [ymd]. Dates compare as text: YYYY-MM-DD sorts by day. */
private fun showsBefore(a: FestiveWindow, b: FestiveWindow, ymd: String): Boolean {
    val ra = rank(a, ymd)
    val rb = rank(b, ymd)
    if (ra != rb) return ra < rb
    return if (ra == 1) a.day < b.day else a.day > b.day
}

private fun rank(window: FestiveWindow, ymd: String): Int = when {
    window.day == ymd -> 0
    window.day > ymd -> 1
    else -> 2
}

/** Today's festival in [calendar] on [ymd], or null when none shows. */
fun lookOn(calendar: FestiveCalendar, ymd: String, greetingHiddenOn: String?): FestiveLook? {
    val window = activeWindowOn(ymd, calendar.windows) ?: return null
    val festival = calendar.festivals[window.key] ?: return null
    return FestiveLook(
        festival = festival,
        window = window,
        locale = calendar.locale,
        signature = calendar.signature,
        greetingHidden = greetingHiddenOn == ymd,
    )
}

/**
 * Whether the calendar should be fetched again: never fetched, fetched on an
 * earlier day, or in another language. At most once a day otherwise.
 */
fun needsFetch(hasCache: Boolean, fetchedOn: String?, fetchedLocale: String?, today: String, locale: String): Boolean =
    !hasCache || fetchedOn != today || fetchedLocale != locale

/**
 * The wish addressed to someone: "Happy Gurpurab, Aarav!" (`festiveGreeting`
 * in wishes.ts). Without a usable first name it is the wish alone; Urdu takes
 * the Arabic comma.
 */
fun greetingLine(wish: String, firstName: String?, locale: String): String {
    val name = firstName.orEmpty().trim().split(WHITESPACE).firstOrNull().orEmpty().take(MAX_NAME)
    if (name.isEmpty() || '@' in name) return wish
    val comma = if (locale.lowercase().let { it == "ur" || it.startsWith("ur-") }) "، " else ", "
    return "$wish$comma$name!"
}

/**
 * The name to greet, or null. The session falls back to the email's first
 * part when a person has no first name; that is not a name to wish anyone by,
 * and it shows as a full name that does not begin with it (or is the email).
 */
fun greetingName(firstName: String, fullName: String): String? =
    firstName.takeIf { it.isNotBlank() && '@' !in fullName && fullName.startsWith(it) }

/** `#RRGGBB` as an opaque ARGB value, or null when it is not one. */
fun argbOf(hex: String): Long? {
    val digits = hex.removePrefix("#")
    if (digits.length != 6 || !digits.all { it in '0'..'9' || it.lowercaseChar() in 'a'..'f' }) return null
    return 0xFF000000L or digits.toLong(16)
}

private val WHITESPACE = Regex("\\s+")
private const val MAX_NAME = 24
