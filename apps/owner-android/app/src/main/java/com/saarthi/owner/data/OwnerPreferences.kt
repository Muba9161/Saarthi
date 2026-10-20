package com.saarthi.owner.data

import android.content.Context
import com.saarthi.owner.ui.design.Appearance
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** This phone's own choices — nothing here is a secret, so nothing here is encrypted. */
class OwnerPreferences(context: Context) {

    private val preferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    private val _appearance = MutableStateFlow(
        preferences.getString(KEY_APPEARANCE, null)
            ?.let { saved -> runCatching { Appearance.valueOf(saved) }.getOrNull() }
            ?: Appearance.PHONE,
    )
    val appearance: StateFlow<Appearance> = _appearance.asStateFlow()

    fun setAppearance(appearance: Appearance) {
        preferences.edit().putString(KEY_APPEARANCE, appearance.name).apply()
        _appearance.value = appearance
    }

    private val _appLock = MutableStateFlow(preferences.getBoolean(KEY_APP_LOCK, false))

    /** Ask for a fingerprint, face or the phone's screen lock before the app opens. */
    val appLock: StateFlow<Boolean> = _appLock.asStateFlow()

    /** Whether the notification permission has been asked for on this phone; asked once, never nagged. */
    var notificationsAsked: Boolean
        get() = preferences.getBoolean(KEY_NOTIFICATIONS_ASKED, false)
        set(value) = preferences.edit().putBoolean(KEY_NOTIFICATIONS_ASKED, value).apply()

    /**
     * The language the app speaks, as a BCP 47 tag ("hi", "doi"); empty follows
     * the phone. Written at once, not in the background, because the activity
     * is rebuilt straight after and reads it while it starts.
     */
    var languageTag: String
        get() = preferences.getString(KEY_LANGUAGE, "").orEmpty()
        set(value) {
            preferences.edit().putString(KEY_LANGUAGE, value).commit()
        }

    fun setAppLock(on: Boolean) {
        preferences.edit().putBoolean(KEY_APP_LOCK, on).apply()
        _appLock.value = on
    }

    private companion object {
        const val FILE = "saarthi-owner-preferences"
        const val KEY_APPEARANCE = "appearance"
        const val KEY_APP_LOCK = "app_lock"
        const val KEY_NOTIFICATIONS_ASKED = "notifications_asked"
        const val KEY_LANGUAGE = "language"
    }
}
