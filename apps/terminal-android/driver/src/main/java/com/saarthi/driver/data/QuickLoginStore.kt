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
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
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
     * Whether this handset can hold a biometric-protected credential at all.
     *
     * Cheap to ask and worth asking before the prompt: a phone with no secure
     * hardware, or one whose key the platform has already invalidated, should
     * say so rather than showing a fingerprint dialog that cannot lead anywhere.
     */
    fun biometricsUsable(): Boolean = biometricPublicKey() != null

    /**
     * Seal the credential so that only a fingerprint can open it again.
     *
     * No prompt, and no `Cipher` handed in — and that is the whole point of the
     * key pair. **Encryption uses the public half, which the platform never
     * gates**; only the private half carries `setUserAuthenticationRequired`.
     *
     * This is not a convenience. The refresh token *rotates on every use* — the
     * server issues a new one and kills the old, deliberately, so a stolen token
     * is single-use. With the old symmetric key the app could not write a new
     * value without another fingerprint, so it never did: the sealed copy was
     * whatever the token had been at enrolment, and the first unlock rotated it
     * into uselessness. Every unlock after that replayed a dead token and the
     * driver was told their session had expired. Being able to re-seal silently
     * is what makes a rotating credential and a biometric lock coexist.
     */
    fun sealWithBiometric(refreshToken: String): Boolean = try {
        val key = biometricPublicKey()
        if (key == null) {
            false
        } else {
            val cipher = Cipher.getInstance(RSA_TRANSFORMATION).apply {
                init(Cipher.ENCRYPT_MODE, key, oaep())
            }
            val body = cipher.doFinal(refreshToken.toByteArray(Charsets.UTF_8))
            preferences.edit().putString(KEY_BIOMETRIC_TOKEN, encode(body)).apply()
            _enabled.value = readEnabled()
            true
        }
    } catch (error: Exception) {
        DebugLog.warn(TAG, "Could not seal with biometrics: ${error.javaClass.simpleName}")
        false
    }

    /**
     * Write a freshly-rotated credential into whichever slots are turned on.
     *
     * Called after every successful refresh while Quick Login holds custody.
     * Silent by design: the PIN key was always declared without a user-auth
     * requirement, and the biometric key's public half needs none, so neither
     * slot interrupts a driver mid-shift to stay current.
     *
     * A slot that fails to re-seal is turned off rather than left holding a
     * token known to be dead — an unlock that cannot possibly work is worse than
     * a switch that is visibly off.
     *
     * Returns whether a sealed copy of this token now exists. False means every
     * slot is empty and the caller still holds the only copy — which the account
     * store needs to know, because until it did it handed rotations to a
     * custodian that dropped them and kept nothing readable in their place.
     */
    fun reseal(refreshToken: String): Boolean {
        var held = false

        if (preferences.getString(KEY_PIN_TOKEN, null) != null) {
            val sealed = runCatching {
                seal(keyFor(PIN_KEY_ALIAS, requireUserAuth = false), refreshToken)
            }.getOrNull()
            if (sealed != null) {
                preferences.edit().putString(KEY_PIN_TOKEN, sealed).apply()
                held = true
            } else {
                DebugLog.warn(TAG, "Could not re-seal the PIN credential; turning it off")
                disablePin()
            }
        }

        if (preferences.getString(KEY_BIOMETRIC_TOKEN, null) != null) {
            if (sealWithBiometric(refreshToken)) {
                held = true
            } else {
                DebugLog.warn(TAG, "Could not re-seal the biometric credential; turning it off")
                disableBiometrics()
            }
        }

        return held
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
        if (preferences.getString(KEY_BIOMETRIC_TOKEN, null) == null) return null
        return try {
            val key = biometricPrivateKey() ?: return null
            Cipher.getInstance(RSA_TRANSFORMATION).apply {
                init(Cipher.DECRYPT_MODE, key, oaep())
            }
        } catch (error: Exception) {
            /*
             * Say so, rather than returning an unexplained null.
             *
             * This is the state a driver actually hits: the key is gone or
             * refuses to initialise — most often because the phone's fingerprint
             * enrolment changed, which `setInvalidatedByBiometricEnrollment`
             * deliberately destroys the key for. The slot is switched off here,
             * correctly. What was missing was telling anybody: the caller got
             * `null`, showed no prompt and no message, and left the driver
             * looking at a fingerprint button that did nothing.
             */
            DebugLog.warn(TAG, "Biometric key unusable: ${error.javaClass.simpleName}")
            lastBiometricProblem =
                "Fingerprint unlock is no longer set up on this phone. " +
                    "Sign in with your password and you can turn it on again."
            disableBiometrics()
            null
        }
    }

    /**
     * Take the last biometric problem, once.
     *
     * Cleared on read so a message explains the attempt that produced it and
     * does not resurface later attached to something else.
     */
    fun takeBiometricProblem(): String? {
        val problem = lastBiometricProblem
        lastBiometricProblem = null
        return problem
    }

    fun unlockWithBiometricCipher(cipher: Cipher): Result<String> {
        val sealed = preferences.getString(KEY_BIOMETRIC_TOKEN, null)
            ?: return Result.failure(
                QuickLoginException(Failure.Unavailable("Nothing is sealed on this phone.")),
            )

        return try {
            val token = String(cipher.doFinal(decode(sealed)), Charsets.UTF_8)
            Result.success(token)
        } catch (error: Exception) {
            /*
             * A failure here is the key, not the finger.
             *
             * Android has already accepted the fingerprint by the time this
             * runs — the prompt would not have handed back an authorised cipher
             * otherwise. So anything that goes wrong now is the sealed value
             * being unreadable, and the honest response is to turn the slot off
             * and let the driver sign in rather than to blame their finger.
             */
            DebugLog.warn(TAG, "Sealed credential unreadable: ${error.javaClass.simpleName}")
            lastBiometricProblem = "That did not open. Please sign in with your password."
            disableBiometrics()
            Result.failure(
                QuickLoginException(
                    Failure.Unavailable("The sealed credential could not be opened."),
                ),
            )
        }
    }

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

    private fun readEnabled(): Enabled {
        /*
         * Retire a credential sealed by the previous scheme.
         *
         * The old biometric slot was a symmetric key and stored `iv:ciphertext`;
         * the new one is a key pair and stores ciphertext alone. A separator is
         * therefore a reliable marker of the old format, and the old format
         * cannot be read by the new key — nor is it worth trying, because that
         * copy is a token the server rotated away long ago.
         *
         * Cleared rather than left in place so the switch reads as off and the
         * driver is invited to turn it back on, instead of a fingerprint prompt
         * that could only ever fail.
         */
        var biometric = preferences.getString(KEY_BIOMETRIC_TOKEN, null)

        /*
         * Retire anything sealed by a key that cannot open it.
         *
         * The v1 key pair asked for a padding the Keystore would not perform
         * with the digests it had been given, so it sealed happily and refused
         * every decrypt. Its presence is the marker: if that alias still exists,
         * whatever is sealed came from it and is unreadable.
         *
         * Cleared here rather than through `disableBiometrics` for the same
         * reason as below — this runs from the constructor, before `_enabled`
         * exists.
         */
        if (biometric != null && keyExists(BIOMETRIC_KEY_ALIAS_V1)) {
            DebugLog.debug(TAG, "Retiring a biometric credential sealed by the v1 key")
            preferences.edit().remove(KEY_BIOMETRIC_TOKEN).apply()
            deleteKey(BIOMETRIC_KEY_ALIAS_V1)
            biometric = null
        }
        if (keyExists(BIOMETRIC_KEY_ALIAS_V1)) deleteKey(BIOMETRIC_KEY_ALIAS_V1)

        if (biometric != null && biometric.contains(SEPARATOR)) {
            DebugLog.debug(TAG, "Retiring a biometric credential sealed by the old scheme")
            /*
             * Cleared here rather than through `disableBiometrics`.
             *
             * This function runs from the constructor, to give `_enabled` its
             * first value — so anything that assigns `_enabled` from inside it
             * dereferences a field that does not exist yet. That is exactly what
             * calling `disableBiometrics` did, and it crashed the app on launch
             * for every driver who had the old scheme enabled.
             */
            preferences.edit().remove(KEY_BIOMETRIC_TOKEN).apply()
            deleteKey(BIOMETRIC_KEY_ALIAS)
            biometric = null
        }

        return Enabled(
            pin = preferences.getString(KEY_PIN_TOKEN, null) != null,
            biometrics = biometric != null,
        )
    }

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

    /**
     * The half that seals, which the platform never gates.
     *
     * Re-created through a `KeyFactory` from the certificate's encoding rather
     * than used as it comes out of the Keystore. A public key still attached to
     * a Keystore entry drags the entry's authentication requirement along with
     * it on several manufacturers' builds, and encryption then fails with
     * "user not authenticated" — the exact failure the key pair exists to avoid.
     * The encoded form is just bytes, and bytes have no policy.
     */
    private fun biometricPublicKey(): java.security.PublicKey? = try {
        val entry = biometricEntry()
        entry?.let {
            val raw = it.certificate.publicKey
            KeyFactory.getInstance(raw.algorithm)
                .generatePublic(X509EncodedKeySpec(raw.encoded))
        }
    } catch (error: Exception) {
        DebugLog.warn(TAG, "Biometric key unavailable: ${error.javaClass.simpleName}")
        null
    }

    /** The half that opens, and the only half a fingerprint is needed for. */
    private fun biometricPrivateKey(): PrivateKey? =
        runCatching { biometricEntry()?.privateKey }.getOrNull()

    /**
     * The biometric key pair, generated on first use.
     *
     * RSA rather than AES, and that choice is the fix. A symmetric key declared
     * `setUserAuthenticationRequired` gates *every* operation, so the app could
     * not write a rotated token without another prompt. A key pair separates the
     * two halves: sealing is unauthenticated, opening is not.
     */
    private fun biometricEntry(): KeyStore.PrivateKeyEntry? {
        val keystore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        val existing = runCatching { keystore.getEntry(BIOMETRIC_KEY_ALIAS, null) }.getOrNull()
        (existing as? KeyStore.PrivateKeyEntry)?.let { return it }

        // An alias left over from the symmetric scheme. Generating over the top
        // of it works on most builds and not on all, so it goes first.
        if (existing != null || keystore.containsAlias(BIOMETRIC_KEY_ALIAS)) {
            deleteKey(BIOMETRIC_KEY_ALIAS)
        }

        val spec = KeyGenParameterSpec.Builder(
            BIOMETRIC_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            /*
             * Both digests, and the second one is the fix.
             *
             * OAEP uses two: the message digest, and the one inside MGF1. This
             * key authorised SHA-256 alone, while the padding below asked for
             * MGF1-SHA256 — and the Keystore permits only MGF1-SHA1 unless the
             * MGF1 digest is authorised outright.
             *
             * The failure that produced was silent and one-sided. Sealing uses
             * the *public* half, which is ordinary software RSA and honours any
             * padding it is handed, so turning fingerprint unlock on appeared to
             * work and wrote a sealed token. Opening it uses the private half
             * inside the Keystore, where the restriction is real: `Cipher.init`
             * was refused before a prompt could even be raised. A driver
             * enabled the fingerprint, reopened the app, and got no prompt at
             * all.
             *
             * SHA-1 here is the MGF1 digest, not the message digest. MGF1's
             * security does not rest on collision resistance, so SHA-1 in that
             * position is not the weakness it would be elsewhere — and it is the
             * combination Android Keystore has always accepted.
             */
            .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
            .setKeySize(2048)
            .setUserAuthenticationRequired(true)
            .apply {
                /*
                 * Say *which* authentication, on the versions that ask.
                 *
                 * A timeout of 0 means every single use of the private half
                 * needs a fresh authentication, and `AUTH_BIOMETRIC_STRONG`
                 * means a fingerprint or face — never the device PIN. Without
                 * this the key falls back to legacy behaviour that varies by
                 * manufacturer.
                 */
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
                }

                // A new or removed fingerprint destroys this key, so a stranger
                // who enrols their own finger cannot inherit the session.
                setInvalidatedByBiometricEnrollment(true)
            }
            .build()

        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, KEYSTORE).apply {
            initialize(spec)
        }.generateKeyPair()

        return KeyStore.getInstance(KEYSTORE).apply { load(null) }
            .getEntry(BIOMETRIC_KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
    }

    /**
     * OAEP, spelled out — and spelled the way the Keystore will accept.
     *
     * Android's Keystore reads the message digest from the transformation
     * string but assumes MGF1-SHA1 regardless, so the two sides must be named
     * explicitly or an encrypt and a decrypt that look identical disagree about
     * the padding.
     *
     * MGF1 is SHA-1 rather than SHA-256, and that is not a compromise made for
     * convenience. A hardware key will only perform a padding it was authorised
     * for, and MGF1-SHA256 requires authorising the MGF1 digest separately —
     * something only later platform versions can even express. Asking for it on
     * a key that cannot do it is how this failed: refused at `Cipher.init`,
     * before any fingerprint prompt could appear.
     *
     * The message digest stays SHA-256. MGF1 is a mask generator, not a
     * commitment, so SHA-1 in that position carries none of the weakness it
     * would as a message digest.
     */
    private fun oaep() = OAEPParameterSpec(
        "SHA-256",
        "MGF1",
        MGF1ParameterSpec.SHA1,
        PSource.PSpecified.DEFAULT,
    )

    private fun keyExists(alias: String): Boolean = runCatching {
        KeyStore.getInstance(KEYSTORE).apply { load(null) }.containsAlias(alias)
    }.getOrDefault(false)

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
        const val RSA_TRANSFORMATION = "RSA/ECB/OAEPPadding"
        const val PBKDF2 = "PBKDF2WithHmacSHA256"
        const val PBKDF2_ROUNDS = 120_000
        const val GCM_TAG_BITS = 128
        const val SALT_BYTES = 16
        const val SEPARATOR = ":"

        const val PIN_KEY_ALIAS = "saarthi.driver.quicklogin.pin"
        /**
         * Bumped, because the keys before it could seal and never open.
         *
         * A key already in the Keystore carries the digests it was created
         * with, so correcting the padding above does nothing for a driver who
         * had already switched fingerprint unlock on. A new alias abandons
         * those keys; `readEnabled` clears the tokens they sealed, so the slot
         * reads off and the driver is invited to turn it back on rather than
         * meeting a prompt that cannot work.
         */
        const val BIOMETRIC_KEY_ALIAS = "saarthi.driver.quicklogin.biometric.v2"

        /** The alias that could seal and never open. Deleted on sight. */
        const val BIOMETRIC_KEY_ALIAS_V1 = "saarthi.driver.quicklogin.biometric"

        const val KEY_PIN_VERIFIER = "pin_verifier"
        const val KEY_PIN_SALT = "pin_salt"
        const val KEY_PIN_TOKEN = "pin_token"
        const val KEY_BIOMETRIC_TOKEN = "biometric_token"
        const val KEY_FAILURES = "failures"
        const val KEY_COOLDOWN_UNTIL = "cooldown_until"
    }
}
