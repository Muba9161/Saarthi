package com.saarthi.owner.ui.drive

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.km
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.LiveDot
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.NotesField
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SlideToAct
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.trips.tripStatusLook

/** Whether the phone is recording the road, and the one thing to do when it is not. */
@Composable
internal fun GpsRow(recording: Boolean, paused: Boolean, allowed: Boolean, underway: Boolean, onAllow: () -> Unit, onResume: () -> Unit) {
    val c = Saarthi.colors
    Row(
        Modifier.fillMaxWidth().card(radius = 18.dp).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (recording) LiveDot(c.success, size = 9.dp) else LineIcon(Lucide.mapPin, size = 18.dp, color = if (underway) c.warning else c.muted)
        Column(Modifier.weight(1f)) {
            Text(
                stringResource(
                    when {
                        recording -> R.string.costs_drive_gps_recording
                        !allowed -> R.string.costs_drive_gps_off
                        paused -> R.string.costs_drive_gps_paused
                        underway -> R.string.costs_drive_gps_not_yet
                        else -> R.string.costs_drive_gps_idle
                    },
                ),
                style = SType.bodyStrong,
                color = c.fg,
            )
            Text(
                stringResource(
                    when {
                        recording -> R.string.costs_drive_gps_recording_detail
                        !allowed -> R.string.costs_drive_gps_off_detail
                        paused -> R.string.costs_drive_gps_paused_detail
                        else -> R.string.costs_drive_gps_idle_detail
                    },
                ),
                style = SType.caption,
                color = c.muted,
            )
        }
        when {
            recording -> Unit
            !allowed -> LinkButton(stringResource(R.string.costs_drive_allow), onClick = onAllow, style = SType.smallStrong)
            underway -> LinkButton(stringResource(R.string.costs_drive_resume), onClick = onResume, style = SType.smallStrong)
        }
    }
}

/**
 * One trip of the driver's: where from and to, how it stands, and the one big
 * button its state calls for — slide to start, Arrived, slide to complete.
 */
@Composable
internal fun DriveTripCard(
    trip: TripsApi.Trip,
    current: Boolean,
    busy: Boolean,
    startBlockedBy: String?,
    onStart: () -> Unit,
    onArrived: () -> Unit,
    onComplete: () -> Unit,
    onEndHere: () -> Unit,
    onMaps: () -> Unit,
    onOpen: () -> Unit,
) {
    val c = Saarthi.colors
    val status = trip.status
    Column(
        Modifier.fillMaxWidth().card(radius = 24.dp, ring = if (current) c.primary else c.ring).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Eyebrow(stringResource(if (current) R.string.costs_drive_on_this_trip else R.string.costs_drive_up_next), Modifier.weight(1f))
            val look = tripStatusLook(status)
            StatusPill(look.word, background = look.ground, ink = look.ink, live = status in TripWalk.MOVING)
        }
        Column(Modifier.pressable(scale = 0.99f, label = stringResource(R.string.costs_drive_open_trip), onClick = onOpen), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(trip.originAddress.substringBefore(','), style = SType.small, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("→ ${trip.destinationAddress}", style = SType.bodyStrong, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(
                    trip.reference.ifBlank { null },
                    trip.remainingKm?.takeIf { status in TripWalk.MOVING }?.let { stringResource(R.string.costs_drive_to_go, km(it).orEmpty()) },
                    clockOf(trip.etaAt)?.takeIf { status in TripWalk.MOVING }?.let { stringResource(R.string.costs_drive_eta, it) },
                    trip.order?.materialName?.ifBlank { null },
                ).joinToString(" · "),
                style = SType.caption,
                color = c.subtle,
            )
        }
        when (status) {
            in TripWalk.NOT_STARTED -> {
                if (startBlockedBy != null) {
                    Text(startBlockedBy, style = SType.small, color = c.muted)
                } else {
                    SlideToAct(stringResource(R.string.costs_drive_slide_start), onConfirm = onStart, enabled = !busy)
                }
            }
            in TripWalk.MOVING -> {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SaarthiButton(stringResource(R.string.costs_drive_arrived), onClick = onArrived, busy = busy, busyText = stringResource(R.string.costs_drive_saving), leading = Lucide.flag, modifier = Modifier.weight(1f))
                    SaarthiButton("Google Maps", onClick = onMaps, tone = ButtonTone.SECONDARY, leading = Lucide.navigation, modifier = Modifier.weight(1f))
                }
                LinkButton(stringResource(R.string.costs_drive_end_here), onClick = onEndHere, enabled = !busy, color = c.danger, style = SType.smallStrong, modifier = Modifier.align(Alignment.CenterHorizontally))
            }
            in TripWalk.AT_SITE -> SlideToAct(stringResource(R.string.costs_drive_slide_complete), onConfirm = onComplete, enabled = !busy)
        }
    }
}

