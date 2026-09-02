package com.saarthi.terminal.data

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.SecureRandom

/**
 * The terminal's own identity, at rest.
 *
 * Four things live here and nothing else: the installation id the terminal
 * generated for itself, the device identifier Saarthi issued in response, the
 * device secret, and the short-lived access token that secret buys. Three of
 * them are credentials.
 *
 * Backed by [EncryptedSharedPreferences], because a device secret in plain
 * SharedPreferences is a secret readable by anything with root, by any backup,
 * and by `adb backup` on a device somebody left unlocked. A terminal is bolted
 * into a truck that gets serviced, sold and stolen, so the assumption that the
 * physical device stays trustworthy is not one this app makes.
 *
 * The fallback to plaintext preferences is deliberate and narrow: some tablets
 * ship with a broken or absent keystore, and on those the choice is between an
 * app that will not start and one that stores its secret less well. A terminal
 * that will not start is a truck that cannot leave the yard, so it degrades —
 * and [usingHardwareBackedStorage] says which mode it is in, so the admin
 * screen can tell an installer the truth about the hardware they fitted.
 */
class TerminalIdentityStore(context: Context) {

    private val fallbackOnly: Boolean
    private val preferences: SharedPreferences

    init {
        val application = context.applicationContext
        var encrypted: SharedPreferences? = null
        try {
            val masterKey = MasterKey.Builder(application)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            encrypted = EncryptedSharedPreferences.create(
                application,
                ENCRYPTED_FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (error: Throwable) {
            // Swallowed on purpose, and recorded rather than hidden.
            encrypted = null
        }

        fallbackOnly = encrypted == null
        preferences = encrypted
            ?: application.getSharedPreferences(PLAIN_FILE, Context.MODE_PRIVATE)
    }

    /** False when the keystore was unavailable and credentials sit in plaintext. */
    val usingHardwareBackedStorage: Boolean get() = !fallbackOnly

    /**
     * A stable, random per-installation identity.
     *
     * Generated once and kept. Deliberately not derived from `ANDROID_ID`, an
     * IMEI or a serial number: those are spoofable, they survive a factory
     * reset, and two tablets from the same batch can collide on some vendor
     * builds. What Saarthi trusts is the *secret* it issues in response to this
     * claim, not the claim itself.
     */
    val installationId: String
        get() = preferences.getString(KEY_INSTALLATION_ID, null) ?: newInstallationId()

    private fun newInstallationId(): String {
        val bytes = ByteArray(24)
        SecureRandom().nextBytes(bytes)
        val generated = Base64.encodeToString(
            bytes,
            Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
        )
        preferences.edit().putString(KEY_INSTALLATION_ID, generated).apply()
        return generated
    }

    var deviceIdentifier: String?
        get() = preferences.getString(KEY_DEVICE_IDENTIFIER, null)
        set(value) = preferences.edit().putString(KEY_DEVICE_IDENTIFIER, value).apply()

    /** The long-lived credential. Exchanged for tokens; never sent on a socket. */
    var deviceSecret: String?
        get() = preferences.getString(KEY_DEVICE_SECRET, null)
        set(value) = preferences.edit().putString(KEY_DEVICE_SECRET, value).apply()

    /** Short-lived bearer token. Refreshed from the secret when it expires. */
    var accessToken: String?
        get() = preferences.getString(KEY_ACCESS_TOKEN, null)
        set(value) = preferences.edit().putString(KEY_ACCESS_TOKEN, value).apply()

    var accessTokenExpiresAt: Long
        get() = preferences.getLong(KEY_TOKEN_EXPIRES_AT, 0L)
        set(value) = preferences.edit().putLong(KEY_TOKEN_EXPIRES_AT, value).apply()

    /** The vehicle this terminal is fitted to, cached for the offline first paint. */
    var pairedVehicleId: String?
        get() = preferences.getString(KEY_VEHICLE_ID, null)
        set(value) = preferences.edit().putString(KEY_VEHICLE_ID, value).apply()

    var pairedRegistration: String?
        get() = preferences.getString(KEY_REGISTRATION, null)
        set(value) = preferences.edit().putString(KEY_REGISTRATION, value).apply()

    val hasCredentials: Boolean
        get() = !deviceIdentifier.isNullOrBlank() && !deviceSecret.isNullOrBlank()

    /**
     * A token that is still worth sending.
     *
     * Treated as expired sixty seconds early, so a request does not set off
     * with a token that dies in flight — on a truck's connection that is a
     * round trip wasted and a retry that looks like a fault.
     */
    fun validAccessToken(nowMs: Long = System.currentTimeMillis()): String? {
        val token = accessToken ?: return null
        return if (accessTokenExpiresAt - EXPIRY_GRACE_MS > nowMs) token else null
    }

    fun storeToken(token: String, expiresInSeconds: Int) {
        accessToken = token
        accessTokenExpiresAt = System.currentTimeMillis() + expiresInSeconds * 1_000L
    }

    fun clearToken() {
        preferences.edit().remove(KEY_ACCESS_TOKEN).remove(KEY_TOKEN_EXPIRES_AT).apply()
    }

    /**
     * A fresh installation id, for a terminal deliberately starting over.
     *
     * Required, not optional. Saarthi refuses to re-enrol an installation id
     * whose enrolment has been *claimed* — and it is right to: honouring that
     * would let anyone holding an installation id take over a paired unit. The
     * consequence is that a terminal which forgets its pairing and then asks to
     * enrol under the same id gets a 409 and is stranded on the setup screen
     * with no way forward, which is exactly what happened.
     *
     * Rotating is safe here because this only ever runs from a deliberate act
     * on the device itself. The cost is a spent enrolment row left behind; the
     * alternative was a tablet that could never be connected to anything again.
     */
    fun rotateInstallationId(): String {
        preferences.edit().remove(KEY_INSTALLATION_ID).apply()
        return installationId
    }

    /**
     * Forget the pairing, keeping the installation id.
     *
     * Callers starting over completely want [rotateInstallationId] as well —
     * see the note there about why re-enrolling under a claimed id is refused.
     */
    fun reset() {
        preferences.edit()
            .remove(KEY_DEVICE_IDENTIFIER)
            .remove(KEY_DEVICE_SECRET)
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_TOKEN_EXPIRES_AT)
            .remove(KEY_VEHICLE_ID)
            .remove(KEY_REGISTRATION)
            .apply()
    }

    private companion object {
        const val ENCRYPTED_FILE = "saarthi_terminal_identity"
        const val PLAIN_FILE = "saarthi_terminal_identity_fallback"

        const val KEY_INSTALLATION_ID = "installation_id"
        const val KEY_DEVICE_IDENTIFIER = "device_identifier"
        const val KEY_DEVICE_SECRET = "device_secret"
        const val KEY_ACCESS_TOKEN = "access_token"
        const val KEY_TOKEN_EXPIRES_AT = "access_token_expires_at"
        const val KEY_VEHICLE_ID = "vehicle_id"
        const val KEY_REGISTRATION = "registration"

        const val EXPIRY_GRACE_MS = 60_000L
    }
}
