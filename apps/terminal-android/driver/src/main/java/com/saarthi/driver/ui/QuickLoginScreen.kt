package com.saarthi.driver.ui

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import com.saarthi.core.ui.TerminalPage
import com.saarthi.driver.data.QuickLoginPolicy
import com.saarthi.driver.data.QuickLoginStore

/**
 * Saarthi Quick Login: getting back in.
 *
 * What a driver sees when they reopen the app with a PIN or biometrics enabled.
 * Their session is intact — this is not a sign-in — but the credential proving
 * it is sealed behind a Keystore key, and one of the two methods has to open it.
 *
 * Biometrics are offered first and attempted automatically when available,
 * because a driver climbing into a cab has one hand free at best. The PIN sits
 * underneath as the thing that always works: sensors fail in the wet, in gloves,
 * and on cheap handsets.
 *
 * The way out is always visible. "Use password instead" is not a fallback of
 * last resort but a first-class option — a driver who has forgotten their PIN
 * must never be stuck on this screen, because the alternative is a shift lost
 * to a four-digit number.
 */
@Composable
fun QuickLoginScreen(
    viewModel: DriverViewModel,
    methods: QuickLoginStore.Enabled,
) {
    val context = LocalContext.current
    val busy by viewModel.busy.collectAsState()
    val error by viewModel.error.collectAsState()

    var pin by remember { mutableStateOf("") }
    var biometricTried by remember { mutableStateOf(false) }

    val biometricUsable = methods.biometrics && biometricsAvailable(context)

    /*
     * Offer the fingerprint without being asked, once.
     *
     * Once, and not on every recomposition: a prompt that reappears each time
     * the driver dismisses it is a prompt they cannot get past to reach the PIN.
     */
    LaunchedEffect(biometricUsable) {
        if (biometricUsable && !biometricTried) {
            biometricTried = true
            promptForBiometric(context, viewModel)
        }
    }

    TerminalPage {
        Text(
            "Welcome back",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Text(
            "Unlock Saarthi to carry on.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(28.dp))

        if (busy) {
            CircularProgressIndicator()
            Spacer(Modifier.height(8.dp))
            Text(
                "Restoring your session…",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            return@TerminalPage
        }

        if (methods.pin) {
            // Filled dots, never the digits. A PIN readable over a driver's
            // shoulder in a queue is a PIN somebody else knows.
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
            ) {
                repeat(QuickLoginPolicy.PIN_LENGTH) { index ->
                    Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) {
                        Surface(
                            shape = CircleShape,
                            color = if (index < pin.length) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.outlineVariant
                            },
                            modifier = Modifier.size(if (index < pin.length) 14.dp else 10.dp),
                        ) {}
                    }
                    Spacer(Modifier.size(10.dp))
                }
            }

            Spacer(Modifier.height(20.dp))

            PinKeypad(
                onDigit = { digit ->
                    if (pin.length < QuickLoginPolicy.PIN_LENGTH) {
                        pin += digit
                        if (pin.length == QuickLoginPolicy.PIN_LENGTH) {
                            viewModel.unlockWithPin(pin)
                            pin = ""
                        }
                    }
                },
                onBackspace = { pin = pin.dropLast(1) },
            )
        }

        if (biometricUsable) {
            Spacer(Modifier.height(16.dp))
            OutlinedButton(
                onClick = { promptForBiometric(context, viewModel) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Use fingerprint or face")
            }
        }

        error?.let { message ->
            Spacer(Modifier.height(14.dp))
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
        }

        Spacer(Modifier.height(20.dp))

        TextButton(
            onClick = viewModel::signOut,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Use password instead")
        }
    }
}

/**
 * A numeric keypad, rather than a text field.
 *
 * A keyboard would offer autocorrect, a clipboard, a suggestion strip and a
 * dozen other places four digits could end up. It is also slower with one hand.
 */
@Composable
private fun PinKeypad(
    onDigit: (Char) -> Unit,
    onBackspace: () -> Unit,
) {
    val rows = listOf("123", "456", "789")

    for (row in rows) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            for (digit in row) {
                Button(
                    onClick = { onDigit(digit) },
                    modifier = Modifier.weight(1f).height(56.dp),
                ) {
                    Text(digit.toString(), style = MaterialTheme.typography.titleLarge)
                }
            }
        }
        Spacer(Modifier.height(10.dp))
    }

    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // An empty cell keeps the zero under the eight, where a phone keypad
        // puts it and where a thumb expects it.
        Spacer(Modifier.weight(1f))
        Button(
            onClick = { onDigit('0') },
            modifier = Modifier.weight(1f).height(56.dp),
        ) {
            Text("0", style = MaterialTheme.typography.titleLarge)
        }
        OutlinedButton(
            onClick = onBackspace,
            modifier = Modifier.weight(1f).height(56.dp),
        ) {
            Text("⌫")
        }
    }
}

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
    val activity = context as? FragmentActivity ?: return
    val cipher = viewModel.biometricCipher() ?: return

    val prompt = BiometricPrompt(
        activity,
        androidx.core.content.ContextCompat.getMainExecutor(context),
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
            .setTitle("Unlock Saarthi")
            .setSubtitle("Use your fingerprint or face to carry on")
            // No "use device PIN" button: the credential is bound to a
            // biometric key, so the device passcode cannot open it and offering
            // it would be a button that always failed.
            .setNegativeButtonText("Use Saarthi PIN")
            .build(),
        BiometricPrompt.CryptoObject(cipher),
    )
}

/**
 * Ask Android to verify the driver so a key may be used to *seal*.
 *
 * The mirror of the unlock prompt. `onResult` gets the authorised cipher, or
 * null when the driver dismissed it — a cancellation is a decision, not an
 * error, and it must not leave the toggle looking broken.
 */
internal fun promptToEnrolBiometric(
    context: Context,
    cipher: javax.crypto.Cipher,
    onResult: (javax.crypto.Cipher?) -> Unit,
) {
    val activity = context as? FragmentActivity ?: return onResult(null)

    val prompt = BiometricPrompt(
        activity,
        androidx.core.content.ContextCompat.getMainExecutor(context),
        object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                onResult(result.cryptoObject?.cipher)
            }

            override fun onAuthenticationError(code: Int, message: CharSequence) = onResult(null)
        },
    )

    prompt.authenticate(
        BiometricPrompt.PromptInfo.Builder()
            .setTitle("Set up fingerprint unlock")
            .setSubtitle("Confirm it is you, and Saarthi will remember this phone")
            .setNegativeButtonText("Cancel")
            .build(),
        BiometricPrompt.CryptoObject(cipher),
    )
}
