package com.saarthi.core.festive

import android.os.SystemClock
import com.saarthi.core.data.TerminalSettings
import com.saarthi.core.util.DebugLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.net.URLEncoder
import java.time.LocalDate
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The festival calendar, fetched from Saarthi and held on the device.
 *
 * No admin and no server switch decides when the apps dress up: the server
 * sends the calendar, and each app picks today's festival by its own date.
 * So this only has to keep a recent copy:
 * - fetched at most once a day, or again when the app's language changes;
 * - kept in [TerminalSettings], so a device with no signal uses what it has;
 * - never an error. A failed fetch keeps the copy already held, and with no
 *   copy at all there is simply nothing festive to show.
 *
 * The route is public and says nothing about the caller, so no credential goes
 * with it; the fitted tablet asks before any driver is on it.
 *
 * @param apiUrl read on every fetch, so a changed server address applies at once.
 */
class FestiveCalendarSource(
    private val settings: TerminalSettings,
    private val scope: CoroutineScope,
    private val apiUrl: () -> String = { settings.apiUrl },
) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.SECONDS)
        .build()

    private val json = Json { ignoreUnknownKeys = true }

    private val _calendar = MutableStateFlow(FestiveCalendar.parse(settings.festiveCalendarJson))

    /** The calendar held now: the cached copy until a fresh one arrives, or null when there is none. */
    val calendar: StateFlow<FestiveCalendarDto?> = _calendar.asStateFlow()

    private val fetching = AtomicBoolean(false)

    /** The day and language whose fetch last failed, and when, so a dead spot is not asked every resume. */
    @Volatile
    private var lastFailure: Pair<String, Long>? = null

    /**
     * Fetch the calendar in [locale] unless today's copy in that language is already held.
     *
     * Returns at once; the fetch runs on the application scope, so leaving the
     * screen does not throw away an answer already on its way.
     */
    fun refreshIfDue(locale: String, today: LocalDate) {
        val day = today.toString()
        val held = _calendar.value != null &&
            settings.festiveCalendarFetchedOn == day &&
            settings.festiveCalendarLocale == locale
        if (held) return

        val attempt = "$day|$locale"
        val failure = lastFailure
        if (failure != null && failure.first == attempt && SystemClock.elapsedRealtime() - failure.second < RETRY_AFTER_MS) return
        if (!fetching.compareAndSet(false, true)) return

        scope.launch(Dispatchers.IO) {
            try {
                val raw = fetch(locale)
                val parsed = FestiveCalendar.parse(raw) ?: throw IOException("The festive calendar could not be read")
                settings.saveFestiveCalendar(raw, locale, day)
                _calendar.value = parsed
                lastFailure = null
            } catch (error: IOException) {
                failed(attempt, error)
            } catch (error: SerializationException) {
                failed(attempt, error)
            } catch (error: IllegalArgumentException) {
                // A malformed server address from the admin screen: nothing to fetch from.
                failed(attempt, error)
            } finally {
                fetching.set(false)
            }
        }
    }

    private fun failed(attempt: String, error: Exception) {
        lastFailure = attempt to SystemClock.elapsedRealtime()
        DebugLog.debug(TAG, "Festive calendar not refreshed: ${error.message}")
    }

    /** The answer's `data` object, as JSON text. */
    private fun fetch(locale: String): String {
        val url = "${apiUrl().trimEnd('/')}/api/v1/festive?locale=${URLEncoder.encode(locale, "UTF-8")}"
        val request = Request.Builder().url(url).header("Accept", "application/json").get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Festive calendar refused (${response.code})")
            val body = response.body?.string() ?: throw IOException("Festive calendar answered with nothing")
            val envelope = json.parseToJsonElement(body).jsonObject
            if ((envelope["success"] as? JsonPrimitive)?.booleanOrNull == false) {
                throw IOException("Festive calendar answered with an error")
            }
            val data = envelope["data"] as? JsonObject ?: throw IOException("Festive calendar answered with no data")
            return data.toString()
        }
    }

    private companion object {
        const val TAG = "Festive"

        /** How long a failed fetch for the same day and language waits before trying again. */
        const val RETRY_AFTER_MS = 30 * 60 * 1000L
    }
}
