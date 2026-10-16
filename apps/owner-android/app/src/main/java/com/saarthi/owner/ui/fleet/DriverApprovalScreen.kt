package com.saarthi.owner.ui.fleet

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.network.FleetApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.countdown
import com.saarthi.owner.ui.common.plural
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.Avatar
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.NotesField
import com.saarthi.owner.ui.design.RippleRings
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SlideToAct
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.brandGradient
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The reasons an owner most often gives; any other is typed. */
private val Reasons = listOf("Not assigned to this vehicle", "Vehicle is not ready", "I don't know this driver")

/**
 * "Approve a driver" — the design's driver request, full screen.
 *
 * Who is at the vehicle, the photo they took on arrival, whether their
 * licence holds, how often they have driven this truck, and what has happened
 * so far. Approving is a slide, so a pocket cannot do it; turning down asks
 * for the reason the driver will be shown.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DriverApprovalScreen(app: OwnerApp, approval: FleetApi.Approval, canApprove: Boolean = true, onDecided: () -> Unit) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var detail by remember { mutableStateOf<FleetApi.ApprovalDetail?>(null) }
    var declining by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(approval.id) {
        detail = runCatching { app.fleet.approvalDetail(approval.id) }.getOrNull()
    }
    val photo by produceState<ImageBitmap?>(null, detail?.selfieUrl) {
        val url = detail?.selfieUrl ?: return@produceState
        val bytes = runCatching { app.api.image(url) }.getOrNull() ?: return@produceState
        value = withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() }
    }
    val left by produceState(approval.secondsUntilEscalation ?: 0L, approval.id) {
        while (value > 0) {
            delay(1_000)
            value -= 1
        }
    }

    val driver = detail?.driver ?: approval.driver?.let { FleetApi.ApprovalDriver(it.name, it.experienceYears, it.totalTrips) }
    val name = driver?.name?.ifBlank { null } ?: "A driver"
    val first = name.substringBefore(' ')
    val timesHere = detail?.recentAssignments?.count { it.sameVehicle && it.status in setOf("APPROVED", "READY", "TRIP_ACTIVE", "COMPLETED") } ?: 0

    fun decide(call: suspend () -> Unit) {
        busy = true
        error = null
        scope.launch {
            try {
                call()
                onDecided()
                navigator.pop()
            } catch (failure: Exception) {
                busy = false
                error = failure.readable()
            }
        }
    }

    DetailScreen(
        eyebrow = "Driver request",
        title = "Approve a driver",
        eyebrowColor = c.warning,
        // A role that may see the request but not decide it gets the facts and no buttons.
        footer = if (canApprove) {
            {
                SlideToAct("Slide to approve $first", onConfirm = { decide { app.fleet.approve(approval.id) } }, enabled = !busy)
                SaarthiButton("Turn this down", onClick = { declining = true }, tone = ButtonTone.DANGER_OUTLINE, enabled = !busy, leading = Lucide.ban, height = 50.dp)
            }
        } else {
            null
        },
    ) {
        if (!canApprove) {
            NoticeCard("An owner or fleet manager approves or turns down this request.", NoticeTone.INFO, Modifier.rise())
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(170.dp)
                .rise()
                .clip(RoundedCornerShape(26.dp))
                .brandGradient(RoundedCornerShape(26.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(96.dp), contentAlignment = Alignment.Center) {
                RippleRings(c.warning.copy(alpha = 0.6f), periodMs = 2_600, from = 0.5f, to = 1.6f, startAlpha = 1f, count = 3)
                IconWell(Lucide.truck, well = c.card, ink = c.primary, size = 52.dp, shape = CircleShape, iconSize = 24.dp)
            }
            Row(
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(12.dp)
                    .clip(CircleShape)
                    .background(c.canvas.copy(alpha = 0.85f))
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(c.warning))
                Text(
                    if (left > 0) "${countdown(left)} left to decide" else "Waiting for you",
                    style = SType.smallStrong,
                    color = c.fg,
                )
            }
        }

        Row(
            Modifier.fillMaxWidth().rise(stagger(1)).card(radius = 24.dp).padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            val shot = photo
            if (shot != null) {
                Image(shot, "Photo $first took on arrival", contentScale = ContentScale.Crop, modifier = Modifier.size(width = 84.dp, height = 104.dp).clip(RoundedCornerShape(16.dp)))
            } else {
                Avatar(name, size = 72.dp, background = c.sunken, ink = c.fg)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(name, style = SType.cardTitle.copy(fontSize = 19.sp), color = c.fg)
                driver?.licenseClass?.let { Text("Licence $it", style = SType.small, color = c.muted) }
                when (driver?.licenseValidity) {
                    "VALID" -> StatusPill("Licence valid", background = c.successBg, ink = c.success)
                    "EXPIRING_SOON" -> StatusPill("Licence expiring soon", background = c.warningBg, ink = c.warning)
                    "EXPIRED" -> StatusPill("Licence expired", background = c.dangerBg, ink = c.danger)
                    else -> Unit
                }
                Text(
                    if (timesHere > 0) "Has driven this truck ${plural(timesHere, "time")}" else "First time on this truck",
                    style = SType.small,
                    color = c.muted,
                )
                driver?.let {
                    Text("${plural(it.experienceYears, "year")} driving · ${plural(it.totalTrips, "trip")}", style = SType.caption, color = c.subtle)
                }
            }
        }

        Row(
            Modifier.fillMaxWidth().rise(stagger(2)).card(radius = 22.dp).padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Eyebrow("Vehicle")
                PlateChip(approval.registrationNumber, size = 16.sp)
            }
            StatusPill("Awaiting you", background = c.warningBg, ink = c.warning, live = true)
        }

        detail?.events?.takeIf { it.isNotEmpty() }?.let { events ->
            Column(Modifier.fillMaxWidth().rise(stagger(3)).card(radius = 22.dp).padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                events.forEachIndexed { index, event ->
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(
                            Modifier
                                .padding(top = 4.dp)
                                .size(12.dp)
                                .clip(CircleShape)
                                .background(if (index == events.lastIndex) c.primary else c.success),
                        )
                        Column(Modifier.weight(1f)) {
                            Text(event.description ?: event.eventType.lowercase().replace('_', ' '), style = SType.bodyStrong, color = c.fg)
                            clockOf(event.createdAt)?.let { Text(it, style = SType.caption, color = c.muted) }
                        }
                    }
                }
            }
        }
        Text("Nobody is approved automatically — this waits for you.", style = SType.caption, color = c.subtle, modifier = Modifier.width(300.dp))
        error?.let { RevealedNotice(it, NoticeTone.DANGER) }
    }

    BottomSheet(visible = declining, onDismiss = { declining = false }) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Why? $first will see this", style = SType.sheetTitle, color = c.fg)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Reasons.forEach { option -> ChoiceChip(option, selected = reason == option, onClick = { reason = option }) }
            }
            NotesField(reason, { reason = it.take(500) }, label = "Or say it in your words", minHeight = 80.dp)
            SaarthiButton(
                "Turn down",
                onClick = {
                    declining = false
                    decide { app.fleet.reject(approval.id, reason.trim()) }
                },
                tone = ButtonTone.DANGER_OUTLINE,
                enabled = reason.trim().length >= 3 && !busy,
            )
        }
    }
}
