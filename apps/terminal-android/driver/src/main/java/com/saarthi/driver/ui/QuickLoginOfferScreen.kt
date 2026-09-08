package com.saarthi.driver.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.saarthi.driver.data.DriverAccountStore
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.EmberBright
import com.saarthi.driver.ui.design.FleetButton
import com.saarthi.driver.ui.design.FleetEnter
import com.saarthi.driver.ui.design.FleetScreen
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.FleetTextButton
import com.saarthi.driver.ui.design.StatusPill

/**
 * "You will not have to type that again."
 *
 * Shown once, straight after a password sign-in. That moment is the only one
 * where a driver is actually thinking about getting back in, and it is also the
 * only moment the credential is in hand to seal — before this they had nothing
 * to protect, and afterwards they are busy driving.
 *
 * It is an offer and never a gate. A driver may enable a PIN, biometrics, both
 * or neither, and "Not now" is as reachable as anything else on the screen. A
 * PIN somebody resented setting is a PIN written on the dashboard.
 *
 * The one button at the bottom changes its word rather than its position: it
 * reads as "done" once something is on and as a refusal before that, because
 * both are the same act — the driver saying they have finished with this screen.
 */
@Composable
fun QuickLoginOfferScreen(
    viewModel: DriverViewModel,
    driver: DriverAccountStore.Account,
) {
    val methods by viewModel.quickLoginMethods.collectAsState()
    val firstName = driver.name.substringBefore(' ').ifBlank { "driver" }

    FleetScreen {
        Spacer(Modifier.height(FleetSpace.wide))

        FleetEnter(index = 0) {
            Column(Modifier.fillMaxWidth()) {
                StatusPill("Signed in", tint = EmberBright)
                Spacer(Modifier.height(FleetSpace.snug))
                Text(
                    "Welcome, $firstName",
                    style = MaterialTheme.typography.headlineMedium,
                    color = Chalk,
                )
                Spacer(Modifier.height(FleetSpace.tight))
                Text(
                    "Set up a quick way back in, so you never type that password in a " +
                        "yard at five in the morning.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = Ash,
                )
            }
        }

        Spacer(Modifier.height(FleetSpace.section))

        // The same controls as the settings section, so there is one
        // implementation of "turn this on" rather than two that drift.
        FleetEnter(index = 1) {
            QuickLoginSettings(viewModel)
        }

        Spacer(Modifier.height(FleetSpace.roomy))

        FleetEnter(index = 2) {
            if (methods.any) {
                FleetButton(
                    label = "Continue",
                    onClick = viewModel::finishQuickLoginSetup,
                )
            } else {
                FleetTextButton(
                    label = "Not now",
                    tint = Ash,
                    onClick = viewModel::finishQuickLoginSetup,
                )
            }
        }

        Spacer(Modifier.height(FleetSpace.wide))
    }
}
