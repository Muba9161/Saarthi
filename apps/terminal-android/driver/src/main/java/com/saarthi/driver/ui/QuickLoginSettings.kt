package com.saarthi.driver.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Fingerprint
import androidx.compose.material.icons.rounded.Password
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import com.saarthi.driver.data.QuickLoginPolicy
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.FleetButton
import com.saarthi.driver.ui.design.FleetCard
import com.saarthi.driver.ui.design.FleetError
import com.saarthi.driver.ui.design.FleetField
import com.saarthi.driver.ui.design.FleetNotice
import com.saarthi.driver.ui.design.FleetOutlineButton
import com.saarthi.driver.ui.design.FleetRule
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.FleetToggleRow

/**
 * Saarthi Quick Login, as the driver controls it.
 *
 * Shown on the signed-in home screen rather than behind a settings menu of its
 * own, because that is where a driver already is when they are not driving —
 * and because burying a security control three taps deep is how it goes unused.
 *
 * Both methods are optional and independent. A driver may have a PIN, a
 * fingerprint, both, or neither; nothing here pushes them towards any of the
 * four, because a PIN somebody resents is a PIN written on the dashboard.
 */
@Composable
fun QuickLoginSettings(viewModel: DriverViewModel) {
    val methods by viewModel.quickLoginMethods.collectAsState()
    val context = LocalContext.current

    var creatingPin by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }

    FleetCard(Modifier.fillMaxWidth()) {
        Text(
            "Saarthi Quick Login",
            style = MaterialTheme.typography.titleMedium,
            color = Chalk,
        )
        Spacer(Modifier.height(FleetSpace.hair))
        Text(
            "Get back in without typing your password. Your account sign-in does not " +
                "change.",
            style = MaterialTheme.typography.bodyMedium,
            color = Ash,
        )

        Spacer(Modifier.height(FleetSpace.snug))

        if (creatingPin) {
            PinSetup(
                onCancel = { creatingPin = false },
                onCreate = { pin ->
                    viewModel.enableQuickLoginPin(pin) { ok ->
                        creatingPin = !ok
                        notice = if (ok) {
                            "PIN set. You will be asked for it next time you open Saarthi."
                        } else {
                            "That PIN could not be saved. Try a different one."
                        }
                    }
                },
            )
            return@FleetCard
        }

        FleetToggleRow(
            icon = Icons.Rounded.Password,
            title = if (methods.pin) "4-digit PIN" else "Use a 4-digit PIN",
            subtitle = if (methods.pin) "On" else "Off",
            checked = methods.pin,
            onCheckedChange = { wanted ->
                notice = null
                if (wanted) creatingPin = true else viewModel.disableQuickLoginPin()
            },
        )

        if (methods.pin) {
            Spacer(Modifier.height(FleetSpace.tight))
            FleetOutlineButton(
                label = "Change PIN",
                onClick = { creatingPin = true },
            )
        }

        Spacer(Modifier.height(FleetSpace.snug))
        FleetRule()
        Spacer(Modifier.height(FleetSpace.snug))

        val biometricHardware = biometricsAvailable(context)
        FleetToggleRow(
            icon = Icons.Rounded.Fingerprint,
            title = "Fingerprint or face",
            subtitle = when {
                !biometricHardware -> "Not set up on this phone"
                methods.biometrics -> "On"
                else -> "Off"
            },
            checked = methods.biometrics,
            enabled = biometricHardware,
            onCheckedChange = { wanted ->
                notice = null
                if (wanted) {
                    /*
                     * Prove it is them, then seal.
                     *
                     * Turning this on runs the same system prompt as unlocking,
                     * because the key refuses to encrypt until Android has seen
                     * a fingerprint. Doing it in the other order is what made
                     * this silently impossible before.
                     */
                    if (!viewModel.biometricsUsable()) {
                        notice = "This phone would not create a secure key. Your PIN still works."
                    } else {
                        promptToEnrolBiometric(context) { confirmed ->
                            if (!confirmed) {
                                notice = "Fingerprint setup was cancelled."
                            } else {
                                viewModel.completeBiometricSetup { ok ->
                                    notice = if (ok) {
                                        "Fingerprint unlock is on."
                                    } else {
                                        "That did not save. Your PIN still works."
                                    }
                                }
                            }
                        }
                    }
                } else {
                    viewModel.disableQuickLoginBiometrics()
                }
            },
        )

        if (methods.any) {
            Spacer(Modifier.height(FleetSpace.base))
            FleetOutlineButton(
                label = "Turn off Quick Login",
                tint = Ash,
                onClick = {
                    viewModel.disableQuickLogin()
                    notice = "Quick Login is off. You will sign in with your password."
                },
            )
        }

        notice?.let { message ->
            Spacer(Modifier.height(FleetSpace.snug))
            FleetNotice(message)
        }
    }
}

/**
 * Choosing a PIN, twice.
 *
 * Confirmed before it is stored, because a PIN mistyped once at setup is a PIN
 * nobody can ever enter — and the only route back would be signing in with a
 * password the driver came here to avoid.
 *
 * The weak-PIN rules live in `QuickLoginPolicy` and are enforced by the store
 * as well as shown here, so a screen cannot accidentally become the only thing
 * standing between a driver and `0000`.
 */
@Composable
private fun PinSetup(
    onCancel: () -> Unit,
    onCreate: (String) -> Unit,
) {
    var first by remember { mutableStateOf("") }
    var second by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }

    Text(
        "Choose a 4-digit PIN",
        style = MaterialTheme.typography.bodyLarge,
        color = Chalk,
    )
    Spacer(Modifier.height(FleetSpace.snug))

    FleetField(
        value = first,
        onValueChange = {
            if (it.length <= QuickLoginPolicy.PIN_LENGTH && it.all(Char::isDigit)) first = it
        },
        label = "New PIN",
        isError = problem != null,
        // Never legible on screen, and never in a suggestion strip: the number
        // keyboard has no autocorrect and no clipboard history to leak into.
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.NumberPassword,
            imeAction = ImeAction.Next,
        ),
    )

    Spacer(Modifier.height(FleetSpace.snug))

    FleetField(
        value = second,
        onValueChange = {
            if (it.length <= QuickLoginPolicy.PIN_LENGTH && it.all(Char::isDigit)) second = it
        },
        label = "Confirm PIN",
        isError = problem != null,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.NumberPassword,
            imeAction = ImeAction.Done,
        ),
    )

    problem?.let { message ->
        Spacer(Modifier.height(FleetSpace.snug))
        FleetError(message)
    }

    Spacer(Modifier.height(FleetSpace.base))

    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(FleetSpace.snug),
    ) {
        FleetOutlineButton(
            label = "Cancel",
            tint = Ash,
            modifier = Modifier.weight(1f),
            onClick = onCancel,
        )
        FleetButton(
            label = "Save PIN",
            modifier = Modifier.weight(1f),
            enabled = first.length == QuickLoginPolicy.PIN_LENGTH &&
                second.length == QuickLoginPolicy.PIN_LENGTH,
            onClick = {
                problem = when (val verdict = QuickLoginPolicy.evaluate(first)) {
                    is QuickLoginPolicy.PinVerdict.Malformed -> verdict.reason
                    is QuickLoginPolicy.PinVerdict.TooWeak -> verdict.reason
                    QuickLoginPolicy.PinVerdict.Acceptable ->
                        if (first != second) "Those two PINs do not match." else null
                }
                if (problem == null) onCreate(first)
            },
        )
    }
}
