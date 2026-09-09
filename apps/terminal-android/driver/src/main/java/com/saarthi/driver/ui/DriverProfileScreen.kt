package com.saarthi.driver.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Badge
import androidx.compose.material.icons.rounded.DirectionsCar
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.Mail
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import com.saarthi.driver.R
import com.saarthi.core.domain.TerminalState
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.data.DriverAccountStore
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.CautionAmber
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.CurrentTrackingCard
import com.saarthi.driver.ui.design.FieldLabel
import com.saarthi.driver.ui.design.FleetCard
import com.saarthi.driver.ui.design.FleetEnter
import com.saarthi.driver.ui.design.FleetOutlineButton
import com.saarthi.driver.ui.design.FleetRule
import com.saarthi.driver.ui.design.FleetSheet
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.IconChip
import com.saarthi.driver.ui.design.LiveGreen
import com.saarthi.driver.ui.design.Monogram
import com.saarthi.driver.ui.design.SectionHeader
import com.saarthi.driver.ui.design.Slate
import com.saarthi.driver.ui.design.StatusPill

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
    val registration = server.registration

    FleetSheet(title = "Your profile", onClose = onClose) {
        /*
         * The driver, as a monogram.
         *
         * A photograph would be the arrival selfie, which belongs to one shift
         * and one vehicle rather than to a person — putting it here would be
         * quietly repurposing evidence a fleet holds for another reason.
         */
        FleetEnter(index = 0) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(FleetSpace.base),
            ) {
                Monogram(account.name, size = 72.dp)
                Column(Modifier.weight(1f)) {
                    Text(
                        account.name.ifBlank { "Driver" },
                        style = MaterialTheme.typography.headlineSmall,
                        color = Chalk,
                    )
                    Spacer(Modifier.height(FleetSpace.tight))
                    StatusPill(
                        label = if (registration != null) "On a vehicle" else "Not signed on",
                        tint = if (registration != null) LiveGreen else Slate,
                        live = registration != null,
                    )
                }
            }
        }

        Spacer(Modifier.height(FleetSpace.section))

        /*
         * The vehicle, when there is one, as the screen's headline.
         *
         * Every value on it is read from the terminal state the server sent —
         * the registration, whether readings are reaching the fleet, and which
         * stage of the shift the server says this is. Nothing here is inferred
         * locally, because a profile that disagrees with the fleet's own record
         * is worse than a profile that shows less.
         */
        if (registration != null) {
            FleetEnter(index = 1) {
                CurrentTrackingCard(
                    code = registration,
                    detailLabel = "Reporting",
                    detailValue = if (server.offline) {
                        "Saved on this phone"
                    } else {
                        "Live to your fleet"
                    },
                    statusLabel = server.state.driverWord(),
                    statusTint = if (server.offline) CautionAmber else LiveGreen,
                    live = !server.offline,
                )
            }

            Spacer(Modifier.height(FleetSpace.snug))
        }

        FleetEnter(index = 2) {
            FleetCard(Modifier.fillMaxWidth()) {
                DetailRow(Icons.Rounded.Mail, "Email", account.email.ifBlank { "—" })
                if (registration == null) {
                    Spacer(Modifier.height(FleetSpace.snug))
                    FleetRule()
                    Spacer(Modifier.height(FleetSpace.snug))
                    DetailRow(
                        Icons.Rounded.DirectionsCar,
                        "Vehicle",
                        "Not signed on to a vehicle",
                    )
                }
                Spacer(Modifier.height(FleetSpace.snug))
                FleetRule()
                Spacer(Modifier.height(FleetSpace.snug))
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
        }

        Spacer(Modifier.height(FleetSpace.section))

        FleetEnter(index = 3) {
            Column(Modifier.fillMaxWidth()) {
                SectionHeader("Sign-in and security")
                Spacer(Modifier.height(FleetSpace.snug))
                QuickLoginSettings(driver)
            }
        }

        Spacer(Modifier.height(FleetSpace.section))

        /*
         * Language, on the driver's own screen.
         *
         * Their choice, not the fleet's — a lorry is driven by whoever is in it,
         * and the person who has to read the app is the person who should pick
         * the language it speaks.
         */
        FleetEnter(index = 4) {
            LanguageCard()
        }

        Spacer(Modifier.height(FleetSpace.section))

        /*
         * Signing out is last, and outlined rather than filled.
         *
         * It ends the shift's credentials and clears Quick Login on this phone.
         * A driver reaching for their profile mid-shift is not usually reaching
         * for this, and a prominent red button at the top of the screen is one
         * they will hit by accident in a moving cab.
         */
        FleetEnter(index = 4) {
            Column(Modifier.fillMaxWidth()) {
                FleetOutlineButton(
                    label = "Sign out of this phone",
                    icon = Icons.AutoMirrored.Rounded.Logout,
                    tint = Ash,
                    onClick = driver::signOut,
                )
                Spacer(Modifier.height(FleetSpace.tight))
                Text(
                    "Signing out clears Quick Login on this phone. You will need your " +
                        "password to get back in.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate,
                )
            }
        }
    }
}

/** One fact about the driver, as a row on a card. */
@Composable
private fun DetailRow(
    icon: ImageVector,
    label: String,
    value: String,
) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(FleetSpace.snug),
    ) {
        IconChip(icon = icon, size = 40.dp)
        Column(Modifier.weight(1f)) {
            FieldLabel(label)
            Spacer(Modifier.height(2.dp))
            Text(
                value,
                style = MaterialTheme.typography.bodyLarge,
                color = Chalk,
            )
        }
    }
}

/**
 * The shift stage, in a word a driver would use.
 *
 * The server owns the lifecycle and this only renames it — deliberately, so the
 * profile cannot drift into a second opinion about what state the terminal is
 * in. Anything before the driver is authorised reads as "signed on", because
 * from where they are standing that is the whole of the difference.
 */
/**
 * The shift stage, in a driver's words rather than the server's.
 *
 * `internal` rather than file-private because the dashboard says the same thing
 * about the same state, and two copies of this mapping would drift the first
 * time a status was added.
 */
@Composable
internal fun TerminalState.driverWord(): String = stringResource(
    when (this) {
        TerminalState.TRIP_ACTIVE -> R.string.state_in_transit
        TerminalState.TRIP_COMPLETED -> R.string.state_trip_finished
        TerminalState.READY -> R.string.state_ready
        TerminalState.CHECKLIST_REQUIRED -> R.string.state_checks_due
        TerminalState.PENDING_APPROVAL -> R.string.state_awaiting_approval
        TerminalState.REJECTED -> R.string.state_not_approved
        TerminalState.REVOKED -> R.string.state_suspended

        /*
         * Not signed on, and said so.
         *
         * These four fell into the "Signed on" fallback below, so a phone with no
         * session on the vehicle reported the one thing that was certainly untrue
         * — on the status pill, in the profile, and on the dashboard's next-step
         * card at the same time.
         */
        TerminalState.UNPAIRED,
        TerminalState.PAIRING,
        TerminalState.VEHICLE_PAIRED,
        TerminalState.AWAITING_DRIVER,
        -> R.string.state_not_signed_on

        else -> R.string.state_signed_on
    },
)
