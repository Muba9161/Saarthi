package com.saarthi.driver.ui.shift.notices

import android.text.format.DateUtils
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.saarthi.core.network.DriverNotificationDto
import com.saarthi.core.ui.LocalReducedMotion
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Brand
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiCard
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.Skeleton
import com.saarthi.driver.ui.design.bottomRule
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.rememberLoop
import java.time.Instant

/** An unread notice, on its own card with an icon for what it is about. */
@Composable
internal fun FreshNotice(notice: DriverNotificationDto, now: Long, delayMs: Int) {
    val c = Saarthi.colors
    val look = lookOf(notice.type)
    val (well, ink) = look.tone.colors()
    Row(
        Modifier
            .fillMaxWidth()
            .slideIn(delayMs)
            .card()
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(look.icon, well = well, ink = ink, size = 40.dp, radius = 14.dp, iconSize = 18.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(notice.title, style = SType.bodyStrong, color = c.fg, modifier = Modifier.weight(1f))
                UnreadDot()
            }
            notice.body?.takeIf { it.isNotBlank() }?.let { Text(it, style = SType.body, color = c.muted) }
            Text(whenText(notice.createdAt, now), style = SType.caption, color = c.subtle)
        }
    }
}

/** A notice already read — quieter, one row in the "Earlier" group. */
@Composable
internal fun EarlierNotice(notice: DriverNotificationDto, now: Long, delayMs: Int, divided: Boolean) {
    val c = Saarthi.colors
    Column(
        Modifier
            .fillMaxWidth()
            .slideIn(delayMs)
            .bottomRule(c.border, show = divided)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(notice.title, style = SType.rowTitle, color = c.muted, modifier = Modifier.weight(1f))
            Text(whenText(notice.createdAt, now), style = SType.caption, color = c.subtle, maxLines = 1)
        }
        notice.body?.takeIf { it.isNotBlank() }?.let { Text(it, style = SType.body, color = c.subtle) }
    }
}

/** Two cards shaped like notices while the first list is on its way. */
@Composable
internal fun NoticesLoading() {
    val c = Saarthi.colors
    val label = stringResource(R.string.notices_loading)
    Column(
        Modifier.semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        repeat(2) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .card()
                    .padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Skeleton(Modifier.size(40.dp), color = c.sunken, shine = c.shine, radius = 14.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Skeleton(Modifier.fillMaxWidth(0.6f).height(14.dp), color = c.sunken, shine = c.shine)
                    Skeleton(Modifier.fillMaxWidth(0.9f).height(12.dp), color = c.sunken, shine = c.shine)
                    Skeleton(Modifier.fillMaxWidth(0.3f).height(10.dp), color = c.sunken, shine = c.shine)
                }
            }
        }
    }
}

/** Nothing to show, and why — offline or refused — with a way to ask again. */
@Composable
internal fun NoticesProblem(message: String, offline: Boolean, onRetry: () -> Unit) {
    NoticeCard(
        message,
        if (offline) NoticeTone.WARNING else NoticeTone.DANGER,
        icon = if (offline) Lucide.cloudOff else Lucide.alertTriangle,
        trailing = { LinkButton(stringResource(R.string.action_try_again), onRetry) },
    )
}

