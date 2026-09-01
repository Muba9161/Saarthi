package com.saarthi.device.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * Shared building blocks.
 *
 * The status dot is the one worth explaining. It carries a
 * `contentDescription` naming the state in words, because a coloured circle is
 * invisible to a screen reader and roughly a twelfth of male drivers cannot
 * reliably tell the red one from the green one. The label beside it says the
 * same thing, so the colour is reinforcement rather than the message.
 */

enum class Health { OK, WARN, BAD, IDLE }

val Health.color: Color
    get() = when (this) {
        Health.OK -> StatusOk
        Health.WARN -> StatusWarn
        Health.BAD -> StatusBad
        Health.IDLE -> StatusIdle
    }

val Health.word: String
    get() = when (this) {
        Health.OK -> "working"
        Health.WARN -> "degraded"
        Health.BAD -> "not working"
        Health.IDLE -> "idle"
    }

@Composable
fun StatusDot(health: Health, label: String, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(10.dp)
            .clip(CircleShape)
            .background(health.color)
            .semantics { contentDescription = "$label: ${health.word}" },
    )
}

/** A labelled status row: dot, name, and the detail in the operator's words. */
@Composable
fun StatusRow(
    label: String,
    value: String,
    health: Health,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatusDot(health, label)
        Spacer(Modifier.width(12.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.width(110.dp),
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
fun SectionCard(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.size(8.dp))
            content()
        }
    }
}

/**
 * The label every simulated value carries.
 *
 * Never optional and never abbreviated to an icon. Section 23 requires that
 * simulated data announce itself, and the reason is concrete: a fabricated
 * coolant temperature mistaken for a measurement puts a working truck in a
 * workshop.
 */
@Composable
fun SimulatedBadge(modifier: Modifier = Modifier) {
    Text(
        text = "SIMULATED",
        style = MaterialTheme.typography.labelSmall,
        color = StatusWarn,
        modifier = modifier
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
            .background(StatusWarn.copy(alpha = 0.15f))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}