/** The vehicle's GPS put it at the destination; the driver says whether it has arrived. */
@Composable
internal fun ArrivalPrompt(destination: String, busy: Boolean, onConfirm: () -> Unit) {
    val c = Saarthi.colors
    Column(
        Modifier.fillMaxWidth().card(radius = 22.dp, color = c.successSoft, ring = c.success).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(stringResource(R.string.costs_drive_at, destination.substringBefore(',')), style = SType.bodyStrong, color = c.fg)
        Text(stringResource(R.string.costs_drive_confirm_arrival), style = SType.small, color = c.muted)
        SaarthiButton(stringResource(R.string.costs_drive_yes_arrived), onClick = onConfirm, busy = busy, busyText = stringResource(R.string.costs_drive_saving), height = 48.dp)
    }
}

/** Fuel, a slip, and SOS — what a driver reaches for on the road. */
@Composable
internal fun DriveTools(onFuel: () -> Unit, onSlip: () -> Unit, onSos: (() -> Unit)?) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Tool(stringResource(R.string.costs_drive_log_fuel), Lucide.fuel, Modifier.weight(1f), onClick = onFuel)
        Tool(stringResource(R.string.costs_drive_file_slip), Lucide.receipt, Modifier.weight(1f), onClick = onSlip)
        onSos?.let { Tool(stringResource(R.string.costs_drive_sos), Lucide.siren, Modifier.weight(1f), danger = true, onClick = it) }
    }
}

@Composable
private fun Tool(label: String, icon: String, modifier: Modifier, danger: Boolean = false, onClick: () -> Unit) {
    val c = Saarthi.colors
    Column(
        modifier.card(radius = 20.dp, ring = if (danger) c.danger else c.ring).pressable(scale = 0.95f, label = label, onClick = onClick).padding(vertical = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        IconWell(icon, well = if (danger) c.dangerSoft else c.primarySoft, ink = if (danger) c.danger else c.primary, size = 42.dp, radius = 14.dp, iconSize = 20.dp)
        Text(label, style = SType.smallStrong, color = if (danger) c.danger else c.fg)
    }
}

/** The server's SOS kinds, in the words a driver picks from. */
private val SOS_KINDS: List<Pair<String, String>>
    get() = listOf(
        "ACCIDENT" to Words.get(R.string.costs_drive_sos_accident),
        "MEDICAL" to Words.get(R.string.costs_drive_sos_medical),
        "BREAKDOWN" to Words.get(R.string.costs_drive_sos_breakdown),
        "SECURITY" to Words.get(R.string.costs_drive_sos_security),
        "TYRE" to Words.get(R.string.costs_drive_sos_tyre),
        "FUEL" to Words.get(R.string.costs_drive_sos_fuel),
        "OTHER" to Words.get(R.string.costs_drive_sos_other),
    )

/** Raising an SOS: what happened, a word if there is time, and a slide so a pocket cannot send it. */
@Composable
internal fun SosSheet(visible: Boolean, busy: Boolean, error: String?, onSend: (String, String) -> Unit, onDismiss: () -> Unit) {
    val c = Saarthi.colors
    var kind by remember(visible) { mutableStateOf("ACCIDENT") }
    var words by remember(visible) { mutableStateOf("") }
    BottomSheet(visible = visible, onDismiss = { if (!busy) onDismiss() }) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(stringResource(R.string.costs_drive_sos_title), style = SType.sheetTitle, color = c.danger)
            Text(stringResource(R.string.costs_drive_sos_intro), style = SType.body, color = c.muted)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SOS_KINDS.forEach { (code, label) -> ChoiceChip(label, selected = kind == code, onClick = { kind = code }, height = 36.dp) }
            }
            NotesField(words, { words = it.take(1000) }, label = stringResource(R.string.costs_drive_sos_what), minHeight = 64.dp)
            error?.let { NoticeCard(it, NoticeTone.DANGER) }
            SlideToAct(stringResource(R.string.costs_drive_sos_slide), onConfirm = { onSend(kind, words.trim()) }, enabled = !busy, modifier = Modifier.padding(bottom = 4.dp))
        }
    }
}

/** Ending a trip short of where it was going, with how far short said first. */
@Composable
internal fun EndHereSheet(visible: Boolean, destination: String, kmShort: Double?, busy: Boolean, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val c = Saarthi.colors
    BottomSheet(visible = visible, onDismiss = { if (!busy) onDismiss() }) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(stringResource(R.string.costs_drive_end_title), style = SType.sheetTitle, color = c.fg)
            Text(
                kmShort?.let { stringResource(R.string.costs_drive_end_body_short, it, destination.substringBefore(',')) }
                    ?: stringResource(R.string.costs_drive_end_body),
                style = SType.body,
                color = c.muted,
            )
            SaarthiButton(stringResource(R.string.costs_drive_end_confirm), onClick = onConfirm, tone = ButtonTone.DANGER_OUTLINE, busy = busy, busyText = stringResource(R.string.costs_drive_ending))
        }
    }
}
