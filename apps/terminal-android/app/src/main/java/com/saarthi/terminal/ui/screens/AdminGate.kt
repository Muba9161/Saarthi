package com.saarthi.terminal.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.terminal.data.TerminalSettings
import com.saarthi.terminal.ui.PrimaryAction
import com.saarthi.terminal.ui.SolidCard
import com.saarthi.terminal.ui.StatusTone
import com.saarthi.terminal.ui.TerminalPage
import java.security.MessageDigest

/**
 * The lock on the diagnostics screen (specification section 46).
 *
 * Section 46 asks that admin functionality not be exposed to ordinary drivers.
 * This is that, and it is worth being honest about what it is and is not.
 *
 * **What it is:** the difference between a driver wandering into diagnostics out
 * of curiosity and a driver not. That is a real difference — the screen can
 * repoint the terminal at a different server and hand out the device log — and a
 * four-digit gate is proportionate to it.
 *
 * **What it is not:** a security boundary. Somebody with the tablet in their
 * hands and time can defeat this, and it does not matter, because nothing behind
 * it grants any authority the server would honour. The terminal's *credentials*
 * are what authorise anything, they live in the keystore, and this screen cannot
 * read them out. Repointing at another server means talking to a server that has
 * never heard of this terminal.
 *
 * Set on first use rather than shipped with a default. A default PIN is a PIN
 * every terminal in the country shares, and a fleet that never changed it is a
 * fleet with no gate at all.
 */
@Composable
fun AdminGate(
    settings: TerminalSettings,
    onUnlocked: () -> Unit,
    onCancel: () -> Unit,
) {
    val settingUp = !settings.hasAdminPin
    var pin by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    // Centred with weight(), which needs a bounded height.
    TerminalPage(scrollable = false) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Terminal diagnostics", style = MaterialTheme.typography.headlineSmall)
            IconButton(onClick = onCancel) {
                Icon(Icons.Rounded.Close, contentDescription = "Back")
            }
        }

        Spacer(Modifier.weight(1f))

        SolidCard(Modifier.fillMaxWidth()) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(Icons.Rounded.Lock, contentDescription = null)
                Text(
                    if (settingUp) "Set an engineer PIN" else "Engineer PIN",
                    style = MaterialTheme.typography.titleLarge,
                )
            }

            Spacer(Modifier.height(10.dp))

            Text(
                if (settingUp) {
                    "Choose a four-digit PIN for this terminal. It keeps diagnostics out of a driver's way — it is not a password, and nothing behind it can authorise anything on its own."
                } else {
                    "Enter the PIN set when this terminal was fitted."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(Modifier.height(20.dp))

            OutlinedTextField(
                value = pin,
                onValueChange = {
                    pin = it.filter(Char::isDigit).take(4)
                    error = null
                },
                label = { Text("PIN") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                textStyle = MaterialTheme.typography.headlineSmall.copy(
                    fontFamily = FontFamily.Monospace,
                    letterSpacing = 12.sp,
                    textAlign = TextAlign.Center,
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            if (settingUp) {
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = confirm,
                    onValueChange = {
                        confirm = it.filter(Char::isDigit).take(4)
                        error = null
                    },
                    label = { Text("Confirm PIN") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    textStyle = MaterialTheme.typography.headlineSmall.copy(
                        fontFamily = FontFamily.Monospace,
                        letterSpacing = 12.sp,
                        textAlign = TextAlign.Center,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            error?.let { message ->
                Spacer(Modifier.height(10.dp))
                Text(
                    message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            Spacer(Modifier.height(20.dp))

            PrimaryAction(
                label = if (settingUp) "Set PIN and continue" else "Unlock",
                enabled = pin.length == 4 && (!settingUp || confirm.length == 4),
                tone = StatusTone.INFO,
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    if (settingUp) {
                        if (pin != confirm) {
                            error = "The two PINs do not match."
                            return@PrimaryAction
                        }
                        settings.adminPinHash = hashPin(pin)
                        onUnlocked()
                        return@PrimaryAction
                    }

                    if (hashPin(pin) == settings.adminPinHash) {
                        onUnlocked()
                    } else {
                        // No attempt counter and no lockout. A terminal that
                        // locked an engineer out at a roadside because a driver
                        // had been guessing at it would be worse than the thing
                        // the lockout prevents.
                        error = "That PIN is not right."
                        pin = ""
                    }
                },
            )
        }

        Spacer(Modifier.weight(1f))
    }
}

/**
 * SHA-256 of the PIN.
 *
 * Not bcrypt or Argon2, and the reason is honesty rather than laziness: a
 * four-digit space is ten thousand values, which any KDF at a tolerable work
 * factor still falls to in seconds on the tablet itself. A slow hash here would
 * imply a resistance this cannot have.
 *
 * What it does buy is that the PIN is not sitting in plaintext in a preferences
 * file where a support screenshot or a backup would expose it — which is the
 * realistic exposure, and the one worth preventing.
 */
private fun hashPin(pin: String): String =
    MessageDigest.getInstance("SHA-256")
        .digest("saarthi-terminal:$pin".toByteArray())
        .joinToString("") { "%02x".format(it) }
