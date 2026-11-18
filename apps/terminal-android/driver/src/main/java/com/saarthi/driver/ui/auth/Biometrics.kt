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
 * Only for the one last unlock of a credential the retired Quick Login sealed
 * (see `DriverViewModel.Stage.Locked`). App lock uses `ui.lock.confirmPerson`.
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
