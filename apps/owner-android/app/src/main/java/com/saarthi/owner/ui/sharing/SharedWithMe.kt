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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.LiveRidesApi
import com.saarthi.owner.network.SharingApi
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.ButtonRow
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.fleet.VehicleCard
import com.saarthi.owner.ui.fleet.VehicleRow
import com.saarthi.owner.ui.rides.LiveRideRow
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * The "Shared with me" side of the Vehicles list: family sharing a live ride
 * first, then invitations to answer, then the vehicles other people have
 * shared, each opening to follow it and log trips, fill-ups and servicing
 * against it.
 */

/**
 * Asks the Vehicles list to open on "Shared with me" — set by the share
 * invitation alert, read and cleared by the list.
 */
object SharedScopeRequest {
    val open = mutableStateOf(false)
}

/**
 * The shared-with-me list as items of the Vehicles list. [liveRides] are read
 * with it but apart, so they show even when the vehicles could not be read.
 */
internal fun LazyListScope.sharedWithMeItems(
    state: Loadable<SharingApi.SharedWithMe>,
    liveRides: List<LiveRidesApi.RideSharedWithMe>,
    cards: Boolean,
    answering: String?,
    onAnswer: (SharingApi.Invitation, Boolean) -> Unit,
    onOpen: (SharingApi.SharedVehicle) -> Unit,
    onOpenRide: (LiveRidesApi.RideSharedWithMe) -> Unit,
    onRetry: () -> Unit,
) {
    if (liveRides.isNotEmpty()) {
        item(key = "live-rides-label") { Eyebrow(stringResource(R.string.rides_live_section), Modifier.padding(start = 4.dp, top = 4.dp)) }
        items(liveRides, key = { "live-ride-${it.id}" }) { ride -> LiveRideRow(ride, onOpen = { onOpenRide(ride) }) }
    }
    when (state) {
        Loadable.Loading -> item(key = "shared-loading") { SkeletonCards(count = 2) }
        is Loadable.Failed -> item(key = "shared-failed") { FailedCard(state.message, onRetry) }
        is Loadable.Ready -> {
            val data = state.value
            if (data.invitations.isNotEmpty()) {
                item(key = "invitations-label") { Eyebrow(stringResource(R.string.people_shared_waiting), Modifier.padding(start = 4.dp, top = 4.dp)) }
                items(data.invitations, key = { "invite-${it.shareId}" }) { invitation ->
                    InvitationCard(invitation, busy = answering == invitation.shareId, anyBusy = answering != null, onAnswer = onAnswer)
                }
            }
            if (data.vehicles.isEmpty() && data.invitations.isEmpty() && liveRides.isEmpty()) {
                item(key = "shared-empty") { SharedEmpty() }
            }
            if (data.vehicles.isNotEmpty()) {
                item(key = "shared-label") { Eyebrow(stringResource(R.string.people_shared_with_you), Modifier.padding(start = 4.dp, top = 4.dp)) }
                items(data.vehicles, key = { "shared-${it.shareId}" }) { vehicle ->
                    // The owner's card and row, with who shared it under the name.
                    val sharedBy = vehicle.ownerName.ifBlank { null }?.let { stringResource(R.string.people_shared_by, it) }
                    if (cards) VehicleCard(vehicle.asVehicle(), { onOpen(vehicle) }, note = sharedBy)
                    else VehicleRow(vehicle.asVehicle(), { onOpen(vehicle) }, note = sharedBy)
                }
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
                    stringResource(
                        R.string.people_shared_invite_line,
                        invitation.invitedBy,
                        invitation.typeLabel.lowercase().ifBlank { stringResource(R.string.people_vehicle_lower) },
                    ),
                    style = SType.bodyStrong,
                    color = c.fg,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                PlateChip(invitation.registrationNumber)
                if (invitation.ownerName.isNotBlank() && invitation.ownerName != invitation.invitedBy) {
                    Text(stringResource(R.string.people_shared_owned_by, invitation.ownerName), style = SType.caption, color = c.muted)
                }
            }
        }
        Text(
            stringResource(R.string.people_shared_invite_body),
            style = SType.small,
            color = c.muted,
        )
        ButtonRow {
            SaarthiButton(
                stringResource(R.string.people_shared_accept),
                onClick = { onAnswer(invitation, true) },
                busy = busy,
                enabled = !anyBusy,
                height = 48.dp,
                modifier = Modifier.weight(1f),
            )
            SaarthiButton(
                stringResource(R.string.people_shared_decline),
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
        Text(stringResource(R.string.people_shared_empty_title), style = SType.bodyStrong, color = c.fg)
        Text(
            stringResource(R.string.people_shared_empty_body),
            style = SType.small,
            color = c.muted,
        )
    }
}
