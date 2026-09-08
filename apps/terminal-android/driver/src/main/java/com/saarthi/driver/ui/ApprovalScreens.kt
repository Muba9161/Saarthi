package com.saarthi.driver.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.saarthi.core.ui.TerminalPage
import com.saarthi.driver.network.DriverApi

/**
 * Waiting for the fleet.
 *
 * The screen that has to be honest about what scanning did and did not do.
 * Scanning opened a request; it did not authorise anything, and a driver who
 * believes otherwise will climb in and drive. So the wording leads with the
 * vehicle and the word "waiting" rather than anything that could be read as a
 * confirmation.
 *
 * Cancelling is offered because the commonest reason for being on this screen
 * too long is a driver who scanned the wrong truck, and the alternative — an
 * open request nobody can clear — blocks them from signing on to the right one.
 */
@Composable
fun AwaitingApprovalScreen(
    viewModel: DriverViewModel,
    assignment: DriverApi.AssignmentDto,
) {
    TerminalPage(scrollable = false) {
        CircularProgressIndicator()
        Spacer(Modifier.height(20.dp))

        Text(
            "Waiting for approval",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            assignment.registrationNumber?.let { "You asked to drive $it." }
                ?: "Your request has been sent.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            "Your fleet is reviewing it. You can keep the app open — it will move on " +
                "by itself.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(28.dp))

        OutlinedButton(onClick = viewModel::cancel, modifier = Modifier.fillMaxWidth()) {
            Text("Cancel this request")
        }
    }
}

/**
 * The fleet said no.
 *
 * The reason is shown when there is one, because "rejected" on its own sends a
 * driver to telephone an office that has already written down why. A driver can
 * scan again — the commonest rejection is the wrong vehicle, which the next scan
 * fixes without anybody's involvement.
 */
@Composable
fun AssignmentRejectedScreen(
    viewModel: DriverViewModel,
    assignment: DriverApi.AssignmentDto,
) {
    TerminalPage(scrollable = false) {
        Text(
            "Not approved",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.error,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            assignment.registrationNumber?.let { "Your request for $it was declined." }
                ?: "Your request was declined.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        assignment.rejectionReason?.takeIf { it.isNotBlank() }?.let { reason ->
            Spacer(Modifier.height(12.dp))
            Text(
                reason,
                style = MaterialTheme.typography.bodyLarge,
            )
        }

        Spacer(Modifier.height(28.dp))

        Button(onClick = viewModel::cancel, modifier = Modifier.fillMaxWidth()) {
            Text("Scan a different vehicle")
        }
    }
}
