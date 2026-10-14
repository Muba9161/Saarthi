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

    fun setAppLock(on: Boolean) {
        preferences.edit().putBoolean(KEY_APP_LOCK, on).apply()
        _appLock.value = on
    }

    private companion object {
        const val FILE = "saarthi-owner-preferences"
        const val KEY_APPEARANCE = "appearance"
        const val KEY_APP_LOCK = "app_lock"
    }
}
