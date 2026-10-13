package com.saarthi.owner.ui.fleet

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.network.AlertsApi
import com.saarthi.owner.network.FleetApi
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.countdown
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.Avatar
import com.saarthi.owner.ui.design.ButtonRow
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.LiveDot
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import kotlinx.coroutines.delay

/**
 * The one thing that needs the owner: a driver waiting at a vehicle, or the
 * most serious unread alert, or — said plainly — nothing.
 */
@Composable
fun NeedsYouNow(
    home: FleetHome,
    acting: String?,
    onApprove: (String) -> Unit,
    onReview: (String) -> Unit,
    onOpenAlerts: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val approval = home.approvals.firstOrNull()
    val alert = home.topAlert?.takeIf { it.priority == "CRITICAL" || it.priority == "HIGH" }
    when {
        approval != null -> ApprovalCard(approval, home.approvals.size - 1, acting, onApprove, onReview, modifier)
        alert != null -> AlertCard(alert, onOpenAlerts, modifier)
        else -> AllClearCard(modifier)
    }
}

@Composable
private fun ApprovalCard(
    approval: FleetApi.Approval,
    othersWaiting: Int,
    acting: String?,
    onApprove: (String) -> Unit,
    onReview: (String) -> Unit,
    modifier: Modifier,
) {
    val c = Saarthi.colors
    val name = approval.driver?.name?.ifBlank { null } ?: "A driver"
    Column(
        modifier
            .fillMaxWidth()
            .card(radius = 24.dp, ring = c.warningRing)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LiveDot(c.warning)
            Eyebrow("Needs you now", color = c.warning, modifier = Modifier.weight(1f))
            approval.secondsUntilEscalation?.let { EscalationPill(it) }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Avatar(name, size = 56.dp, background = c.sunken, ink = c.fg)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("$name wants to drive", style = SType.cardTitle, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                PlateChip(approval.registrationNumber)
            }
        }
        ButtonRow {
            SaarthiButton(
                "Approve",
                onClick = { onApprove(approval.id) },
                busy = acting == approval.id,
                height = 52.dp,
                modifier = Modifier.weight(1f),
            )
            SaarthiButton(
                "Review",
                onClick = { onReview(approval.id) },
                tone = ButtonTone.SECONDARY,
                enabled = acting == null,
                height = 52.dp,
                modifier = Modifier.weight(1f),
            )
        }
        if (othersWaiting > 0) {
            Text("$othersWaiting more waiting after this one", style = SType.small, color = c.muted)
        }
    }
}

/** "11:42 left" before the approval escalates, counting down on screen. */
@Composable
private fun EscalationPill(secondsAtRead: Long) {
    val c = Saarthi.colors
    val left by produceState(secondsAtRead, secondsAtRead) {
        while (value > 0) {
            delay(1_000)
            value -= 1
        }
    }
    val late = left <= 0
    Box(
        Modifier
            .clip(CircleShape)
            .background(if (late) c.dangerBg else c.warningBg)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(
            if (late) "Overdue" else "${countdown(left)} left",
            style = SType.captionStrong,
            color = if (late) c.danger else c.warning,
        )
    }
}

@Composable
private fun AlertCard(alert: AlertsApi.Alert, onOpenAlerts: () -> Unit, modifier: Modifier) {
    val c = Saarthi.colors
    val critical = alert.priority == "CRITICAL"
    val ink = if (critical) c.danger else c.warning
    Column(
        modifier
            .fillMaxWidth()
            .card(radius = 24.dp, ring = if (critical) c.dangerRing else c.warningRing)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LiveDot(ink)
            Eyebrow("Needs you now", color = ink)
        }
        Text(alert.title, style = SType.cardTitle, color = c.fg)
        alert.body?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = SType.small, color = c.muted, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
        LinkButton("Open alerts", onOpenAlerts, style = SType.smallStrong)
    }
}

@Composable
private fun AllClearCard(modifier: Modifier) {
    val c = Saarthi.colors
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 24.dp)
            .padding(18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(Lucide.check, well = c.successSoft, ink = c.success, shape = CircleShape)
        Column(Modifier.weight(1f)) {
            Text("Nothing needs you right now", style = SType.bodyStrong, color = c.fg)
            Text("Drivers waiting for approval and urgent alerts show up here.", style = SType.small, color = c.muted)
        }
    }
}

/** Trips, papers and FASTag — the three numbers an owner checks every morning. */
@Composable
fun MorningTiles(home: FleetHome, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val trips = home.dashboard?.trips
    val compliance = home.dashboard?.compliance
    val due = compliance?.let { it.documentsExpiringSoon + it.documentsExpired }
    val balances = home.fastags.mapNotNull { it.balance }
    val tagsLow = home.fastags.count { it.needsAttention }

    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Tile(
            icon = Lucide.route,
            well = c.primarySoft,
            ink = c.primary,
            label = "Trips",
            value = (trips?.active ?: home.onTrip).toString(),
            caption = when {
                trips == null -> "on the road"
                trips.delayed > 0 -> "${trips.delayed} late"
                else -> "all on time"
            },
            modifier = Modifier.weight(1f),
        )
        Tile(
            icon = Lucide.fileText,
            well = c.warningSoft,
            ink = c.warning,
            label = "Papers",
            value = when {
                due == null -> "—"
                due == 0 -> "All set"
                else -> "$due due"
            },
            valueColor = if ((due ?: 0) > 0) c.warning else c.fg,
            caption = when {
                compliance == null -> "not shared"
                compliance.documentsExpired > 0 -> "${compliance.documentsExpired} expired"
                due == 0 -> "nothing due"
                else -> "renew soon"
            },
            modifier = Modifier.weight(1f),
        )
        Tile(
            icon = Lucide.creditCard,
            well = c.accentSoft,
            ink = c.accent,
            label = "FASTag",
            value = balances.minOrNull()?.let(::rupees) ?: "—",
            valueColor = if (tagsLow > 0) c.warning else c.fg,
            caption = when {
                home.fastags.isEmpty() -> "no tags"
                tagsLow > 0 -> "$tagsLow need attention"
                else -> "lowest balance"
            },
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun Tile(
    icon: String,
    well: Color,
    ink: Color,
    label: String,
    value: String,
    caption: String,
    modifier: Modifier = Modifier,
    valueColor: Color = Saarthi.colors.fg,
) {
    val c = Saarthi.colors
    Column(
        modifier
            .card()
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        IconWell(icon, well = well, ink = ink, size = 30.dp, radius = 10.dp, iconSize = 16.dp)
        Eyebrow(label, color = c.muted, maxLines = 1)
        Text(value, style = SType.headerTitle.copy(fontSize = 19.sp), color = valueColor, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(caption, style = SType.caption, color = c.subtle, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}
