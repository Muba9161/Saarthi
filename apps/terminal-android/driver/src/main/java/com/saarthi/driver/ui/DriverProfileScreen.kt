package com.saarthi.driver.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Badge
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DirectionsCar
import androidx.compose.material.icons.rounded.Logout
import androidx.compose.material.icons.rounded.Mail
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.saarthi.core.ui.SolidCard
import com.saarthi.core.ui.TerminalPage
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.data.DriverAccountStore

/**
 * The driver, as Saarthi knows them.
 *
 * A profile rather than a settings tree. What a driver actually wants to check
 * here is narrow and answerable at a glance: who am I signed in as, which
 * vehicle am I on, how do I get back in next time, and how do I get out. Fleet
 * configuration, documents and payment belong on the web, where there is a
 * keyboard and nobody is about to start driving.
 *
 * Read-only by design. Editing a name or a licence number on a phone in a yard
 * is how a fleet's records drift from the documents that back them — every field
 * shown here is changed through the fleet, and the app reflects the result.
 */
@Composable
fun DriverProfileScreen(
    driver: DriverViewModel,
    cockpit: TerminalViewModel,
    account: DriverAccountStore.Account,
    onClose: () -> Unit,
) {
    val server by cockpit.uiState.collectAsState()
    val methods by driver.quickLoginMethods.collectAsState()

    // Entrance, once. Cards arrive a beat after the header so the eye lands on
    // the name first rather than on everything at once.
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { shown = true }

    Surface(
        color = MaterialTheme.colorScheme.background,
        modifier = Modifier.fillMaxSize(),
    ) {
        TerminalPage {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Your profile",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
                IconButton(onClick = onClose) {
                    Icon(Icons.Rounded.Close, contentDescription = "Close")
                }
            }

            Spacer(Modifier.height(20.dp))

            // The driver, as a monogram. A photograph would be the arrival
            // selfie, which belongs to one shift and one vehicle rather than to
            // a person's profile.
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(76.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        account.name.trim().split(' ')
                            .mapNotNull { it.firstOrNull()?.uppercase() }
                            .take(2)
                            .joinToString("")
                            .ifBlank { "?" },
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            Text(
                account.name.ifBlank { "Driver" },
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )

            Spacer(Modifier.height(20.dp))

            AnimatedVisibility(
                visible = shown,
                enter = fadeIn() + slideInVertically(
                    spring(dampingRatio = Spring.DampingRatioLowBouncy),
                ) { it / 4 },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SolidCard(Modifier.fillMaxWidth()) {
                        DetailRow(Icons.Rounded.Mail, "Email", account.email.ifBlank { "—" })
                        Spacer(Modifier.height(12.dp))
                        DetailRow(
                            Icons.Rounded.DirectionsCar,
                            "Vehicle",
                            server.registration ?: "Not signed on to a vehicle",
                        )
                        Spacer(Modifier.height(12.dp))
                        DetailRow(
                            Icons.Rounded.Badge,
                            "Quick Login",
                            when {
                                methods.pin && methods.biometrics -> "PIN and fingerprint"
                                methods.pin -> "4-digit PIN"
                                methods.biometrics -> "Fingerprint or face"
                                else -> "Off"
                            },
                        )
                    }

                    QuickLoginSettings(driver)

                    /*
                     * Signing out is last, and outlined rather than filled.
                     *
                     * It ends the shift's credentials and clears Quick Login on
                     * this phone. A driver reaching for their profile mid-shift
                     * is not usually reaching for this, and a prominent red
                     * button at the top of the screen is one they will hit by
                     * accident in a moving cab.
                     */
                    OutlinedButton(
                        onClick = driver::signOut,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Rounded.Logout, contentDescription = null)
                        Spacer(Modifier.size(8.dp))
                        Text("Sign out of this phone")
                    }
                }
            }
        }
    }
}

@Composable
private fun DetailRow(icon: ImageVector, label: String, value: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Icon(
            icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.size(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(value, style = MaterialTheme.typography.bodyLarge)
        }
    }
}
