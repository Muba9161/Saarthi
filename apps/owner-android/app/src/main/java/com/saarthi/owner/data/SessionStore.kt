package com.saarthi.owner.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Who is signed in on this phone, and the credentials that keep them signed in.
 *
 * Encrypted at rest, as the driver app keeps its own: a refresh token in plain
 * preferences is a thirty-day session readable by anything with a backup. The
 * access token lives in memory only — it is good for fifteen minutes and is
 * cheaper to mint again than to protect on disk.
 */
class SessionStore(context: Context) {

    private val preferences: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        FILE,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    /** The signed-in person and the business they act for. */
    data class Account(
        val userId: String,
        val firstName: String,
        val fullName: String,
        val email: String,
        val organizationName: String,
        val accountType: AccountType,
        /** The person's role in the business: `FLEET_OWNER`, `DISPATCHER`… */
        val membershipRole: String,
        /** What the business is on — shown, never sold, here. */
        val planName: String?,
        /** The business is archived or the person suspended: everything is kept, nothing opens. */
        val paused: Boolean,
        val permissions: Set<String>,
    ) {
        fun can(permission: String): Boolean = permission in permissions
    }

    private val _account = MutableStateFlow(readAccount())
    val account: StateFlow<Account?> = _account.asStateFlow()

    @Volatile
    var accessToken: String? = null
        private set

    @Volatile
    private var accessExpiresAt: Long = 0

    val refreshToken: String?
        get() = preferences.getString(KEY_REFRESH, null)

    fun hasUsableAccessToken(): Boolean {
        val token = accessToken ?: return false
        return token.isNotEmpty() && System.currentTimeMillis() < accessExpiresAt - EXPIRY_MARGIN_MS
    }

    fun store(account: Account, accessToken: String, expiresInSeconds: Long, refreshToken: String?) {
        this.accessToken = accessToken
        accessExpiresAt = System.currentTimeMillis() + expiresInSeconds * 1000
        preferences.edit().apply {
            putString(KEY_USER_ID, account.userId)
            putString(KEY_FIRST_NAME, account.firstName)
            putString(KEY_FULL_NAME, account.fullName)
            putString(KEY_EMAIL, account.email)
            putString(KEY_ORGANIZATION, account.organizationName)
            putString(KEY_ACCOUNT_TYPE, account.accountType.name)
            putString(KEY_ROLE, account.membershipRole)
            putString(KEY_PLAN, account.planName)
            putBoolean(KEY_PAUSED, account.paused)
            putStringSet(KEY_PERMISSIONS, account.permissions)
            if (refreshToken != null) putString(KEY_REFRESH, refreshToken)
        }.apply()
        _account.value = account
    }

    fun clear() {
        accessToken = null
        accessExpiresAt = 0
        preferences.edit().clear().apply()
        _account.value = null
    }

    /** The account from the last session, shown at once while it is confirmed with the server. */
    private fun readAccount(): Account? {
        val id = preferences.getString(KEY_USER_ID, null) ?: return null
        if (preferences.getString(KEY_REFRESH, null) == null) return null
        return Account(
            userId = id,
            firstName = preferences.getString(KEY_FIRST_NAME, null).orEmpty(),
            fullName = preferences.getString(KEY_FULL_NAME, null).orEmpty(),
            email = preferences.getString(KEY_EMAIL, null).orEmpty(),
            organizationName = preferences.getString(KEY_ORGANIZATION, null).orEmpty(),
            accountType = preferences.getString(KEY_ACCOUNT_TYPE, null)
                ?.let { saved -> runCatching { AccountType.valueOf(saved) }.getOrNull() }
                ?: AccountType.UNSUPPORTED,
            membershipRole = preferences.getString(KEY_ROLE, null).orEmpty(),
            planName = preferences.getString(KEY_PLAN, null),
            paused = preferences.getBoolean(KEY_PAUSED, false),
            permissions = preferences.getStringSet(KEY_PERMISSIONS, null).orEmpty(),
        )
    }

    private companion object {
        const val FILE = "saarthi-owner-session"
        const val KEY_USER_ID = "user_id"
        const val KEY_FIRST_NAME = "first_name"
        const val KEY_FULL_NAME = "full_name"
        const val KEY_EMAIL = "email"
        const val KEY_ORGANIZATION = "organization"
        const val KEY_ACCOUNT_TYPE = "account_type"
        const val KEY_ROLE = "membership_role"
        const val KEY_PLAN = "plan_name"
        const val KEY_PAUSED = "paused"
        const val KEY_PERMISSIONS = "permissions"
        const val KEY_REFRESH = "refresh_token"

        /** Refresh a minute early, so a request never leaves with a token that dies in flight. */
        const val EXPIRY_MARGIN_MS = 60_000L
    }
}
