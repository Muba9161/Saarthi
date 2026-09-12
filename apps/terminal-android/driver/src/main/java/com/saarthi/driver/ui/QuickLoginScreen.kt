package com.saarthi.driver.ui

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Backspace
import androidx.compose.material.icons.rounded.Fingerprint
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import com.saarthi.driver.data.QuickLoginPolicy
import com.saarthi.driver.data.QuickLoginStore
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.BrandMark
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.Ember
import com.saarthi.driver.ui.design.EmberBright
import com.saarthi.driver.ui.design.FleetEnter
import com.saarthi.driver.ui.design.FleetError
import com.saarthi.driver.ui.design.FleetMono
import com.saarthi.driver.ui.design.FleetMotion
import com.saarthi.driver.ui.design.FleetOutlineButton
import com.saarthi.driver.ui.design.FleetScreen
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.FleetTextButton
import com.saarthi.driver.ui.design.FleetWorking
import com.saarthi.driver.ui.design.Hairline
import com.saarthi.driver.ui.design.Onyx
import com.saarthi.driver.ui.design.OnyxDeep
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.stillOr

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

    /*
     * The live state, not the snapshot this screen was opened with.
     *
     * `Stage.Locked` carries the methods as they were when the stage was set.
     * If an unlock attempt then discovers the biometric key is gone and turns
     * the slot off, that snapshot still says it is on — so the screen kept
     * offering a fingerprint button that could no longer do anything. Reading
     * the store's own flow means the offer disappears the moment it stops being
     * true, and the driver is left looking at the PIN pad instead of at a
     * control that ignores them.
     */
    val live by viewModel.quickLoginMethods.collectAsState()
    /*
     * Once the store has spoken, believe it — including when it says nothing is
     * enabled any more. An earlier version fell back to the snapshot whenever
     * the live value was empty, which is precisely the case this exists for:
     * the last method had just been switched off, and the screen went on
     * offering it.
     */
    var heard by remember { mutableStateOf(false) }
    LaunchedEffect(live) { heard = true }
    val methods = if (heard) live else methods

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

    FleetScreen {
        Spacer(Modifier.height(FleetSpace.wide))

        FleetEnter(index = 0) {
            Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                BrandMark(size = 64.dp)
                Spacer(Modifier.height(FleetSpace.base))
                Text(
                    "Welcome back",
                    style = MaterialTheme.typography.headlineMedium,
                    color = Chalk,
                )
                Spacer(Modifier.height(FleetSpace.hair))
                Text(
                    "Unlock Saarthi to carry on.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = Ash,
                )
            }
        }

        Spacer(Modifier.height(FleetSpace.section))

        if (busy) {
            FleetWorking("Restoring your session…")
            Spacer(Modifier.height(FleetSpace.wide))
            return@FleetScreen
        }

        if (methods.pin) {
            FleetEnter(index = 1) {
                // Filled dots, never the digits. A PIN readable over a driver's
                // shoulder in a queue is a PIN somebody else knows.
                PinDots(entered = pin.length, length = QuickLoginPolicy.PIN_LENGTH)
            }

            Spacer(Modifier.height(FleetSpace.section))

            FleetEnter(index = 2) {
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
        }

        if (biometricUsable) {
            Spacer(Modifier.height(FleetSpace.base))
            FleetEnter(index = 3) {
                FleetOutlineButton(
                    label = "Use fingerprint or face",
                    icon = Icons.Rounded.Fingerprint,
                    tint = EmberBright,
                    onClick = { promptForBiometric(context, viewModel) },
                )
            }
        }

        error?.let { message ->
            Spacer(Modifier.height(FleetSpace.base))
            FleetError(message)
        }

        Spacer(Modifier.height(FleetSpace.base))

        FleetTextButton(
            label = "Use password instead",
            tint = Ash,
            onClick = viewModel::signOut,
        )

        Spacer(Modifier.height(FleetSpace.wide))
    }
}

/**
 * How much of the PIN is in.
 *
 * A filled dot grows as well as changing colour, so the count is readable
 * without relying on the difference between orange and grey — which is exactly
 * the difference a driver in direct sunlight cannot see.
 */
