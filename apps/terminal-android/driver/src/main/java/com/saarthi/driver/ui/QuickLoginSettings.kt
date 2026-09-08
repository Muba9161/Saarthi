package com.saarthi.driver.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.saarthi.core.ui.SolidCard
import com.saarthi.driver.data.QuickLoginPolicy

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

    SolidCard(Modifier.fillMaxWidth()) {
        Text(
            "Saarthi Quick Login",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            "Get back in without typing your password. Your account sign-in does not " +
                "change.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(14.dp))

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
            return@SolidCard
        }

        SettingRow(
            title = if (methods.pin) "4-digit PIN" else "Use a 4-digit PIN",
            subtitle = if (methods.pin) "On" else "Off",
            checked = methods.pin,
            onCheckedChange = { wanted ->
                notice = null
                if (wanted) creatingPin = true else viewModel.disableQuickLoginPin()
            },
        )

        if (methods.pin) {
            Spacer(Modifier.height(6.dp))
            OutlinedButton(
                onClick = { creatingPin = true },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Change PIN")
            }
        }

        Spacer(Modifier.height(12.dp))

        val biometricHardware = biometricsAvailable(context)
        SettingRow(
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
                    val cipher = viewModel.biometricEnrolCipher()
                    if (cipher == null) {
                        notice = "This phone would not create a secure key. Your PIN still works."
                    } else {
                        promptToEnrolBiometric(context, cipher) { authorised ->
                            if (authorised == null) {
                                notice = "Fingerprint setup was cancelled."
                            } else {
                                viewModel.completeBiometricSetup(authorised) { ok ->
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
            Spacer(Modifier.height(14.dp))
            OutlinedButton(
                onClick = {
                    viewModel.disableQuickLogin()
                    notice = "Quick Login is off. You will sign in with your password."
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Turn off Quick Login")
            }
        }

        notice?.let { message ->
            Spacer(Modifier.height(10.dp))
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun SettingRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    enabled: Boolean = true,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled)
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

    Text("Choose a 4-digit PIN", style = MaterialTheme.typography.bodyLarge)
    Spacer(Modifier.height(10.dp))

    OutlinedTextField(
        value = first,
        onValueChange = { if (it.length <= QuickLoginPolicy.PIN_LENGTH && it.all(Char::isDigit)) first = it },
        label = { Text("New PIN") },
        singleLine = true,
        // Never legible on screen, and never in a suggestion strip: the number
        // keyboard has no autocorrect and no clipboard history to leak into.
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.NumberPassword,
            imeAction = ImeAction.Next,
        ),
        modifier = Modifier.fillMaxWidth(),
    )

    Spacer(Modifier.height(10.dp))

    OutlinedTextField(
        value = second,
        onValueChange = { if (it.length <= QuickLoginPolicy.PIN_LENGTH && it.all(Char::isDigit)) second = it },
        label = { Text("Confirm PIN") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.NumberPassword,
            imeAction = ImeAction.Done,
        ),
        modifier = Modifier.fillMaxWidth(),
    )

    problem?.let { message ->
        Spacer(Modifier.height(8.dp))
        Text(
            message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
        )
    }

    Spacer(Modifier.height(14.dp))

    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedButton(onClick = onCancel, modifier = Modifier.weight(1f)) {
            Text("Cancel")
        }
        Button(
            onClick = {
                problem = when (val verdict = QuickLoginPolicy.evaluate(first)) {
                    is QuickLoginPolicy.PinVerdict.Malformed -> verdict.reason
                    is QuickLoginPolicy.PinVerdict.TooWeak -> verdict.reason
                    QuickLoginPolicy.PinVerdict.Acceptable ->
                        if (first != second) "Those two PINs do not match." else null
                }
                if (problem == null) onCreate(first)
            },
            enabled = first.length == QuickLoginPolicy.PIN_LENGTH &&
                second.length == QuickLoginPolicy.PIN_LENGTH,
            modifier = Modifier.weight(1f),
        ) {
            Text("Save PIN")
        }
    }
}
