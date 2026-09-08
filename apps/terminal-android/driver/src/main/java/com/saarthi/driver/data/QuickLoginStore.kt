package com.saarthi.driver.data

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.saarthi.core.util.DebugLog
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import android.util.Base64
import javax.crypto.SecretKeyFactory

/**
 * Saarthi Quick Login: the credential, and what protects it.
 *
 * The problem this solves is narrow and worth stating exactly. A driver's
 * refresh token lives for thirty days so they need not sign in every shift —
 * but a thirty-day credential the app can read unattended is a credential
 * anybody holding the unlocked phone can use, and one that arrives intact in
 * any copy of the app's data. Quick Login is what turns that convenience back
 * into something a person has to prove they are entitled to.
 *
 * **What actually protects the token.** It is encrypted with an AES key
 * generated inside `AndroidKeyStore` and marked non-exportable, so the key
 * material never exists in the app's process or in its files. Copying
 * `/data/data/com.saarthi.driver` to another handset therefore yields a
 * ciphertext and nothing that can open it — which is the device binding section
 * 16 asks for, obtained from the platform rather than invented.
 *
 * **What the PIN is.** A gate, not a key. Four digits is ten thousand
 * possibilities, so a key derived from it would be brute-forced in moments
 * offline no matter how many rounds of stretching were applied. Instead the PIN
 * is checked against a PBKDF2 verifier and the attempt counter is enforced
 * here; the *secrecy* comes from the Keystore key, and the PIN decides who is
 * allowed to ask it for something. That division is the whole design.
 *
 * **What biometrics are.** A second wrapping of the same token under a
 * different Keystore key, one declared to require user authentication. There
 * the platform enforces the check, not this class — and the key is destroyed if
 * the device's biometric enrolment changes, which is section 10 handled by
 * Android rather than by a policy we would have to remember to apply.
 *
 * The PIN never leaves the device, is never sent to the server, and is never
 * written anywhere in a recoverable form. Nor is it logged: there are no
 * `DebugLog` calls in this file that take a PIN, deliberately.
 */
class QuickLoginStore(context: Context) {

    private val preferences: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        FILE,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    /** Which quick-unlock methods this driver has turned on. */
    data class Enabled(val pin: Boolean, val biometrics: Boolean) {
        val any: Boolean get() = pin || biometrics
    }

    private val _enabled = MutableStateFlow(readEnabled())
    val enabled: StateFlow<Enabled> = _enabled.asStateFlow()

    /** Why an unlock attempt did not produce a session. */
    sealed interface Failure {
        data class WrongPin(val attemptsLeft: Int) : Failure

        /** Too many wrong PINs. Quick Login is gone; sign in normally. */
        data object LockedOut : Failure

        /** Try again in [seconds]. Enforced by a stored time, not a timer. */
        data class CoolingDown(val seconds: Long) : Failure

        /**
         * The stored credential could not be opened.
         *
         * The honest outcome when a Keystore key has been invalidated — a new
         * fingerprint enrolled, the screen lock removed — and the one case where
         * falling back quietly would be wrong. Quick Login is cleared and the
         * driver signs in normally, which section 10 requires.
         */
        data class Unavailable(val reason: String) : Failure
    }

    // -----------------------------------------------------------------------
    // Turning it on
    // -----------------------------------------------------------------------

    /**
     * Protect this driver's refresh token behind a PIN.
     *
     * The caller has just authenticated normally, so the token is genuinely
     * theirs. The plaintext is not retained: from here on the only copy is the
     * ciphertext, openable through the Keystore.
     */
    fun enablePin(pin: String, refreshToken: String): Boolean {
        if (QuickLoginPolicy.evaluate(pin) != QuickLoginPolicy.PinVerdict.Acceptable) return false

        return try {
            val salt = ByteArray(SALT_BYTES).also { SecureRandom().nextBytes(it) }
            val sealed = seal(keyFor(PIN_KEY_ALIAS, requireUserAuth = false), refreshToken)

            preferences.edit()
                .putString(KEY_PIN_VERIFIER, encode(derive(pin, salt)))
                .putString(KEY_PIN_SALT, encode(salt))
                .putString(KEY_PIN_TOKEN, sealed)
                .putInt(KEY_FAILURES, 0)
                .remove(KEY_COOLDOWN_UNTIL)
                .apply()

            _enabled.value = readEnabled()
            true
        } catch (error: Exception) {
            DebugLog.warn(TAG, "Could not enable PIN unlock: ${error.javaClass.simpleName}")
            false
        }
    }