/** A genuinely empty inbox, said plainly rather than left as a blank page. */
@Composable
internal fun NoticesEmpty() {
    val c = Saarthi.colors
    SaarthiCard(padding = PaddingValues(24.dp)) {
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            IconWell(Lucide.bell, well = c.sunken, ink = c.muted, size = 48.dp, radius = 16.dp)
            Text(stringResource(R.string.notices_empty_title), style = SType.cardTitle, color = c.fg)
            Text(
                stringResource(R.string.notices_empty_body),
                style = SType.body,
                color = c.muted,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** The orange unread dot, with the design's soft ring breathing out of it. */
@Composable
private fun UnreadDot() {
    val pulse by rememberLoop(800, Ease.inOut, reverse = true, rest = 0f, label = "notice-dot")
    Box(
        Modifier
            .size(9.dp)
            .drawBehind {
                val radius = size.minDimension / 2f
                drawCircle(Brand.saffron.copy(alpha = 0.45f * (1f - pulse)), radius + 6.dp.toPx() * pulse)
                drawCircle(Brand.saffron, radius)
            },
    )
}

/** "12 minutes ago", in the phone's own words; "Just now" inside the first minute. */
@Composable
private fun whenText(iso: String, now: Long): String {
    val at = remember(iso) { runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull() } ?: return ""
    if (now - at < DateUtils.MINUTE_IN_MILLIS) return stringResource(R.string.notices_just_now)
    return DateUtils.getRelativeTimeSpanString(at, now, DateUtils.MINUTE_IN_MILLIS).toString()
}

/** The design's `nt-rise`: in from 24 dp to the right, fading up. Still under reduced motion. */
private fun Modifier.slideIn(delayMs: Int): Modifier = composed {
    val reduced = LocalReducedMotion.current
    val progress = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!reduced) progress.animateTo(1f, tween(600, delayMs, Ease.out))
    }
    val travel = with(LocalDensity.current) { 24.dp.toPx() }
    graphicsLayer {
        alpha = progress.value
        translationX = (1f - progress.value) * travel
    }
}

private enum class Tone { PRIMARY, WARNING, DANGER, SUCCESS }

@Composable
private fun Tone.colors(): Pair<Color, Color> {
    val c = Saarthi.colors
    return when (this) {
        Tone.PRIMARY -> c.primarySoft to c.primary
        Tone.WARNING -> c.warningSoft to c.warning
        Tone.DANGER -> c.dangerSoft to c.danger
        Tone.SUCCESS -> c.successSoft to c.success
    }
}

private class NoticeLook(val icon: String, val tone: Tone)

/**
 * The icon and colour for a notice, from the server's notification type.
 *
 * Only the types a driver is sent are named; anything else is a plain bell
 * rather than a guess at what it means.
 */
private fun lookOf(type: String): NoticeLook = when (type) {
    "TRIP_ASSIGNED", "TRIP_STARTED", "TRIP_COMPLETED" -> NoticeLook(Lucide.navigation, Tone.PRIMARY)
    "TRIP_DELAYED", "ROUTE_DEVIATION" -> NoticeLook(Lucide.navigation, Tone.WARNING)
    "DOCUMENT_EXPIRING" -> NoticeLook(Lucide.file, Tone.WARNING)
    "DOCUMENT_EXPIRED", "DOCUMENT_REJECTED" -> NoticeLook(Lucide.file, Tone.DANGER)
    "DOCUMENT_VERIFIED" -> NoticeLook(Lucide.file, Tone.SUCCESS)
    "VERIFICATION_RESULT" -> NoticeLook(Lucide.shieldCheck, Tone.PRIMARY)
    "MAINTENANCE_DUE" -> NoticeLook(Lucide.wrench, Tone.WARNING)
    "MAINTENANCE_OVERDUE" -> NoticeLook(Lucide.wrench, Tone.DANGER)
    "DIAGNOSTIC_FAULT", "TELEMETRY_ALERT" -> NoticeLook(Lucide.alertTriangle, Tone.WARNING)
    "SOS_TRIGGERED", "SOS_RESPONDER_REQUEST", "SOS_UPDATE" -> NoticeLook(Lucide.siren, Tone.DANGER)
    "SOS_RESOLVED" -> NoticeLook(Lucide.siren, Tone.SUCCESS)
    "SECURITY_ALERT" -> NoticeLook(Lucide.shield, Tone.DANGER)
    "ACHIEVEMENT_UNLOCKED", "DRIVER_SCORE_CHANGED" -> NoticeLook(Lucide.check, Tone.SUCCESS)
    else -> NoticeLook(Lucide.bell, Tone.PRIMARY)
}
