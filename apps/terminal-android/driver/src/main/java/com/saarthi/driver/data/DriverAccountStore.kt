package com.saarthi.driver.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Who is signed in, and the credential that keeps them signed in.
 *
 * This is the difference between the driver app and the fitted terminal. A
 * terminal holds a *device* credential issued to the tablet; this holds a
 * *person's* session, because the phone belongs to the driver and follows them
 * from truck to truck.
 *
 * **Signed in once, not once a shift.** The refresh token lives for thirty days
 * and is exchanged for a fresh one on every use, so a driver who opens the app
 * at least monthly never sees the sign-in screen again — which is the behaviour
 * every other app on their phone has taught them to expect. A driver who has to
 * type an email and password at five in the morning in a yard will stop using
 * the app, and an app they do not open reports nothing.
 *
 * **Encrypted at rest.** A thirty-day credential in plain `SharedPreferences`
 * is a credential readable by anything with root, by any backup, and by the next
 * owner of a resold handset. Drivers resell handsets.
 */
class DriverAccountStore(context: Context) {

    private val preferences: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        FILE,
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    /** The signed-in driver, or null. Drives which screen the app opens on. */
    private val _account = MutableStateFlow(readAccount())
    val account: StateFlow<Account?> = _account.asStateFlow()

    /**
     * [avatarUrl] and [coverUrl] are the driver's profile photo and banner, as
     * the relative media URLs the session carries. Kept here, not fetched per
     * screen, so the header can show the photo the moment the app opens; every
     * launch and token refresh rewrites them from the session, so a photo
     * changed on the web arrives without a sign-out.
     *
     * [festiveLooks] is the account's "Festive looks" choice, read from the
     * session the same way, so turning it off on the web reaches the phone at
     * the next refresh. On unless the account turned it off.
     */
    data class Account(
        val userId: String,
        val name: String,
        val email: String,
        val avatarUrl: String? = null,
        val coverUrl: String? = null,
        val festiveLooks: Boolean = true,
    )

    /**
     * The short-lived token for API calls.
     *
     * Held in memory only. It lasts fifteen minutes, so persisting it would
     * trade a real risk for no benefit — the refresh token below is what
     * survives a restart, and it is the one worth protecting.
     */
    @Volatile
    var accessToken: String? = null
        private set

    /** When [accessToken] stops being accepted, as device uptime milliseconds. */
    @Volatile
    private var accessExpiresAt: Long = 0

    /**
     * The thirty-day credential, in encrypted storage.
     *
     * Readable by the app without asking the driver anything, which is what
     * lets Humsafar open straight away and restore the session silently, as the
     * owner app does. App lock guards the screen when the driver wants it; it
     * does not hide this.
     *
     * Null for a driver whose credential the retired Quick Login still holds
     * (see [heldByQuickLogin]) until they unlock it one last time.
     */
    val refreshToken: String?
        get() = preferences.getString(KEY_REFRESH, null)

    /**
     * Whether the retired Quick Login sealed this driver's credential.
     *
     * True only for a phone that had a PIN or fingerprint set before App lock
     * replaced Quick Login, until that driver unlocks once or signs in again.
     * Nothing sets it any more; [store] clears it.
     */
    val heldByQuickLogin: Boolean
        get() = preferences.getBoolean(KEY_HELD_BY_QUICK_LOGIN, false)

    /** True when a token is held and is not about to expire mid-request. */
    fun hasUsableAccessToken(): Boolean {
        val token = accessToken ?: return false
        return token.isNotEmpty() && System.currentTimeMillis() < accessExpiresAt - EXPIRY_MARGIN_MS
    }

    /**
     * Remember a successful sign-in or refresh.
     *
     * `refreshToken` is nullable because a refresh may legitimately not rotate
     * one, and overwriting a good credential with null would sign the driver out
     * on the next launch for no reason.
     *
     * A rotated token always lands here, readable. The server rotates on every
     * use and kills the old token at once, so this must be the only copy that
     * matters; a stale copy anywhere else is a credential that no longer works.
     */
    fun store(
        account: Account,
        accessToken: String,
        expiresInSeconds: Long,
        refreshToken: String?,
    ) {
        this.accessToken = accessToken
        this.accessExpiresAt = System.currentTimeMillis() + expiresInSeconds * 1000

        preferences.edit().apply {
            putString(KEY_USER_ID, account.userId)
            putString(KEY_NAME, account.name)
            putString(KEY_EMAIL, account.email)
            putString(KEY_AVATAR, account.avatarUrl)
            putString(KEY_COVER, account.coverUrl)
            putBoolean(KEY_FESTIVE_LOOKS, account.festiveLooks)
            if (refreshToken != null) {
                putString(KEY_REFRESH, refreshToken)
                putBoolean(KEY_HELD_BY_QUICK_LOGIN, false)
            }
        }.apply()

        _account.value = account
    }

    /**
     * Record a "Festive looks" change made on this phone, ahead of the next
     * session that would carry it. Nothing happens when nobody is signed in.
     */
    fun setFestiveLooks(on: Boolean) {
        val current = _account.value ?: return
        preferences.edit().putBoolean(KEY_FESTIVE_LOOKS, on).apply()
        _account.value = current.copy(festiveLooks = on)
    }

    /**
     * Sign out.
     *
     * Everything goes, including the driver's name. A phone handed to the next
     * driver on the shift must not show whose it was.
     */
    fun clear() {
        accessToken = null
        accessExpiresAt = 0
        preferences.edit().clear().apply()
        _account.value = null
    }

    private fun readAccount(): Account? {
        val id = preferences.getString(KEY_USER_ID, null) ?: return null
        /*
         * An account needs a way back in — but there are now two.
         *
         * Either this store holds the refresh token, or Quick Login does. With
         * neither, there is no route to a session, and treating that as signed
         * in would open the app on a cockpit that failed every request.
         */
        val recoverable = preferences.getString(KEY_REFRESH, null) != null ||
            preferences.getBoolean(KEY_HELD_BY_QUICK_LOGIN, false)
        if (!recoverable) return null
        return Account(
            userId = id,
            name = preferences.getString(KEY_NAME, null).orEmpty(),
            email = preferences.getString(KEY_EMAIL, null).orEmpty(),
            avatarUrl = preferences.getString(KEY_AVATAR, null),
            coverUrl = preferences.getString(KEY_COVER, null),
            festiveLooks = preferences.getBoolean(KEY_FESTIVE_LOOKS, true),
        )
    }

    private companion object {
        const val FILE = "saarthi-driver-account"
        const val KEY_USER_ID = "user_id"
        const val KEY_NAME = "name"
        const val KEY_EMAIL = "email"
        const val KEY_AVATAR = "avatar_url"
        const val KEY_COVER = "cover_url"
        const val KEY_FESTIVE_LOOKS = "festive_looks"
        const val KEY_REFRESH = "refresh_token"
        const val KEY_HELD_BY_QUICK_LOGIN = "held_by_quick_login"

        /**
         * Refresh this long before expiry rather than on failure.
         *
         * A token that expires while a request is in flight costs a round trip
         * and a retry; on a marginal cell connection at the edge of a yard that
         * is the difference between a trip starting and a driver tapping twice.
         */
        const val EXPIRY_MARGIN_MS = 60_000L
    }
}
