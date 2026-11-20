package com.saarthi.driver.festive

import com.saarthi.core.util.DebugLog
import com.saarthi.driver.data.DriverAccountStore
import com.saarthi.driver.data.DriverPreferences
import com.saarthi.driver.network.DriverApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The driver's "Festive looks" choice: garland, greeting and colours on
 * festival days.
 *
 * Signed in, it is the account's, the same switch the web and the other apps
 * read: the session carries it and a change is written to the profile. Signed
 * out, it is this phone's. Off means nothing festive anywhere in Humsafar.
 */
class FestiveLooks(
    private val account: DriverAccountStore,
    private val preferences: DriverPreferences,
    private val api: DriverApi,
    private val scope: CoroutineScope,
) {

    /** On or off now: the signed-in account's choice, else this phone's. */
    val on: StateFlow<Boolean> = combine(account.account, preferences.festiveLooks, ::effective)
        .stateIn(scope, SharingStarted.Eagerly, effective(account.account.value, preferences.festiveLooks.value))

    private fun effective(signedIn: DriverAccountStore.Account?, onThisPhone: Boolean): Boolean =
        signedIn?.festiveLooks ?: onThisPhone

    /**
     * Turn festive looks on or off.
     *
     * Shown at once. Signed in, it is then saved to the account; if that fails
     * the switch goes back to how it was and [onNotSaved] runs on the main
     * thread, so the phone never claims a choice the account does not hold.
     */
    fun set(on: Boolean, onNotSaved: () -> Unit) {
        val before = this.on.value
        preferences.setFestiveLooks(on)
        if (account.account.value == null) return
        account.setFestiveLooks(on)

        scope.launch {
            try {
                api.patch(PROFILE_PATH, Json.encodeToString(ProfilePatch.serializer(), ProfilePatch(Preferences(on))))
            } catch (error: DriverApi.Failure) {
                DebugLog.debug(TAG, "Festive looks not saved: ${error.message}")
                // Only undo this change, not a later one made while it was in flight.
                if (account.account.value?.festiveLooks == on) {
                    preferences.setFestiveLooks(before)
                    account.setFestiveLooks(before)
                }
                withContext(Dispatchers.Main) { onNotSaved() }
            }
        }
    }

    /** `PATCH /profile/me` with only this preference; the server merges it into the rest. */
    @Serializable
    private data class ProfilePatch(val preferences: Preferences)

    @Serializable
    private data class Preferences(val festiveLooks: Boolean)

    private companion object {
        const val TAG = "FestiveLooks"
        const val PROFILE_PATH = "/api/v1/profile/me"
    }
}
