package com.saarthi.owner.ui.personal

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rememberPhoto
import com.saarthi.owner.ui.common.vehiclePhotoOf
import com.saarthi.owner.ui.design.Avatar
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.Brand
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SaarthiField
import com.saarthi.owner.ui.design.bottomRule
import com.saarthi.owner.ui.design.brandGradient
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import kotlinx.coroutines.launch

/**
 * Who a vehicle is shared with — the design's Personal · Sharing.
 *
 * Up to three people, each on their own Saarthi account. They see where it
 * is and add trips, fuel and service; only the owner changes its papers or
 * removes it, and only the owner pays for it.
 */
@Composable
fun SharingScreen(app: OwnerApp, initial: VehiclesApi.Vehicle) {
    val c = Saarthi.colors
    var vehicle by remember { mutableStateOf(initial) }
    var sheetError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    var shares by remember { mutableStateOf<List<PapersApi.Share>>(emptyList()) }
    var reload by remember { mutableIntStateOf(0) }
    var inviting by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }

    LaunchedEffect(initial.id, reload) {
        runCatching { app.vehicles.get(initial.id) }.getOrNull()?.let { vehicle = it }
        shares = runCatching { app.papers.shares(vehicle.id) }.getOrDefault(emptyList())
            .filter { it.status != "REVOKED" && it.status != "DECLINED" }
    }
    val left = (PapersApi.MAX_SHARES - shares.size).coerceAtLeast(0)

    DetailScreen(
        eyebrow = "${vehicle.typeLabel.ifBlank { "Vehicle" }} · ${formatPlate(vehicle.registrationNumber)}",
        title = "Sharing",
        footer = {
            SaarthiButton("Invite someone", onClick = { inviting = true }, leading = Lucide.users, enabled = left > 0 && vehicle.ownershipConfirmed)
            Text("They sign in with their own Saarthi account.", style = SType.caption, color = c.subtle, modifier = Modifier.fillMaxWidth())
        },
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(170.dp)
                .rise()
                .shadow(16.dp, RoundedCornerShape(28.dp), spotColor = Color(0xBF021D40), ambientColor = Color.Transparent)
                .brandGradient(RoundedCornerShape(28.dp)),
        ) {
            val photo = vehiclePhotoOf(vehicle.artType)?.let { rememberPhoto(it) }
            if (photo != null) {
                Image(photo, null, contentScale = ContentScale.Fit, modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp).size(width = 140.dp, height = 76.dp))
            }
            Row(Modifier.padding(22.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Box(Modifier.size(82.dp), contentAlignment = Alignment.Center) {
                    val track = Color.White.copy(alpha = 0.2f)
                    Canvas(Modifier.size(82.dp)) {
                        val stroke = 8.dp.toPx()
                        drawArc(track, 0f, 360f, false, style = Stroke(stroke))
                        drawArc(Brand.live, -90f, 360f * shares.size / PapersApi.MAX_SHARES, false, style = Stroke(stroke, cap = StrokeCap.Round))
                    }
                    Text("${shares.size}/${PapersApi.MAX_SHARES}", style = SType.bodyStrong, color = Color.White)
                }
                Column {
                    Eyebrow("Shared with", color = Color.White.copy(alpha = 0.75f))
                    Text(if (shares.size == 1) "1 person" else "${shares.size} people", style = SType.title.copy(fontSize = 26.sp), color = Color.White)
                    Text(if (left == 1) "1 place left" else "$left places left", style = SType.small, color = Color.White.copy(alpha = 0.8f))
                }
            }
        }

        if (!vehicle.ownershipConfirmed) {
            NoticeCard(
                "Confirm that you own this vehicle before sharing it — check it against its RC in Saarthi on the web.",
                NoticeTone.WARNING,
                icon = Lucide.shieldCheck,
            )
        }
        message?.let { (text, tone) -> RevealedNotice(text, tone) }

        if (shares.isNotEmpty()) {
            Column(Modifier.fillMaxWidth().rise(stagger(1)).card(radius = 22.dp)) {
                shares.forEachIndexed { index, share ->
                    Row(
                        Modifier.fillMaxWidth().bottomRule(c.border, show = index < shares.lastIndex).padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Avatar(share.sharedWith.name.ifBlank { share.sharedWith.email }, size = 44.dp, background = c.primarySoft, ink = c.primary)
                        Column(Modifier.weight(1f)) {
                            Text(share.sharedWith.name.ifBlank { share.sharedWith.email }, style = SType.bodyStrong, color = c.fg)
                            Text(if (share.status == "PENDING") "Invited · not accepted yet" else share.sharedWith.email, style = SType.caption, color = c.muted)
                        }
                        LinkButton("Remove", {
                            scope.launch {
                                runCatching { app.papers.unshare(share.id) }
                                    .onSuccess { reload++ }
                                    .onFailure { message = it.readable() to NoticeTone.DANGER }
                            }
                        }, color = c.danger, style = SType.smallStrong)
                    }
                }
            }
        }

        GroupLabel("What they can do")
        Column(Modifier.fillMaxWidth().rise(stagger(2)).card(radius = 22.dp)) {
            Can(true, "See where it is, live", divider = true)
            Can(true, "Add trips, fuel and service", divider = true)
            Can(false, "Change papers or remove it", note = "Only you can", divider = false)
        }
    }

    BottomSheet(visible = inviting, onDismiss = { inviting = false }) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Invite someone", style = SType.sheetTitle, color = c.fg)
            Text("Use the email their Saarthi account is on. They get an invitation to accept.", style = SType.body, color = c.muted)
            SaarthiField(
                value = email,
                onValueChange = { email = it.take(160) },
                label = "Their email",
                leading = Lucide.mail,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            )
            SaarthiButton(
                "Send invitation",
                onClick = {
                    busy = true
                    scope.launch {
                        runCatching { app.papers.share(vehicle.id, email) }
                            .onSuccess {
                                inviting = false
                                email = ""
                                sheetError = null
                                message = "Invitation sent." to NoticeTone.SUCCESS
                                reload++
                            }
                            // Said in the sheet, where the person is looking — not behind it.
                            .onFailure { sheetError = it.readable() }
                        busy = false
                    }
                },
                enabled = email.contains('@') && email.contains('.'),
                busy = busy,
            )
            sheetError?.let { RevealedNotice(it, NoticeTone.DANGER) }
        }
    }
}

@Composable
private fun Can(allowed: Boolean, text: String, note: String? = null, divider: Boolean) {
    val c = Saarthi.colors
    Row(
        Modifier.fillMaxWidth().bottomRule(c.border, show = divider).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(
            if (allowed) Lucide.check else Lucide.close,
            well = if (allowed) c.successSoft else c.sunken,
            ink = if (allowed) c.success else c.muted,
            size = 32.dp,
            shape = CircleShape,
            iconSize = 14.dp,
        )
        Column(Modifier.weight(1f)) {
            Text(text, style = SType.bodyStrong, color = c.fg)
            note?.let { Text(it, style = SType.caption, color = c.muted) }
        }
    }
}
