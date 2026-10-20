package com.saarthi.owner.ui.common

import com.saarthi.owner.R
import android.content.Context
import android.content.Intent
import android.net.Uri
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Open the phone's dialler on a number — never a call placed without the person pressing it. */
fun Context.dial(phone: String) {
    runCatching { startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${phone.filter { it.isDigit() || it == '+' }}"))) }
}

// Made on each use, so the month and day names follow the app\'s language when it changes.
private val ClockFormat: DateTimeFormatter get() = DateTimeFormatter.ofPattern("HH:mm")
// Made on each use, so the month and day names follow the app\'s language when it changes.
private val DayClockFormat: DateTimeFormatter get() = DateTimeFormatter.ofPattern("d MMM, HH:mm")
// Made on each use, so the month and day names follow the app\'s language when it changes.
private val DayFormat: DateTimeFormatter get() = DateTimeFormatter.ofPattern("d MMM")

/** "18 Aug" — the day alone, for things already done where the minute no longer matters. */
fun dayOf(iso: String?): String? =
    iso?.let { runCatching { Instant.parse(it) }.getOrNull() }?.atZone(ZoneId.systemDefault())?.let(DayFormat::format)

/** "18:20" today, "15 Oct, 18:20" any other day. */
fun clockOf(iso: String?): String? {
    val instant = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return null
    val local = instant.atZone(ZoneId.systemDefault())
    return if (local.toLocalDate() == java.time.LocalDate.now()) ClockFormat.format(local) else DayClockFormat.format(local)
}

/** "62 km", "1,240 km". */
fun km(value: Double?): String? = value?.let { Words.get(R.string.common_distance_km, "%,d".format(it.toLong())) }
