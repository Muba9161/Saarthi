package com.saarthi.owner.ui.common

import java.text.NumberFormat
import java.time.Duration
import java.time.Instant
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

/** How long ago, the way a person says it: "now", "4 min", "3 h", "2 d". */
fun ago(iso: String?, now: Instant = Instant.now()): String {
    val then = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return ""
    val minutes = Duration.between(then, now).toMinutes().coerceAtLeast(0)
    return when {
        minutes < 1 -> "now"
        minutes < 60 -> "$minutes min"
        minutes < 60 * 24 -> "${minutes / 60} h"
        else -> "${minutes / (60 * 24)} d"
    }
}

/** A countdown as mm:ss, for an approval that escalates. */
fun countdown(seconds: Long): String {
    val clamped = seconds.coerceAtLeast(0)
    return "%d:%02d".format(clamped / 60, clamped % 60)
}

/** "1 vehicle", "12 vehicles". */
fun plural(count: Int, one: String, many: String = one + "s"): String = "$count ${if (count == 1) one else many}"

/** 366,045 as "366k", 1,240 as "1,240" — a number that fits a small tile. */
fun shortCount(value: Double): String = when {
    value >= 1_000_000 -> "%.1fM".format(value / 1_000_000)
    value >= 100_000 -> "${(value / 1_000).toLong()}k"
    else -> "%,d".format(value.toLong())
}
