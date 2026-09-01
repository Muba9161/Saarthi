package com.saarthi.device.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.saarthi.device.BuildConfig
import java.security.SecureRandom
import android.util.Base64

/**
 * Device credentials at rest.
 *
 * Everything in here is either a credential or something that identifies this
 * installation to Saarthi, so it lives in `EncryptedSharedPreferences` backed by
 * a hardware-bound key. Plain SharedPreferences would be readable by anything
 * with root, by an ADB backup, and by whoever ends up with the phone after a
 * driver sells it.
 *
 * The identity is generated here rather than derived from ANDROID_ID or the
 * IMEI. Section 5 of the specification is explicit about not depending on an
 * easily spoofed hardware identifier, and the practical reasons are just as
 * strong: ANDROID_ID survives a factory reset on some devices and changes on
 * others, and the IMEI has been unreadable by apps since Android 10.
 */
class DeviceIdentityStore(context: Context) {

    private val prefs: SharedPreferences = run {
        val key = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            "saarthi_device_identity",
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /**
     * The stable identity for this installation.
     *
     * Created on first read and never regenerated, so an app that is force-
     * stopped, updated or reopened keeps the device it was paired as. It is
     * cleared only by `forget()`, which is what uninstalling or an explicit
     * reset amounts to.
     */
    val installationId: String
        get() = prefs.getString(KEY_INSTALLATION, null) ?: generateInstallationId()

    private fun generateInstallationId(): String {
        val bytes = ByteArray(24)
        SecureRandom().nextBytes(bytes)
        val value = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        prefs.edit().putString(KEY_INSTALLATION, value).apply()
        return value
    }

    /** The identifier Saarthi issued, e.g. `SAARTHI-DEV-001`. */
    var deviceIdentifier: String?
        get() = prefs.getString(KEY_IDENTIFIER, null)
        set(value) = prefs.edit().putString(KEY_IDENTIFIER, value).apply()

    /**
     * The long-lived device secret.
     *
     * Never sent except to exchange it for a short-lived token, never logged,
     * and never rendered anywhere in the UI — not even in the debug console,
     * which redacts it by not being given it in the first place.
     */
    var secret: String?
        get() = prefs.getString(KEY_SECRET, null)
        set(value) = prefs.edit().putString(KEY_SECRET, value).apply()

    /** The current short-lived access token, and when it stops working. */
    var accessToken: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_TOKEN, value).apply()

    var accessTokenExpiresAt: Long
        get() = prefs.getLong(KEY_TOKEN_EXPIRY, 0L)
        set(value) = prefs.edit().putLong(KEY_TOKEN_EXPIRY, value).apply()

    /**
     * Where this device reports.
     *
     * Learned from the pairing QR rather than compiled in, so one build serves
     * development, staging and production and a tester cannot end up pointing a
     * phone at the wrong environment by having installed the wrong APK.
     */
    var apiBaseUrl: String
        get() = prefs.getString(KEY_API, null) ?: BuildConfig.SAARTHI_API_URL
        set(value) = prefs.edit().putString(KEY_API, value.trimEnd('/')).apply()

    val isEnrolled: Boolean
        get() = deviceIdentifier != null && secret != null

    /**
     * Whether the held token is worth trying.
     *
     * Refreshed a minute early on purpose: a token that expires mid-request
     * costs a round trip and, on a weak signal, a retry that may not come back.
     */
    fun hasUsableToken(now: Long = System.currentTimeMillis()): Boolean =
        accessToken != null && accessTokenExpiresAt > now + 60_000

    fun storeToken(token: String, expiresInSeconds: Int) {
        prefs.edit()
            .putString(KEY_TOKEN, token)
            .putLong(KEY_TOKEN_EXPIRY, System.currentTimeMillis() + expiresInSeconds * 1000L)
            .apply()
    }

    /** Drop the token without touching the secret, so the next call re-mints one. */
    fun clearToken() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_TOKEN_EXPIRY).apply()
    }

    /**
     * Forget this device entirely.
     *
     * Used when a driver hands the phone on. The installation id goes too, so
     * the next enrolment is a genuinely new identity rather than a claim on the
     * previous one — which the backend would refuse anyway once it is paired.
     */
    fun forget() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val KEY_INSTALLATION = "installation_id"
        const val KEY_IDENTIFIER = "device_identifier"
        const val KEY_SECRET = "device_secret"
        const val KEY_TOKEN = "access_token"
        const val KEY_TOKEN_EXPIRY = "access_token_expires_at"
        const val KEY_API = "api_base_url"
    }
}
