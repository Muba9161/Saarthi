package com.saarthi.driver.ui.auth

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.saarthi.driver.R
import com.saarthi.driver.ui.DriverViewModel

/**
 * Whether the device can actually do a strong biometric right now.
 *
 * `BIOMETRIC_STRONG` only. A weak biometric cannot be bound to a Keystore key,
 * so accepting one would mean a prompt that succeeded and then a decryption
 * that failed — the worst of both, and confusing to diagnose from a cab.
 */
internal fun biometricsAvailable(context: Context): Boolean =
    BiometricManager.from(context)
        .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
        BiometricManager.BIOMETRIC_SUCCESS

/**
 * Ask Android to verify the driver, and hand the result back.
 *
 * Saarthi never sees a fingerprint. It passes a cipher the platform will only
 * initialise after a successful prompt, and receives that cipher back — so the
 * *device* enforces the check and no amount of app code can talk it into
 * skipping one.
 */
internal fun promptForBiometric(context: Context, viewModel: DriverViewModel) {
    val activity = context as? FragmentActivity ?: run {
        viewModel.reportBiometricUnavailable()
        return
    }

    /*
     * A null cipher is not nothing happening.
     *
     * Whatever the cause — an invalidated key, no enrolled finger — the driver
     * must be told and pointed at the PIN or their password, rather than left
     * looking at a button that does nothing.
     */
    val cipher = viewModel.biometricCipher() ?: run {
        viewModel.reportBiometricUnavailable()
        return
    }

    val prompt = BiometricPrompt(
        activity,
        ContextCompat.getMainExecutor(context),
        object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                result.cryptoObject?.cipher?.let(viewModel::unlockWithBiometric)
            }

            // A cancellation is not a failure worth a message: the driver
            // dismissed it and the PIN is on screen behind it.
            override fun onAuthenticationError(code: Int, message: CharSequence) = Unit
        },
    )

    prompt.authenticate(
        BiometricPrompt.PromptInfo.Builder()
            .setTitle(context.getString(R.string.biometric_unlock_title))
            .setSubtitle(context.getString(R.string.biometric_unlock_sub))
            // No "use device PIN" button: the credential is bound to a
            // biometric key, so the device passcode cannot open it and offering
            // it would be a button that always failed.
            .setNegativeButtonText(context.getString(R.string.biometric_use_pin))
            .build(),
        BiometricPrompt.CryptoObject(cipher),
    )
}

/**
 * Ask Android to confirm the driver before biometrics is switched on.
 *
 * No `CryptoObject`: sealing uses the public half of a key pair, which the
 * platform never gates, so this prompt is consent rather than cryptography. It
 * still earns its place — a switch that says "fingerprint unlock is on" should
 * not be believable until the phone has recognised a fingerprint once.
 *
 * `onResult(false)` for a cancellation. A driver who backs out has made a
 * decision, not hit an error, and the toggle must not be left looking broken.
 */
internal fun promptToEnrolBiometric(
    context: Context,
    onResult: (Boolean) -> Unit,
) {
    val activity = context as? FragmentActivity ?: return onResult(false)

    val prompt = BiometricPrompt(
        activity,
        ContextCompat.getMainExecutor(context),
        object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                onResult(true)
            }

            override fun onAuthenticationError(code: Int, message: CharSequence) = onResult(false)
        },
    )

    prompt.authenticate(
        BiometricPrompt.PromptInfo.Builder()
            .setTitle(context.getString(R.string.biometric_setup_title))
            .setSubtitle(context.getString(R.string.biometric_setup_sub))
            .setNegativeButtonText(context.getString(R.string.action_cancel))
            .build(),
    )
}

/**
 * Turn biometrics on: prove it is them, then seal.
 *
 * The same order the settings switch and the Quick Login offer both need, so it
 * lives once. [onDone] carries a sentence for the driver either way, as a
 * string resource so it reads in their language.
 */
internal fun enrolBiometric(
    context: Context,
    viewModel: DriverViewModel,
    onDone: (enabled: Boolean, message: Int) -> Unit,
) {
    if (!viewModel.biometricsUsable()) {
        onDone(false, R.string.biometric_no_key)
        return
    }
    promptToEnrolBiometric(context) { confirmed ->
        if (!confirmed) {
            onDone(false, R.string.biometric_cancelled)
        } else {
            viewModel.completeBiometricSetup { ok ->
                onDone(ok, if (ok) R.string.biometric_on else R.string.biometric_not_saved)
            }
        }
    }
}
