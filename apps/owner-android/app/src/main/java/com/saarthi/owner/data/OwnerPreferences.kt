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

    private companion object {
        const val FILE = "saarthi-owner-preferences"
        const val KEY_APPEARANCE = "appearance"
    }
}