@Composable
private fun PinDots(entered: Int, length: Int) {
    Row(
        Modifier
            .fillMaxWidth()
            .semantics { contentDescription = "$entered of $length digits entered" },
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(length) { index ->
            val filled = index < entered
            val size by animateFloatAsState(
                targetValue = if (filled) 16f else 11f,
                animationSpec = FleetMotion.enter(stillOr(FleetMotion.INSTANT)),
                label = "pin-dot",
            )
            Box(Modifier.size(34.dp), contentAlignment = Alignment.Center) {
                Box(
                    Modifier
                        .size(size.dp)
                        .clip(CircleShape)
                        .background(if (filled) Ember else OnyxDeep)
                        .border(
                            1.dp,
                            if (filled) EmberBright else Hairline,
                            CircleShape,
                        ),
                )
            }
        }
    }
}

/**
 * A numeric keypad, rather than a text field.
 *
 * A keyboard would offer autocorrect, a clipboard, a suggestion strip and a
 * dozen other places four digits could end up. It is also slower with one hand,
 * which is the hand a driver climbing into a cab has free.
 */
@Composable
private fun PinKeypad(
    onDigit: (Char) -> Unit,
    onBackspace: () -> Unit,
) {
    val rows = listOf("123", "456", "789")

    Column(verticalArrangement = Arrangement.spacedBy(FleetSpace.snug)) {
        for (row in rows) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(FleetSpace.snug),
            ) {
                for (digit in row) {
                    KeypadKey(
                        label = digit.toString(),
                        modifier = Modifier.weight(1f),
                        onClick = { onDigit(digit) },
                    )
                }
            }
        }

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(FleetSpace.snug),
        ) {
            // An empty cell keeps the zero under the eight, where a phone keypad
            // puts it and where a thumb expects it.
            Spacer(Modifier.weight(1f))
            KeypadKey(
                label = "0",
                modifier = Modifier.weight(1f),
                onClick = { onDigit('0') },
            )
            KeypadKey(
                label = null,
                icon = Icons.AutoMirrored.Rounded.Backspace,
                describedAs = "Delete the last digit",
                modifier = Modifier.weight(1f),
                onClick = onBackspace,
            )
        }
    }
}

/**
 * One key.
 *
 * Square-ish and large — the whole cell is the target, not the glyph inside it.
 * Monospaced digits so the row does not shift by a pixel between a 1 and a 8.
 */
@Composable
private fun KeypadKey(
    label: String?,
    modifier: Modifier = Modifier,
    icon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    // Not named `contentDescription`: that is also the name of the semantics
    // property set below, and the parameter wins the lookup inside the lambda.
    describedAs: String? = null,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .aspectRatio(1.55f)
            .clip(CircleShape)
            .background(Onyx)
            .border(1.dp, Hairline, CircleShape)
            .pressable(scaleTo = 0.93f, onClick = onClick)
            .then(
                describedAs?.let { spoken ->
                    Modifier.semantics { contentDescription = spoken }
                } ?: Modifier,
            ),
        contentAlignment = Alignment.Center,
    ) {
        when {
            icon != null -> Icon(
                icon,
                contentDescription = null,
                tint = Ash,
                modifier = Modifier.size(22.dp),
            )
            label != null -> Text(
                label,
                fontFamily = FleetMono,
                fontSize = 26.sp,
                fontWeight = FontWeight.Bold,
                color = Chalk,
            )
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
    val activity = context as? FragmentActivity ?: run {
        viewModel.reportBiometricUnavailable()
        return
    }

    /*
     * A null cipher is not nothing happening.
     *
     * Both of these used to be a bare `return`, and that is the whole of the
     * "the fingerprint prompt never comes and it is stuck" report: the key had
     * been invalidated, no dialog could be raised, and the app said nothing at
     * all. Whatever the cause, the driver must be told and pointed at the PIN
     * or their password.
     */
    val cipher = viewModel.biometricCipher() ?: run {
        viewModel.reportBiometricUnavailable()
        return
    }

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
 * Ask Android to confirm the driver before biometrics is switched on.
 *
 * No `CryptoObject`, and that is the change. Sealing now uses the public half
 * of a key pair, which the platform never gates, so this prompt is no longer
 * load-bearing cryptography — it is consent. It still earns its place: a switch
 * that says "fingerprint unlock is on" should not be believable until the phone
 * has actually recognised a fingerprint once.
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
        androidx.core.content.ContextCompat.getMainExecutor(context),
        object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                onResult(true)
            }

            override fun onAuthenticationError(code: Int, message: CharSequence) = onResult(false)
        },
    )

    prompt.authenticate(
        BiometricPrompt.PromptInfo.Builder()
            .setTitle("Set up fingerprint unlock")
            .setSubtitle("Confirm it is you, and Saarthi will remember this phone")
            .setNegativeButtonText("Cancel")
            .build(),
    )
}
