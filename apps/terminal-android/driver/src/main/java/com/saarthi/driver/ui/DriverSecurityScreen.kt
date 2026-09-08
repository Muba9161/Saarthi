package com.saarthi.driver.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.FleetEnter
import com.saarthi.driver.ui.design.FleetSheet
import com.saarthi.driver.ui.design.FleetSpace

/**
 * Account settings, reachable mid-shift.
 *
 * Opaque and full-screen over the cockpit. A driver opening this has stopped to
 * change something about how they sign in, and a translucent panel over a moving
 * map would be harder to read for no benefit.
 *
 * Deliberately narrow: Quick Login and nothing else. Everything a fleet needs to
 * configure belongs on the web, and a settings tree in a cab is a settings tree
 * somebody opens while driving.
 */
@Composable
fun DriverSecurityScreen(viewModel: DriverViewModel, onClose: () -> Unit) {
    FleetSheet(title = "Sign-in and security", onClose = onClose) {
        FleetEnter(index = 0) {
            Text(
                "How you get back into Saarthi on this phone. Your account password " +
                    "is unchanged either way.",
                style = MaterialTheme.typography.bodyLarge,
                color = Ash,
            )
        }

        Spacer(Modifier.height(FleetSpace.base))

        FleetEnter(index = 1) {
            QuickLoginSettings(viewModel)
        }
    }
}
