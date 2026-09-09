package com.saarthi.driver.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.saarthi.core.network.DriverNotificationDto
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.CircleAction
import com.saarthi.driver.ui.design.Ember
import com.saarthi.driver.ui.design.FleetCard
import com.saarthi.driver.ui.design.FleetEnter
import com.saarthi.driver.ui.design.FleetScreen
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.SectionHeader
import com.saarthi.driver.ui.design.Slate
import com.saarthi.driver.ui.design.StatusPill

/**
 * What Saarthi has been telling this driver.
 *
 * The server has been writing these all along — an approval, a revocation, a
 * document about to lapse, a trip assigned — and the app never read one. The
 * only way a driver learned they had been approved onto a vehicle was the
 * cockpit polling every five seconds and the screen changing under them.
 *
 * Marked read on the way *out* rather than on the way in. A driver who opens
 * this and immediately gets a call has not read anything, and clearing the badge
 * the instant the list appears would lose the one notice they were coming back
 * for.
 */
@Composable
fun DriverNoticesScreen(
    cockpit: TerminalViewModel,
    onBack: () -> Unit,
) {
    val notices by cockpit.notifications.collectAsState()

    LaunchedEffect(Unit) { cockpit.loadNotifications() }
    DisposableEffect(Unit) {
        onDispose { cockpit.markNotificationsRead() }
    }

    FleetScreen {
        Spacer(Modifier.height(FleetSpace.snug))

        FleetEnter(index = 0) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(FleetSpace.snug),
            ) {
                CircleAction(
                    icon = Icons.AutoMirrored.Rounded.ArrowBack,
                    contentDescription = "Back",
                    onClick = onBack,
                )
                Column(Modifier.weight(1f)) {
                    Text(
                        "Notices",
                        style = MaterialTheme.typography.titleLarge,
                        color = Chalk,
                    )
                    Text(
                        "From your fleet and from Saarthi.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                    )
                }
                if (notices.unread > 0) {
                    StatusPill(label = "${notices.unread} new", tint = Ember)
                }
            }
        }

        Spacer(Modifier.height(FleetSpace.base))

        if (notices.items.isEmpty()) {
            FleetEnter(index = 1) {
                FleetCard(Modifier.fillMaxWidth()) {
                    SectionHeader("Nothing to read")
                    Spacer(Modifier.height(FleetSpace.tight))
                    Text(
                        "Approvals, document reminders and messages from your fleet will " +
                            "appear here.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Ash,
                    )
                }
            }
            return@FleetScreen
        }

        notices.items.forEachIndexed { index, notice ->
            FleetEnter(index = (index + 1).coerceAtMost(6)) {
                Column {
                    NoticeRow(notice)
                    Spacer(Modifier.height(FleetSpace.tight))
                }
            }
        }

        Spacer(Modifier.height(FleetSpace.wide))
    }
}

@Composable
private fun NoticeRow(notice: DriverNotificationDto) {
    val unread = notice.readAt == null

    FleetCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(
                    notice.title,
                    style = MaterialTheme.typography.titleSmall,
                    // Unread is the brighter of the two, which is the whole
                    // distinction a list like this has to carry.
                    color = if (unread) Chalk else Ash,
                )
                notice.body?.takeIf { it.isNotBlank() }?.let {
                    Spacer(Modifier.height(FleetSpace.hair))
                    Text(
                        it,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (unread) Ash else Slate,
                    )
                }
                Spacer(Modifier.height(FleetSpace.tight))
                Text(
                    relativeTime(notice.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = Slate,
                )
            }
            if (unread) {
                Spacer(Modifier.height(FleetSpace.tight))
                StatusPill(label = "New", tint = Ember)
            }
        }
    }
}

/**
 * "2 hours ago", from the server's ISO timestamp.
 *
 * Relative rather than absolute on purpose: a driver reading this wants to know
 * whether a notice is still current, and "11:42" requires them to work out what
 * time it is now to answer that.
 *
 * Falls back to the date when the parse fails. A wrong relative time would be
 * worse than a raw one — "just now" on a three-day-old revocation is the kind of
 * mistake that gets somebody turned away at a gate.
 */
private fun relativeTime(iso: String): String {
    val parsed = runCatching {
        java.time.Instant.parse(iso).toEpochMilli()
    }.getOrNull() ?: return iso.substringBefore('T')

    val elapsed = System.currentTimeMillis() - parsed
    if (elapsed < 0) return "Just now"

    val minutes = elapsed / 60_000
    val hours = minutes / 60
    val days = hours / 24

    return when {
        minutes < 1 -> "Just now"
        minutes < 60 -> "$minutes minute(s) ago"
        hours < 24 -> "$hours hour(s) ago"
        days < 30 -> "$days day(s) ago"
        else -> iso.substringBefore('T')
    }
}
