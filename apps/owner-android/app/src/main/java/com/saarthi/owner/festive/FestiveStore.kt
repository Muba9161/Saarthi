package com.saarthi.owner.festive

import android.os.SystemClock
import com.saarthi.owner.data.OwnerPreferences
import com.saarthi.owner.data.SessionStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime

/**
 * Which festival this phone wears today, if any.
 *
 * Nobody switches a festival on: the calendar comes from the server once a day
 * (or when the app's language changes), is kept on the phone, and today's
 * festival is picked from it by the phone's own local date, so it changes at
 * the phone's midnight even offline. With no calendar yet, nothing festive
 * shows; a failed fetch is never mentioned to anyone.
 *
 * Whether festive looks are wanted at all is the signed-in account's choice
 * (carried on the session), and this phone's own choice while signed out.
 */
class FestiveStore(
    private val api: FestiveApi,
    private val preferences: OwnerPreferences,
    private val session: SessionStore,
) {
    /** Lives as long as the app: the store is made once, in `OwnerApp`. */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val calendar = MutableStateFlow(readCache())
    private val today = MutableStateFlow(localToday())
    private val hiddenOn = MutableStateFlow(preferences.festiveGreetingHiddenOn)
    private val fetching = Mutex()

    /** The language and time of the last fetch that failed, so an offline phone is not asked again on every resume. */
    @Volatile
    private var lastAttempt: Pair<String, Long>? = null

    /** Festive looks wanted: the account's choice while signed in, this phone's otherwise. */
    val wanted: StateFlow<Boolean> = combine(session.account, preferences.festiveLooks) { account, device ->
        account?.festiveLooks ?: device
    }.stateIn(scope, SharingStarted.Eagerly, session.account.value?.festiveLooks ?: preferences.festiveLooks.value)

    /** Today's festival, or null on an ordinary day, with no calendar, or with festive looks off. */
    val look: StateFlow<FestiveLook?> = combine(calendar, today, wanted, hiddenOn) { held, day, on, hidden ->
        if (on && held != null) lookOn(held, day, hidden) else null
    }.stateIn(scope, SharingStarted.Eagerly, initialLook())

    init {
        // The account's choice is mirrored onto the phone, so after signing out
        // the sign-in and loading screens still respect it.
        scope.launch {
            session.account.collect { account -> account?.let { preferences.setFestiveLooks(it.festiveLooks) } }
        }
    }

    /**
     * Keep [look] right while the app is in front: re-read the local date and
     * fetch the calendar if it is due, then again just after each local
     * midnight. Run from the activity while it is started, so coming back to the
     * app re-checks at once; cancelled when it goes to the background.
     */
    suspend fun keepCurrent(locale: String) {
        while (true) {
            today.value = localToday()
            refresh(locale)
            delay(msUntilNextLocalDay())
        }
    }

    private suspend fun refresh(locale: String) = fetching.withLock {
        val day = localToday()
        val cache = preferences.festiveCache
        if (!needsFetch(calendar.value != null, cache?.fetchedOn, cache?.locale, day, locale)) return@withLock
        val now = SystemClock.elapsedRealtime()
        lastAttempt?.let { (askedIn, at) -> if (askedIn == locale && now - at < RETRY_MS) return@withLock }
        try {
            val fresh = api.calendar(locale) ?: return@withLock
            preferences.festiveCache = OwnerPreferences.FestiveCache(
                json = FestiveJson.encodeToString(FestiveCalendar.serializer(), fresh),
                locale = locale,
                fetchedOn = day,
            )
            calendar.value = fresh
            lastAttempt = null
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // Offline, refused or garbled: the calendar already held stands, and nobody is told.
            lastAttempt = locale to now
        }
    }

    /** Hide today's greeting card; it is back tomorrow. The garland stays. */
    fun hideGreetingToday() {
        val day = today.value
        preferences.festiveGreetingHiddenOn = day
        hiddenOn.value = day
    }

    /**
     * Turn festive looks on or off. Signed in, it is saved to the account first
     * (so the web and the other apps follow) and throws when that fails, leaving
     * everything as it was; signed out, it is this phone's choice alone.
     */
    suspend fun setLooks(on: Boolean) {
        if (session.account.value == null) {
            preferences.setFestiveLooks(on)
            return
        }
        api.saveLooks(on)
        // Read again after the call, so a newer read of the account (a new photo, say) is not undone.
        session.account.value?.let { session.refresh(it.copy(festiveLooks = on)) }
    }

    private fun initialLook(): FestiveLook? {
        val held = calendar.value ?: return null
        if (!(session.account.value?.festiveLooks ?: preferences.festiveLooks.value)) return null
        return lookOn(held, today.value, hiddenOn.value)
    }

    /** The calendar kept from the last fetch; null when there is none or it no longer reads. */
    private fun readCache(): FestiveCalendar? {
        val cache = preferences.festiveCache ?: return null
        return runCatching { FestiveJson.decodeFromString(FestiveCalendar.serializer(), cache.json) }.getOrNull()
    }

    private companion object {
        /** After a failed fetch, wait this long before asking again in the same language. */
        const val RETRY_MS = 15 * 60_000L

        fun localToday(): String = LocalDate.now().toString()

        /** Until just after the next local midnight, when today's festival may change. */
        fun msUntilNextLocalDay(): Long {
            val now = LocalDateTime.now()
            val next = now.toLocalDate().plusDays(1).atStartOfDay().plusSeconds(1)
            return Duration.between(now, next).toMillis().coerceAtLeast(1_000L)
        }
    }
}
