package com.saarthi.owner.ui.common

import com.saarthi.owner.R
import java.text.NumberFormat
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private val PlateParts = Regex("^([A-Z]{2})(\\d{1,2})([A-Z]{0,3})(\\d{1,4})$")

/** "MH12KT4521" as it is painted: "MH 12 KT 4521". Anything else is shown as stored. */
fun formatPlate(registration: String): String {
    val compact = registration.uppercase().replace(Regex("[^A-Z0-9]"), "")
    val match = PlateParts.matchEntire(compact) ?: return registration.uppercase()
    return match.groupValues.drop(1).filter { it.isNotEmpty() }.joinToString(" ")
}

private val Rupees: NumberFormat = NumberFormat.getCurrencyInstance(Locale.Builder().setLanguage("en").setRegion("IN").build()).apply {
    maximumFractionDigits = 0
}

/** ₹13,050 — whole rupees, Indian grouping. */
fun rupees(amount: Double): String = Rupees.format(amount)

private val RupeesAndPaise: NumberFormat = NumberFormat.getCurrencyInstance(Locale.Builder().setLanguage("en").setRegion("IN").build()).apply {
    minimumFractionDigits = 2
    maximumFractionDigits = 2
}

/** A price per unit: "₹7.20" a brick keeps its paise, "₹980" a tonne does not grow ".00". */
fun unitPrice(amount: Double): String =
    if (amount % 1.0 == 0.0) Rupees.format(amount) else RupeesAndPaise.format(amount)

/** How long ago, the way a person says it: "now", "4 min", "3 h", "2 d" — in the app's language. */
fun ago(iso: String?, now: Instant = Instant.now()): String {
    val then = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return ""
    val minutes = Duration.between(then, now).toMinutes().coerceAtLeast(0)
    return when {
        minutes < 1 -> Words.get(R.string.common_time_now)
        minutes < 60 -> Words.get(R.string.common_time_minutes, minutes.toInt())
        minutes < 60 * 24 -> Words.get(R.string.common_time_hours, (minutes / 60).toInt())
        else -> Words.get(R.string.common_time_days, (minutes / (60 * 24)).toInt())
    }
}

/** Whether [ago] said "now", for sentences that read differently then ("reporting now" rather than "… ago"). */
fun isNow(iso: String?, now: Instant = Instant.now()): Boolean {
    val then = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return false
    return Duration.between(then, now).toMinutes() < 1
}

/** A span of minutes the way a journey is told: "45 min", "2 h 10 min", "1 d 3 h". */
fun minutesSpan(minutes: Int?): String? {
    val total = minutes?.takeIf { it >= 0 } ?: return null
    return when {
        total < 60 -> Words.get(R.string.common_time_minutes, total)
        total < 60 * 24 ->
            if (total % 60 > 0) Words.get(R.string.common_span_hours_minutes, total / 60, total % 60)
            else Words.get(R.string.common_time_hours, total / 60)
        else ->
            if (total % (60 * 24) >= 60) Words.get(R.string.common_span_days_hours, total / (60 * 24), total % (60 * 24) / 60)
            else Words.get(R.string.common_time_days, total / (60 * 24))
    }
}

/** A countdown as mm:ss, for an approval that escalates. */
fun countdown(seconds: Long): String {
    val clamped = seconds.coerceAtLeast(0)
    return "%d:%02d".format(clamped / 60, clamped % 60)
}

/** 366,045 as "366k", 1,240 as "1,240" — a number that fits a small tile. */
fun shortCount(value: Double): String = when {
    value >= 1_000_000 -> Words.get(R.string.ui_count_millions, "%.1f".format(value / 1_000_000))
    value >= 100_000 -> Words.get(R.string.ui_count_thousands, (value / 1_000).toLong().toString())
    else -> "%,d".format(value.toLong())
}

/** A date the API sent, as either "2027-03-12" or a full instant; null for nothing or nonsense. */
fun parseDate(value: String?): LocalDate? {
    if (value.isNullOrBlank()) return null
    return runCatching { LocalDate.parse(value.take(10)) }.getOrNull()
        ?: runCatching { Instant.parse(value).atZone(ZoneId.systemDefault()).toLocalDate() }.getOrNull()
}

/** "12 Mar 2027" in the phone's own date style; null for nothing or nonsense. */
fun prettyDate(value: String?): String? =
    parseDate(value)?.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))
