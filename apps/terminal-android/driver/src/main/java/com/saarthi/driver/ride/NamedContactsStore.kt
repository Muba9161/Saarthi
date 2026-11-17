package com.saarthi.driver.ride

import android.content.Context

/**
 * The people the rider named for the share that is on, kept on this phone.
 *
 * The server keeps only the contacts it found a Saarthi account for, so "You
 * named" rebuilt from its answer after the app was closed would tell the rider
 * which of their family use Saarthi — the one thing a share never says. A rider
 * shares one ride at a time, so only the latest share's contacts are kept, and
 * they go when it ends.
 */
internal class NamedContactsStore(context: Context) {

    private val preferences = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun save(shareId: String, contacts: List<String>) {
        preferences.edit()
            .putString(KEY_SHARE, shareId)
            .putString(KEY_CONTACTS, contacts.joinToString(SEPARATOR))
            .apply()
    }

    /** The contacts named for [shareId]; none for any other share. */
    fun of(shareId: String): List<String> {
        if (preferences.getString(KEY_SHARE, null) != shareId) return emptyList()
        return preferences.getString(KEY_CONTACTS, null)
            ?.split(SEPARATOR)
            ?.filter { it.isNotBlank() }
            .orEmpty()
    }

    fun clear() {
        preferences.edit().clear().apply()
    }

    private companion object {
        const val FILE = "saarthi_ride_share_named"
        const val KEY_SHARE = "share_id"
        const val KEY_CONTACTS = "contacts"
        const val SEPARATOR = ","
    }
}
