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

    data class Account(
        val userId: String,
        val name: String,
        val email: String,
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
     * The thirty-day credential, when this store is the one holding it.
     *
     * Null once Quick Login takes custody. That is the point of Quick Login: a
     * token readable here is a token readable by anything with the phone
     * unlocked and by any copy of the app's data, so enabling a PIN or
     * biometrics moves the only copy behind a Keystore key and clears this.
     */
    val refreshToken: String?
        get() = preferences.getString(KEY_REFRESH, null)

    /**
     * Whether Quick Login is holding the credential instead of this store.
     *
     * Needed because "signed in" and "the token is here" stopped being the same
     * question. A driver with a PIN is still signed in; their token is simply
     * somewhere this class cannot read without them.
     */
    val heldByQuickLogin: Boolean
        get() = preferences.getBoolean(KEY_HELD_BY_QUICK_LOGIN, false)

    /**
     * Hand the credential to Quick Login.
     *
     * Returns the token so the caller can seal it, and clears it here in the
     * same breath — there is no window in which both copies exist. Null when
     * there is nothing to hand over.
     */
    fun surrenderRefreshToken(): String? {
        val token = preferences.getString(KEY_REFRESH, null) ?: return null
        preferences.edit()
            .remove(KEY_REFRESH)
            .putBoolean(KEY_HELD_BY_QUICK_LOGIN, true)
            .apply()
        return token
    }

    /**
     * Take the credential back, when Quick Login is switched off.
     *
     * The driver has just proved who they are to reach this, so storing the
     * token readable again is exactly the trade they asked for: silent restore
     * on every launch, and no PIN.
     */
    /**
     * Where a rotated credential goes while Quick Login holds custody.
     *
     * Set once by the application object. Without it [store] wrote every
     * rotation straight back into readable preferences — which both undid Quick
     * Login's only guarantee and left the sealed copy stale, so the *next*
     * unlock replayed a token the server had already killed and the driver was
     * told their session had expired.
     */
    var custodian: ((String) -> Unit)? = null

    fun reclaimRefreshToken(token: String) {
        preferences.edit()
            .putString(KEY_REFRESH, token)
            .putBoolean(KEY_HELD_BY_QUICK_LOGIN, false)
            .apply()
    }

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
            /*
             * Never write the credential back into the clear while Quick Login
             * has it.
             *
             * The server rotates the refresh token on every use, so this runs
             * far more often than a sign-in — and each time it used to drop a
             * fresh, readable copy beside the sealed one. The custodian re-seals
             * instead, which keeps the only copy behind the Keystore and keeps
             * it current.
             */
            if (refreshToken != null && !heldByQuickLogin) {
                putString(KEY_REFRESH, refreshToken)
            }
        }.apply()

        if (refreshToken != null && heldByQuickLogin) custodian?.invoke(refreshToken)

        _account.value = account
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
        )
    }

    private companion object {
        const val FILE = "saarthi-driver-account"
        const val KEY_USER_ID = "user_id"
        const val KEY_NAME = "name"
        const val KEY_EMAIL = "email"
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
