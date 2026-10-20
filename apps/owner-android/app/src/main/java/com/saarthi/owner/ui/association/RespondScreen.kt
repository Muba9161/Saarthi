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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.AssociationApi
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.dial
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.Brand
import com.saarthi.owner.ui.design.ButtonRow
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.Hint
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
import com.saarthi.owner.ui.design.SaarthiField
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
 * answers, in the order the server allows them. A fresh alert is taken first
 * (acknowledged), because that audited act is what unseals the driver's number
 * and what lets anyone be put down as going. Only then come I'm going, call
 * them and resolve; call 112 is always there. "I'm going" is offered only after
 * the case is taken, not folded into the same tap, so each state has exactly
 * one main action. Marking it resolved asks what was done, because that line
 * is the association's record.
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
    var note by remember { mutableStateOf("") }
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
            message = try {
                call()
                done to NoticeTone.SUCCESS
            } catch (failure: Exception) {
                // The server's own words: it knows why it refused.
                failure.readable() to NoticeTone.DANGER
            }
            // Re-read either way: a refusal usually means someone else moved the case on.
            runCatching { app.association.get(alert.id) }.getOrNull()?.let { alert = it }
            onChanged()
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
                vehicles = listOf(MapVehicle(alert.id, lat, lng, MarkerState.ALERT, alert.vehicleRegistration?.let(::formatPlate) ?: stringResource(R.string.ui_association_sos))),
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
            CircleButton(Lucide.chevronLeft, stringResource(R.string.action_back), navigator::pop, size = 46.dp)
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
                    listOfNotNull(
                        stringResource(if (alert.open) R.string.ui_association_sos else R.string.ui_association_resolved),
                        alert.distanceKm?.let { stringResource(R.string.common_distance_km, "%.1f".format(it)) },
                    ).joinToString(" · "),
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
                // The note field rides up on the keyboard, so what is typed and its button stay in sight.
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Eyebrow(
                stringResource(
                    if (alert.overdue && alert.open) R.string.ui_association_raised_unanswered else R.string.ui_association_raised,
                    ageWords(alert.ageMinutes),
                ),
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
                        !alert.open -> pluralStringResource(R.plurals.ui_association_members_responded, alert.responderCount, alert.responderCount)
                        alert.awaitingAcknowledgement -> stringResource(R.string.ui_association_nobody_taken)
                        going && alert.responderCount > 1 ->
                            pluralStringResource(R.plurals.ui_association_you_and_more_going, alert.responderCount - 1, alert.responderCount - 1)
                        going -> stringResource(R.string.ui_association_you_are_going)
                        alert.responderCount > 0 -> pluralStringResource(R.plurals.ui_association_already_going, alert.responderCount, alert.responderCount)
                        else -> stringResource(R.string.ui_association_nobody_going)
                    },
                    style = SType.bodyStrong,
                    color = c.fg,
                )
            }
            message?.let { (text, tone) -> RevealedNotice(text, tone) }

            if (alert.open) {
                if (alert.awaitingAcknowledgement) {
                    // The server will not put anyone down as going until a named member has taken the case.
                    SaarthiField(
                        note,
                        { note = it.take(1000) },
                        label = stringResource(R.string.ui_association_note_label),
                        placeholder = stringResource(R.string.ui_association_note_placeholder),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    )
                    SaarthiButton(
                        stringResource(R.string.ui_association_acknowledge),
                        onClick = {
                            act(Words.get(R.string.ui_association_case_taken)) {
                                // Shown at once, even if the re-read after it fails: a second tap would only be refused.
                                app.association.acknowledge(alert.id, note)?.let { alert = it }
                                note = ""
                            }
                        },
                        busy = busy,
                        leading = Lucide.shieldCheck,
                    )
                } else if (!going) {
                    // Once you've said you're going, saying it again would only count you twice.
                    SaarthiButton(
                        stringResource(R.string.ui_association_im_going),
                        onClick = { act(Words.get(R.string.ui_association_down_as_responding)) { app.association.respond(alert.id, account.userId) } },
                        busy = busy,
                        leading = Lucide.navigation,
                    )
                }
                ButtonRow {
                    SaarthiButton(
                        stringResource(R.string.ui_association_call_driver),
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
                        Text(stringResource(R.string.ui_association_call_112), style = SType.button, color = Color.White)
                    }
                }
                when {
                    alert.awaitingAcknowledgement -> Hint(stringResource(R.string.ui_association_hint_sealed))
                    phone == null -> Hint(stringResource(R.string.ui_association_hint_no_number))
                }
                // A case can be resolved only once it has been taken, never straight from NOTIFIED.
                if (alert.taken) {
                    LinkButton(stringResource(R.string.ui_association_mark_as_resolved), { resolving = true }, color = c.muted, style = SType.smallStrong)
                }
            } else {
                alert.outcome?.let { NoticeCard(it, NoticeTone.SUCCESS, icon = Lucide.check) }
            }
        }

        BottomSheet(visible = resolving, onDismiss = { resolving = false }) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(stringResource(R.string.ui_association_what_was_done), style = SType.sheetTitle, color = c.fg)
                NotesField(outcome, { outcome = it.take(2000) }, label = stringResource(R.string.ui_association_record_label), minHeight = 90.dp)
                SaarthiButton(
                    stringResource(R.string.ui_association_mark_resolved),
                    onClick = {
                        resolving = false
                        act(Words.get(R.string.ui_association_resolved_done)) { app.association.resolve(alert.id, outcome.trim()) }
                    },
                    enabled = outcome.trim().length >= 3,
                )
            }
        }
    }
}
