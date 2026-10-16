package com.saarthi.owner.ui.sharing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.SharingApi
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.ago
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.ButtonRow
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * The "Shared with me" side of the Vehicles list: invitations to answer, then
 * the vehicles other people have shared, each opening to follow it and log
 * trips, fill-ups and servicing against it.
 */

/**
 * Asks the Vehicles list to open on "Shared with me" — set by the share
 * invitation alert, read and cleared by the list.
 */
object SharedScopeRequest {
    val open = mutableStateOf(false)
}

/** "Last seen 5 min ago", or that it has never reported. */
internal fun SharingApi.SharedVehicle.seenLine(): String =
    lastLocation?.recordedAt?.let { at -> ago(at).let { if (it == "now") "Reporting now" else "Last seen $it ago" } } ?: "No position yet"

/** The shared-with-me list as items of the Vehicles list. */
internal fun LazyListScope.sharedWithMeItems(
    state: Loadable<SharingApi.SharedWithMe>,
    answering: String?,
    onAnswer: (SharingApi.Invitation, Boolean) -> Unit,
    onOpen: (SharingApi.SharedVehicle) -> Unit,
    onRetry: () -> Unit,
) {
    when (state) {
        Loadable.Loading -> item(key = "shared-loading") { SkeletonCards(count = 2) }
        is Loadable.Failed -> item(key = "shared-failed") { FailedCard(state.message, onRetry) }
        is Loadable.Ready -> {
            val data = state.value
            if (data.invitations.isNotEmpty()) {
                item(key = "invitations-label") { Eyebrow("Waiting for you", Modifier.padding(start = 4.dp, top = 4.dp)) }
                items(data.invitations, key = { "invite-${it.shareId}" }) { invitation ->
                    InvitationCard(invitation, busy = answering == invitation.shareId, anyBusy = answering != null, onAnswer = onAnswer)
                }
            }
            if (data.vehicles.isEmpty() && data.invitations.isEmpty()) {
                item(key = "shared-empty") { SharedEmpty() }
            }
            if (data.vehicles.isNotEmpty()) {
                item(key = "shared-label") { Eyebrow("Shared with you", Modifier.padding(start = 4.dp, top = 4.dp)) }
                items(data.vehicles, key = { "shared-${it.shareId}" }) { vehicle -> SharedVehicleRow(vehicle) { onOpen(vehicle) } }
            }
        }
    }
}

/**
 * Invitations waiting for an answer, on Home. A share is easy to miss behind
 * the Vehicles tab, so it is offered where the person lands; accepting opens
 * the vehicle straight away. Draws nothing when there is none, or when the
 * plan has no sharing. A failed read stays quiet here: the Vehicles tab says it.
 */
@Composable
fun InvitationsOnHome(app: OwnerApp, account: SessionStore.Account, modifier: Modifier = Modifier) {
    if (!account.hasFeature(SharingApi.FEATURE)) return
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var invitations by remember { mutableStateOf<List<SharingApi.Invitation>>(emptyList()) }
    var answering by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        while (true) {
            runCatching { app.sharing.sharedWithMe() }.getOrNull()?.let { invitations = it.invitations }
            delay(HOME_REFRESH_MS)
        }
    }

    fun answer(invitation: SharingApi.Invitation, accept: Boolean) {
        answering = invitation.shareId
        problem = null
        scope.launch {
            try {
                app.sharing.respond(invitation.shareId, accept)
                val now = app.sharing.sharedWithMe()
                invitations = now.invitations
                if (accept) {
                    now.vehicles.firstOrNull { it.shareId == invitation.shareId }?.let { vehicle ->
                        navigator.push("shared-${vehicle.shareId}") { SharedVehicleScreen(app, vehicle) {} }
                    }
                }
            } catch (failure: Exception) {
                problem = failure.readable()
            }
            answering = null
        }
    }

    if (invitations.isEmpty() && problem == null) return
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        invitations.forEach { invitation ->
            InvitationCard(invitation, busy = answering == invitation.shareId, anyBusy = answering != null, onAnswer = ::answer)
        }
        problem?.let { NoticeCard(it, NoticeTone.DANGER) }
    }
}

/** Invitations are rare; Home asks for them about as often as it refreshes itself. */
private const val HOME_REFRESH_MS = 30_000L

@Composable
private fun InvitationCard(
    invitation: SharingApi.Invitation,
    busy: Boolean,
    anyBusy: Boolean,
    onAnswer: (SharingApi.Invitation, Boolean) -> Unit,
) {
    val c = Saarthi.colors
    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 22.dp, ring = c.primaryRing)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            IconWell(Lucide.users, well = c.primarySoft, ink = c.primary, size = 40.dp, shape = CircleShape, iconSize = 18.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    "${invitation.invitedBy} wants to share a ${invitation.typeLabel.lowercase().ifBlank { "vehicle" }} with you",
                    style = SType.bodyStrong,
                    color = c.fg,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                PlateChip(invitation.registrationNumber)
                if (invitation.ownerName.isNotBlank() && invitation.ownerName != invitation.invitedBy) {
                    Text("Owned by ${invitation.ownerName}", style = SType.caption, color = c.muted)
                }
            }
        }
        Text(
            "You will be able to follow it and log trips, fuel and servicing. You never see its costs, finance or papers.",
            style = SType.small,
            color = c.muted,
        )
        ButtonRow {
            SaarthiButton(
                "Accept",
                onClick = { onAnswer(invitation, true) },
                busy = busy,
                enabled = !anyBusy,
                height = 48.dp,
                modifier = Modifier.weight(1f),
            )
            SaarthiButton(
                "Decline",
                onClick = { onAnswer(invitation, false) },
                tone = ButtonTone.SECONDARY,
                enabled = !anyBusy,
                height = 48.dp,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun SharedVehicleRow(vehicle: SharingApi.SharedVehicle, onOpen: () -> Unit) {
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .pressable(scale = 0.98f, label = "Open ${vehicle.registrationNumber}", onClick = onOpen)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconWell(Lucide.car, well = c.sunken, ink = c.fg, size = 46.dp, radius = 14.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PlateChip(vehicle.registrationNumber)
                StatusPill(vehicle.typeLabel.ifBlank { "Vehicle" }, background = c.sunken, ink = c.muted, dot = false)
            }
            Text(
                listOfNotNull(vehicle.makeAndModel, "Shared by ${vehicle.ownerName}".takeIf { vehicle.ownerName.isNotBlank() }).joinToString(" · "),
                style = SType.small,
                color = c.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(vehicle.seenLine(), style = SType.caption, color = c.subtle)
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}

@Composable
private fun SharedEmpty() {
    val c = Saarthi.colors
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 36.dp, start = 12.dp, end = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        IconWell(Lucide.users, well = c.sunken, ink = c.muted, size = 64.dp, shape = CircleShape, iconSize = 26.dp)
        Text("No vehicles shared with you", style = SType.bodyStrong, color = c.fg)
        Text(
            "When someone on Saarthi shares a vehicle with you, it appears here to track and log trips, fuel and servicing against.",
            style = SType.small,
            color = c.muted,
        )
    }
}
