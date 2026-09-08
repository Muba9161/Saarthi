package com.saarthi.driver.ui

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.google.android.gms.location.LocationServices
import com.saarthi.core.ui.TerminalPage
import com.saarthi.core.ui.screens.ScannerPanel
import com.saarthi.core.ui.screens.vehicleIdentityCode
import com.saarthi.driver.data.DriverAccountStore

/** How the driver is naming the vehicle on this screen. */
private enum class VehicleEntry { SCAN, NUMBER }

/**
 * Point the phone at the truck.
 *
 * The whole of "starting a shift", as far as a driver is concerned. They scan
 * the code stuck to the vehicle and wait — no vehicle list to search, no
 * registration to type, nobody to telephone.
 *
 * The position is sent with the request when the phone knows it. It is not a
 * check on the driver, and it is not required: the fleet approving the request
 * sees where the scan happened, which is what turns "somebody scanned RIG0001"
 * into "somebody scanned RIG0001 while standing next to it".
 */
@Composable
fun ScanVehicleScreen(
    viewModel: DriverViewModel,
    driver: DriverAccountStore.Account,
    onDarkThemeChanged: (Boolean) -> Unit,
    onOpenProfile: () -> Unit,
) {
    val busy by viewModel.busy.collectAsState()
    val error by viewModel.error.collectAsState()
    val context = LocalContext.current

    // Refused codes are shown here rather than through the view model: a driver
    // waving the camera at the wrong sticker is not a failure worth keeping
    // after the next frame reads correctly.
    var refused by remember { mutableStateOf<String?>(null) }
    var mode by remember { mutableStateOf(VehicleEntry.SCAN) }
    var showSecurity by remember { mutableStateOf(false) }
    val quickLogin by viewModel.quickLoginMethods.collectAsState()
    var number by remember { mutableStateOf("") }

    TerminalPage {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                driver.name.ifBlank { "Signed in" },
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            /*
             * The profile, as an avatar rather than a word.
             *
             * "Sign out" used to sit here, which put the most destructive action
             * on the screen a driver sees most and hid the profile entirely —
             * there was no way to reach it at all. Signing out now lives inside
             * the profile, one deliberate step further away.
             */
            Surface(
                onClick = onOpenProfile,
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(40.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        driver.name.trim().split(' ')
                            .mapNotNull { it.firstOrNull()?.uppercase() }
                            .take(2)
                            .joinToString("")
                            .ifBlank { "?" },
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                }
            }
        }

        Spacer(Modifier.height(8.dp))

        Text(
            "Choose your vehicle",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Text(
            "Scan the Saarthi code on the vehicle, or enter its number. Your fleet " +
                "will approve you before the trip can start.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(16.dp))

        /*
         * Two ways to name the vehicle, and the driver picks.
         *
         * Scanning is first because it is faster and cannot be mistyped. But a
         * sticker peels, gets covered in road film, or sits on a trailer parked
         * nose-in against a wall — and a driver who cannot scan must not be
         * unable to work. Neither route authorises anything: the fleet still
         * approves.
         */
        SegmentedRow(
            selected = mode,
            onSelect = {
                mode = it
                refused = null
                viewModel.clearError()
            },
        )

        Spacer(Modifier.height(16.dp))

        if (busy) {
            CircularProgressIndicator()
            Spacer(Modifier.height(8.dp))
            Text(
                "Sending your request…",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else if (mode == VehicleEntry.SCAN) {
            ScannerPanel(
                onToken = { token ->
                    refused = null
                    withLastPosition(context) { latitude, longitude ->
                        viewModel.vehicleScanned(token, latitude, longitude)
                    }
                },
                onRejected = { refused = it },
                accept = ::vehicleIdentityCode,
                modifier = Modifier.fillMaxWidth().aspectRatio(1f),
            )
        } else {
            OutlinedTextField(
                value = number,
                onValueChange = { number = it.uppercase() },
                label = { Text("Vehicle number") },
                placeholder = { Text("DL 01 AB 1234") },
                singleLine = true,
                // Capitals and no autocorrect: a registration is not a word,
                // and a keyboard that helpfully corrects one is a keyboard that
                // stops a driver working.
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    autoCorrectEnabled = false,
                    imeAction = ImeAction.Done,
                ),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = {
                    refused = null
                    withLastPosition(context) { latitude, longitude ->
                        viewModel.vehicleNumberEntered(number, latitude, longitude)
                    }
                },
                // Four characters is the server's own floor, so a rejection
                // never arrives after typing.
                enabled = number.trim().length >= 4,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Request this vehicle")
            }
        }

        (refused ?: error)?.let { message ->
            Spacer(Modifier.height(12.dp))
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
        }

        /*
         * Quick Login, on the screen a driver is already on.
         *
         * Behind a disclosure rather than always open, so it does not compete
         * with the camera — but on this screen rather than a settings menu,
         * because this is where a signed-in driver stands when they are not
         * driving, and a security control three taps deep is one nobody uses.
         */
        Spacer(Modifier.height(20.dp))
        if (showSecurity) {
            QuickLoginSettings(viewModel)
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = { showSecurity = false }, modifier = Modifier.fillMaxWidth()) {
                Text("Hide")
            }
        } else {
            TextButton(onClick = { showSecurity = true }, modifier = Modifier.fillMaxWidth()) {
                Text(
                    if (quickLogin.any) {
                        "Quick Login is on · Change"
                    } else {
                        "Set up Quick Login — PIN or fingerprint"
                    },
                )
            }
        }
    }
}

/**
 * The last known position, if the phone has one, and nothing if it does not.
 *
 * Deliberately not a fresh fix. Asking for one costs seconds a driver spends
 * looking at a spinner in a yard, and the request is just as valid without a
 * position — the server treats it as optional, so waiting for GPS would be
 * trading the thing that matters for the thing that does not.
 */
@SuppressLint("MissingPermission")
private fun withLastPosition(
    context: Context,
    send: (latitude: Double?, longitude: Double?) -> Unit,
) {
    runCatching {
        LocationServices.getFusedLocationProviderClient(context).lastLocation
            .addOnSuccessListener { location -> send(location?.latitude, location?.longitude) }
            .addOnFailureListener { send(null, null) }
    }.onFailure { send(null, null) }
}

/**
 * Scan or type, as two buttons rather than a hidden alternative.
 *
 * Both visible from the start. A driver whose sticker will not scan should not
 * have to discover that another way exists — they are standing in a yard, in a
 * hurry, and a screen that offers only a camera reads as "this is the only way".
 */
@Composable
private fun SegmentedRow(
    selected: VehicleEntry,
    onSelect: (VehicleEntry) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for (option in VehicleEntry.entries) {
            val label = if (option == VehicleEntry.SCAN) "Scan code" else "Enter number"
            if (option == selected) {
                Button(onClick = { onSelect(option) }, modifier = Modifier.weight(1f)) {
                    Text(label)
                }
            } else {
                OutlinedButton(onClick = { onSelect(option) }, modifier = Modifier.weight(1f)) {
                    Text(label)
                }
            }
        }
    }
}
