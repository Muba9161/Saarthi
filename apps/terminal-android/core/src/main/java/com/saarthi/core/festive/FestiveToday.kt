package com.saarthi.core.festive

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.saarthi.core.SaarthiApp
import kotlinx.coroutines.delay
import java.time.Duration
import java.time.LocalDateTime
import java.util.Locale

/**
 * The festival this screen should wear today, or null.
 *
 * Today is the device's own local date, read again whenever the app comes back
 * to the front and again just after local midnight, so a screen left open
 * overnight changes on the right morning. The calendar is fetched at most once
 * a day, or when the app's language changes, and only while [enabled].
 *
 * Off means off: with [enabled] false this asks the network for nothing and
 * returns null.
 */
@Composable
fun rememberFestiveLook(enabled: Boolean = true): FestiveLook? {
    val context = LocalContext.current
    val source = remember(context) { SaarthiApp.from(context).festive }
    val locale = festiveLocale(LocalConfiguration.current.locales[0])
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var today by remember { mutableStateOf(LocalDateTime.now().toLocalDate()) }

    LaunchedEffect(enabled, locale, lifecycle) {
        if (!enabled) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                val now = LocalDateTime.now()
                today = now.toLocalDate()
                source.refreshIfDue(locale, today)
                delay(millisUntilNextLocalDay(now))
            }
        }
    }

    val calendar by source.calendar.collectAsState()
    val look = remember(calendar, today) { calendar?.let { FestiveCalendar.lookOn(it, today) } }
    return look.takeIf { enabled }
}

/**
 * The app's language as the festive route wants it: language and region only.
 *
 * A full tag can carry the phone's regional preferences (`en-IN-u-mu-celsius`)
 * and run past the route's 16-character limit; the server matches on the
 * language anyway (`hi` → `hi-IN`).
 */
internal fun festiveLocale(locale: Locale): String =
    listOf(locale.language, locale.country).filter { it.isNotEmpty() }.joinToString("-").ifEmpty { "en" }

/** How long until just after the next local midnight, never under a second. */
internal fun millisUntilNextLocalDay(now: LocalDateTime): Long {
    val next = now.toLocalDate().plusDays(1).atStartOfDay().plusSeconds(1)
    return Duration.between(now, next).toMillis().coerceAtLeast(MIN_DELAY_MS)
}

private const val MIN_DELAY_MS = 1_000L
