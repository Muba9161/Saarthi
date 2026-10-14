package com.saarthi.owner.ui.association

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.AssociationApi
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.common.dial
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.Brand
import com.saarthi.owner.ui.design.ButtonRow
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.LiveDot
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.NotesField
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.map.MapVehicle
import com.saarthi.owner.ui.map.MarkerState
import com.saarthi.owner.ui.map.VehicleMap
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val REFRESH_MS = 10_000L

/**
 * One member's SOS — the design's Association · Respond.
 *
 * Where they are on the map, who they are, who is already going; and the
 * three answers: I'm going, call them, call 112. Marking it resolved asks
 * what was done, because that line is the association's record.
 */
@Composable
fun RespondScreen(app: OwnerApp, account: SessionStore.Account, initial: AssociationApi.Alert, onChanged: () -> Unit) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var alert by remember { mutableStateOf(initial) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }
    var resolving by remember { mutableStateOf(false) }
    var outcome by remember { mutableStateOf("") }
    var focus by remember { mutableIntStateOf(0) }

    LaunchedEffect(initial.id) {
        while (true) {
            runCatching { app.association.get(initial.id) }.getOrNull()?.let { alert = it }
            focus++
            delay(REFRESH_MS)
        }
    }

    fun act(done: String, call: suspend () -> Unit) {
        busy = true
        message = null
        scope.launch {
            try {
                call()
                runCatching { app.association.get(alert.id) }.getOrNull()?.let { alert = it }
                message = done to NoticeTone.SUCCESS
                onChanged()
            } catch (failure: Exception) {
                message = failure.readable() to NoticeTone.DANGER
            }
            busy = false
        }
    }

    val phone = alert.driverPhone ?: alert.contactPhone
    val going = alert.isGoing(account.userId)
    val sheetPx = with(LocalDensity.current) { 360.dp.roundToPx() }

    Box(Modifier.fillMaxSize().background(c.canvas)) {
        val lat = alert.latitude
        val lng = alert.longitude
        if (lat != null && lng != null) {
            VehicleMap(
                vehicles = listOf(MapVehicle(alert.id, lat, lng, MarkerState.ALERT, alert.vehicleRegistration?.let(::formatPlate) ?: "SOS")),
                selectedId = alert.id,
                onSelect = {},
                focusRequest = focus,
                bottomPaddingPx = sheetPx,
                modifier = Modifier.fillMaxSize(),
            )
        }
        Row(
            Modifier
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            CircleButton(Lucide.chevronLeft, "Back", navigator::pop, size = 46.dp)
            Row(
                Modifier
                    .clip(RoundedCornerShape(23.dp))
                    .background(c.elevated)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                LiveDot(if (alert.open) c.danger else c.success, breathing = alert.open)
                Text(
                    listOfNotNull(if (alert.open) "SOS" else "Resolved", alert.distanceKm?.let { "%.1f km".format(it) }).joinToString(" · "),
                    style = SType.bodyStrong,
                    color = c.fg,
                )
            }
        }

        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                .background(c.card)
                .windowInsetsPadding(WindowInsets.navigationBars)
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Eyebrow(
                "Raised ${ageWords(alert.ageMinutes)}${if (alert.overdue && alert.open) " · not answered yet" else ""}",
                color = if (alert.open) c.danger else c.muted,
            )
            alert.vehicleRegistration?.let { PlateChip(it, size = 18.sp) }
            Text(
                listOfNotNull(alert.driverName, alert.fleetName, alert.address?.substringBefore(',')).joinToString(" · "),
                style = SType.small,
                color = c.muted,
            )
            alert.description?.ifBlank { null }?.let { Text(it, style = SType.body, color = c.fg) }
            Row(
                Modifier.fillMaxWidth().card(radius = 18.dp, color = c.sunken, elevated = false).padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                IconWell(Lucide.users, well = c.successSoft, ink = c.success, size = 36.dp, radius = 12.dp, iconSize = 16.dp)
                Text(
                    when {
                        !alert.open -> if (alert.responderCount == 1) "1 member responded" else "${alert.responderCount} members responded"
                        going && alert.responderCount > 1 -> "You and ${alert.responderCount - 1} more are going"
                        going -> "You're going"
                        alert.responderCount > 0 -> "${alert.responderCount} already going"
                        else -> "Nobody is going yet"
                    },
                    style = SType.bodyStrong,
                    color = c.fg,
                )
            }
            message?.let { (text, tone) -> RevealedNotice(text, tone) }

            if (alert.open) {
                // Once you've said you're going, saying it again would only count you twice.
                if (!going) {
                    SaarthiButton(
                        "I'm going",
                        onClick = { act("You're down as responding. The driver has been told.") { app.association.respond(alert.id, account.userId) } },
                        busy = busy,
                        leading = Lucide.navigation,
                    )
                }
                ButtonRow {
                    SaarthiButton(
                        "Call driver",
                        onClick = { phone?.let { context.dial(it) } },
                        tone = ButtonTone.SECONDARY,
                        enabled = phone != null,
                        modifier = Modifier.weight(1f),
                    )
                    Box(
                        Modifier
                            .weight(1f)
                            .height(56.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(Brand.sosBanner)
                            .pressable(scale = 0.985f) { context.dial("112") },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("Call 112", style = SType.button, color = Color.White)
                    }
                }
                if (alert.status == "NOTIFIED") {
                    LinkButton("Acknowledge without going", { act("Acknowledged.") { app.association.acknowledge(alert.id) } }, style = SType.smallStrong)
                }
                LinkButton("Mark as resolved", { resolving = true }, color = c.muted, style = SType.smallStrong)
            } else {
                alert.outcome?.let { NoticeCard(it, NoticeTone.SUCCESS, icon = Lucide.check) }
            }
        }

        BottomSheet(visible = resolving, onDismiss = { resolving = false }) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("What was done?", style = SType.sheetTitle, color = c.fg)
                NotesField(outcome, { outcome = it.take(2000) }, label = "This is the association's record", minHeight = 90.dp)
                SaarthiButton(
                    "Mark resolved",
                    onClick = {
                        resolving = false
                        act("Resolved.") { app.association.resolve(alert.id, outcome.trim()) }
                    },
                    enabled = outcome.trim().length >= 3,
                )
            }
        }
    }
}
