package com.saarthi.driver.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.saarthi.core.ui.TerminalPage
import com.saarthi.driver.data.DriverAccountStore

/**
 * "You will not have to type that again."
 *
 * Shown once, straight after a password sign-in. That moment is the only one
 * where a driver is actually thinking about getting back in, and it is also the
 * only moment the credential is in hand to seal — before this they had nothing
 * to protect, and afterwards they are busy driving.
 *
 * It is an offer and never a gate. The specification is explicit that a driver
 * may enable a PIN, biometrics, both or neither, and "Not now" is as prominent
 * as anything else on the screen. A PIN somebody resented setting is a PIN
 * written on the dashboard.
 */
@Composable
fun QuickLoginOfferScreen(
    viewModel: DriverViewModel,
    driver: DriverAccountStore.Account,
) {
    val methods by viewModel.quickLoginMethods.collectAsState()

    TerminalPage {
        Spacer(Modifier.height(16.dp))

        Text(
            "Welcome, ${driver.name.substringBefore(' ').ifBlank { "driver" }}",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "Set up a quick way back in, so you never type that password in a yard " +
                "at five in the morning.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(20.dp))

        // The same controls as the settings section, so there is one
        // implementation of "turn this on" rather than two that drift.
        QuickLoginSettings(viewModel)

        Spacer(Modifier.height(16.dp))

        TextButton(
            onClick = viewModel::finishQuickLoginSetup,
            modifier = Modifier.fillMaxWidth(),
        ) {
            // Reads as "done" once something is on, and as a refusal before
            // that — the same button either way, because both are the driver
            // saying they have finished with this screen.
            Text(if (methods.any) "Continue" else "Not now")
        }
    }
}
