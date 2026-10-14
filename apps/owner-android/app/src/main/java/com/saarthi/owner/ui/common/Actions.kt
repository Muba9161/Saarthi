package com.saarthi.owner.ui.common

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

private val ClockFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
private val DayClockFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM, HH:mm")
private val DayFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM")

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
fun km(value: Double?): String? = value?.let { "%,d km".format(it.toLong()) }