    /**
     * The cipher a prompt must authorise before the token can be *sealed*.
     *
     * Turning biometrics on needs a prompt just as much as unlocking does, and
     * missing that was a real bug: the first version encrypted the moment the
     * driver flipped the switch, with no prompt in between. A key declared
     * `setUserAuthenticationRequired` refuses the operation until the platform
     * has seen a fingerprint, so enabling could never succeed — on any handset,
     * however many fingerprints were enrolled. It failed with "this phone would
     * not set that up", which pointed the blame in exactly the wrong direction.
     *
     * `init` is what succeeds without authentication; `doFinal` is what does
     * not. So the cipher is prepared here, authorised by the prompt, and used in
     * [sealWithBiometricCipher].
     */
    fun biometricEnrolCipher(): Cipher? = try {
        Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.ENCRYPT_MODE, keyFor(BIOMETRIC_KEY_ALIAS, requireUserAuth = true))
        }
    } catch (error: Exception) {
        DebugLog.warn(TAG, "Biometric key unavailable: ${error.javaClass.simpleName}")
        // A key left over from a previous enrolment is now useless. Clearing it
        // means the next attempt generates a fresh one rather than failing for
        // ever on a key the platform has already invalidated.
        deleteKey(BIOMETRIC_KEY_ALIAS)
        null
    }

    /**
     * Seal the credential with a cipher the prompt has just authorised.
     *
     * Nothing about the driver's fingerprint or face reaches this app — only
     * the fact that Android accepted one.
     */
    fun sealWithBiometricCipher(cipher: Cipher, refreshToken: String): Boolean = try {
        val body = cipher.doFinal(refreshToken.toByteArray(Charsets.UTF_8))
        preferences.edit()
            .putString(KEY_BIOMETRIC_TOKEN, "${encode(cipher.iv)}$SEPARATOR${encode(body)}")
            .apply()
        _enabled.value = readEnabled()
        true
    } catch (error: Exception) {
        DebugLog.warn(TAG, "Could not seal with biometrics: ${error.javaClass.simpleName}")
        false
    }

    /** Why the last biometric attempt failed, for a message worth reading. */
    @Volatile
    var lastBiometricProblem: String? = null
        private set

    // -----------------------------------------------------------------------
    // Getting back in
    // -----------------------------------------------------------------------

    /**
     * Exchange a PIN for the refresh token.
     *
     * Returns the token on success and a [Failure] otherwise. The token then
     * goes straight to the existing refresh endpoint — the PIN itself never
     * travels, and the server remains the thing that decides whether the
     * session is still valid.
     */
    fun unlockWithPin(pin: String): Result<String> {
        val until = preferences.getLong(KEY_COOLDOWN_UNTIL, 0L)
        val now = System.currentTimeMillis()
        if (now < until) {
            return Result.failure(
                QuickLoginException(Failure.CoolingDown((until - now + 999) / 1000)),
            )
        }

        val salt = preferences.getString(KEY_PIN_SALT, null)?.let(::decode)
        val verifier = preferences.getString(KEY_PIN_VERIFIER, null)
        val sealed = preferences.getString(KEY_PIN_TOKEN, null)

        if (salt == null || verifier == null || sealed == null) {
            return Result.failure(
                QuickLoginException(Failure.Unavailable("Quick Login is not set up on this phone.")),
            )
        }

        // Constant-time comparison. A verifier compared with `==` leaks how much
        // of a guess was right through timing, which over ten thousand
        // candidates is a real shortcut.
        if (!constantTimeEquals(encode(derive(pin, salt)), verifier)) {
            return Result.failure(QuickLoginException(recordFailure()))
        }

        return try {
            val token = open(keyFor(PIN_KEY_ALIAS, requireUserAuth = false), sealed)
            preferences.edit().putInt(KEY_FAILURES, 0).remove(KEY_COOLDOWN_UNTIL).apply()
            Result.success(token)
        } catch (error: Exception) {
            DebugLog.warn(TAG, "PIN credential could not be opened: ${error.javaClass.simpleName}")
            clear()
            Result.failure(
                QuickLoginException(
                    Failure.Unavailable("Quick Login is no longer available. Please sign in."),
                ),
            )
        }
    }

    /**
     * The cipher a biometric prompt must authorise before the token can be read.
     *
     * Handed to `BiometricPrompt` rather than used here, which is what makes the
     * platform the enforcer: an unauthorised cipher throws, and no amount of app
     * code can talk it into working.
     *
     * Null when the key has been invalidated — a fingerprint added or removed,
     * the screen lock changed. Quick Login is cleared in that case rather than
     * silently degrading, per section 10.
     */
    fun biometricCipher(): Cipher? {
        val sealed = preferences.getString(KEY_BIOMETRIC_TOKEN, null) ?: return null
        return try {
            val iv = decode(sealed.substringBefore(SEPARATOR))
            Cipher.getInstance(TRANSFORMATION).apply {
                init(
                    Cipher.DECRYPT_MODE,
                    keyFor(BIOMETRIC_KEY_ALIAS, requireUserAuth = true),
                    GCMParameterSpec(GCM_TAG_BITS, iv),
                )
            }
        } catch (error: Exception) {
            DebugLog.warn(TAG, "Biometric key unusable: ${error.javaClass.simpleName}")
            disableBiometrics()
            null
        }
    }

    /** Read the token using a cipher a biometric prompt has just authorised. */
    fun unlockWithBiometricCipher(cipher: Cipher): Result<String> {
        val sealed = preferences.getString(KEY_BIOMETRIC_TOKEN, null)
            ?: return Result.failure(
                QuickLoginException(Failure.Unavailable("Biometric unlock is not set up.")),
            )

        return try {
            val body = decode(sealed.substringAfter(SEPARATOR))
            Result.success(String(cipher.doFinal(body), Charsets.UTF_8))
        } catch (error: Exception) {
            DebugLog.warn(TAG, "Biometric credential unreadable: ${error.javaClass.simpleName}")
            disableBiometrics()
            Result.failure(
                QuickLoginException(
                    Failure.Unavailable("Biometric unlock is no longer available. Please sign in."),
                ),
            )
        }
    }

    // -----------------------------------------------------------------------
    // Turning it off
    // -----------------------------------------------------------------------

    /** Forget the PIN, keeping biometrics if the driver has them. */
    fun disablePin() {
        preferences.edit()
            .remove(KEY_PIN_VERIFIER)
            .remove(KEY_PIN_SALT)
            .remove(KEY_PIN_TOKEN)
            .putInt(KEY_FAILURES, 0)
            .remove(KEY_COOLDOWN_UNTIL)
            .apply()
        deleteKey(PIN_KEY_ALIAS)
        _enabled.value = readEnabled()
    }

    /** Forget biometrics, keeping the PIN if the driver has one. */
    fun disableBiometrics() {
        preferences.edit().remove(KEY_BIOMETRIC_TOKEN).apply()
        deleteKey(BIOMETRIC_KEY_ALIAS)
        _enabled.value = readEnabled()
    }

    /**
     * Remove Quick Login entirely.
     *
     * Called on sign-out and on lockout. The Keystore keys go too, so the stored
     * ciphertexts become permanently unopenable rather than merely orphaned —
     * there is no state in which a discarded credential could be revived.
     */
    fun clear() {
        preferences.edit().clear().apply()
        deleteKey(PIN_KEY_ALIAS)
        deleteKey(BIOMETRIC_KEY_ALIAS)
        _enabled.value = readEnabled()
    }

    // -----------------------------------------------------------------------

    /** Count a wrong PIN, and say what that means. */
    private fun recordFailure(): Failure {
        val failures = preferences.getInt(KEY_FAILURES, 0) + 1

        return when (val outcome = QuickLoginPolicy.outcomeAfter(failures)) {
            QuickLoginPolicy.AttemptOutcome.LockedOut -> {
                // Quick Login only. The account itself is untouched — a local
                // PIN failure must never cost somebody their shift.
                clear()
                Failure.LockedOut
            }

            is QuickLoginPolicy.AttemptOutcome.Remaining -> {
                val cooldown = QuickLoginPolicy.cooldownMillisAfter(failures)
                preferences.edit()
                    .putInt(KEY_FAILURES, failures)
                    .apply {
                        if (cooldown > 0) {
                            // A timestamp, so force-stopping the app does not
                            // reset the wait.
                            putLong(KEY_COOLDOWN_UNTIL, System.currentTimeMillis() + cooldown)
                        }
                    }
                    .apply()
                Failure.WrongPin(outcome.attemptsLeft)
            }
        }
    }

    private fun readEnabled() = Enabled(
        pin = preferences.getString(KEY_PIN_TOKEN, null) != null,
        biometrics = preferences.getString(KEY_BIOMETRIC_TOKEN, null) != null,
    )

    /**
     * A key that lives in the Keystore and cannot be taken out of it.
     *
     * `requireUserAuth` is what separates the two: the biometric key is refused
     * by the platform until a prompt succeeds, and is invalidated outright if
     * the device's biometric enrolment changes.
     */
    private fun keyFor(alias: String, requireUserAuth: Boolean): SecretKey {
        val keystore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keystore.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val spec = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .apply {
                if (requireUserAuth) {
                    setUserAuthenticationRequired(true)

                    /*
                     * Say *which* authentication, on the versions that ask.
                     *
                     * From API 30 the parameters are explicit: a timeout of 0
                     * means every single use needs a fresh authentication, and
                     * `AUTH_BIOMETRIC_STRONG` means a fingerprint or face —
                     * never the device PIN. Without this the key falls back to
                     * legacy behaviour that varies by manufacturer, which is
                     * precisely the sort of difference that shows up only on
                     * somebody else's handset.
                     */
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        setUserAuthenticationParameters(
                            0,
                            KeyProperties.AUTH_BIOMETRIC_STRONG,
                        )
                    }

                    // A new or removed fingerprint destroys this key, so a
                    // stranger who enrols their own finger cannot inherit the
                    // driver's session.
                    setInvalidatedByBiometricEnrollment(true)
                }
            }
            .build()

        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).apply {
            init(spec)
        }.generateKey()
    }

    private fun deleteKey(alias: String) {
        runCatching {
            KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(alias)
        }
    }

    /** `iv:ciphertext`, both base64. The IV is not secret and must not repeat. */
    private fun seal(key: SecretKey, plaintext: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key) }
        val body = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return "${encode(cipher.iv)}$SEPARATOR${encode(body)}"
    }

    private fun open(key: SecretKey, sealed: String): String {
        val iv = decode(sealed.substringBefore(SEPARATOR))
        val body = decode(sealed.substringAfter(SEPARATOR))
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        }
        return String(cipher.doFinal(body), Charsets.UTF_8)
    }

    /**
     * The PIN verifier.
     *
     * PBKDF2 with a high round count. It does not make a four-digit PIN
     * unguessable — nothing could — but it makes each guess cost something, and
     * the guesses are limited to five by the counter above. The real protection
     * is that the token itself is behind a key that never leaves the Keystore.
     */
    private fun derive(pin: String, salt: ByteArray): ByteArray =
        SecretKeyFactory.getInstance(PBKDF2)
            .generateSecret(PBEKeySpec(pin.toCharArray(), salt, PBKDF2_ROUNDS, 256))
            .encoded

    private fun constantTimeEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
        return diff == 0
    }

    private fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun decode(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)

    /** Carries a [Failure] out of the `Result` failures above. */
    class QuickLoginException(val failure: Failure) : Exception()

    private companion object {
        const val TAG = "QuickLogin"
        const val FILE = "saarthi-driver-quick-login"
        const val KEYSTORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val PBKDF2 = "PBKDF2WithHmacSHA256"
        const val PBKDF2_ROUNDS = 120_000
        const val GCM_TAG_BITS = 128
        const val SALT_BYTES = 16
        const val SEPARATOR = ":"

        const val PIN_KEY_ALIAS = "saarthi.driver.quicklogin.pin"
        const val BIOMETRIC_KEY_ALIAS = "saarthi.driver.quicklogin.biometric"

        const val KEY_PIN_VERIFIER = "pin_verifier"
        const val KEY_PIN_SALT = "pin_salt"
        const val KEY_PIN_TOKEN = "pin_token"
        const val KEY_BIOMETRIC_TOKEN = "biometric_token"
        const val KEY_FAILURES = "failures"
        const val KEY_COOLDOWN_UNTIL = "cooldown_until"
    }
}
