package com.saarthi.driver.data

import android.content.Context
import com.saarthi.core.data.TerminalSettings
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Choices that belong to the driver app and to nobody else.
 *
 * Kept apart from [TerminalSettings], which the fitted tablet shares: a tablet
 * has no "follow the phone" appearance and no instruments to hide, and a
 * setting added there would be one the tablet had to carry and ignore.
 *
 * Both values are observable, because each is changed on one screen (Profile)
 * and read on another (the theme, the Map tab) while both are on show.
 */
class DriverPreferences(context: Context, settings: TerminalSettings) {

    private val preferences =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** How the app is painted. The live map ignores this and stays dark. */
    enum class Appearance { PHONE, LIGHT, DARK }

    private val _appearance = MutableStateFlow(
        preferences.getString(KEY_APPEARANCE, null)
            ?.let { saved -> runCatching { Appearance.valueOf(saved) }.getOrNull() }
            // The first launch after this setting existed: carry over the old
            // dark switch rather than repainting somebody's app on them.
            ?: if (settings.darkTheme) Appearance.DARK else Appearance.PHONE,
    )
    val appearance: StateFlow<Appearance> = _appearance.asStateFlow()

    fun setAppearance(value: Appearance) {
        preferences.edit().putString(KEY_APPEARANCE, value.name).apply()
        _appearance.value = value
    }

    /**
     * Whether the Map tab shows speed, engine, fuel and coolant.
     *
     * On by default. Turning it off hides the readings from the driver's view
     * only — the phone keeps reporting them to the fleet either way.
     */
    private val _instruments = MutableStateFlow(preferences.getBoolean(KEY_INSTRUMENTS, true))
    val instruments: StateFlow<Boolean> = _instruments.asStateFlow()

    fun setInstruments(shown: Boolean) {
        preferences.edit().putBoolean(KEY_INSTRUMENTS, shown).apply()
        _instruments.value = shown
    }

    private companion object {
        const val FILE = "saarthi_driver_preferences"
        const val KEY_APPEARANCE = "appearance"
        const val KEY_INSTRUMENTS = "instruments_on_map"
    }
}
