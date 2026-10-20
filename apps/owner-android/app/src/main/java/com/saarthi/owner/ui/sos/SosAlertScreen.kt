package com.saarthi.owner.ui.sos

import com.saarthi.owner.data.SessionStore
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.R
import com.saarthi.owner.network.SosApi
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.ago
import com.saarthi.owner.ui.common.dial
import com.saarthi.owner.ui.common.isNow
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.AlwaysDark
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.Brand
import com.saarthi.owner.ui.design.ButtonRow
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.NotesField
import com.saarthi.owner.ui.design.RippleRings
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.rememberLoop
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.design.Ease
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val REFRESH_MS = 8_000L

/**
 * A driver needs help — the design's SOS alert, in the driver app's red.
 *
 * Who, where, which Saarthi trucks were asked and who is coming; the owner
 * calls the driver, calls 112, opens the place on a map, widens the circle,
 * or marks it resolved with a word on what happened.
 */
@Composable
fun SosAlertScreen(sos: SosApi, account: SessionStore.Account, initial: SosApi.Incident) = AlwaysDark {
    // Offered only where the server will accept them: resolving needs either SOS
    // permission, widening the circle needs the manage one.
    val canResolve = account.can("sos.manage") || account.can("sos.trigger")
    val canWiden = account.can("sos.manage")
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var incident by remember { mutableStateOf(initial) }
    var resolving by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    val beat by rememberLoop(1_200, Ease.standard, reverse = true, rest = 0f, label = "sos-beat")

    LaunchedEffect(initial.id) {
        while (true) {
            runCatching { sos.get(initial.id) }.getOrNull()?.let { incident = it }
            delay(REFRESH_MS)
        }
    }

    val name = incident.driver?.name?.ifBlank { null } ?: stringResource(R.string.papers_sos_driver_fallback)
    val phone = incident.driver?.phone ?: incident.contactPhone
    val coming = incident.responders.filter { it.status in setOf("ACKNOWLEDGED", "ASSIGNED", "ARRIVED") }

    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Brand.sosDeep, Brand.sosNight, Brand.sosBlack))),
    ) {
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Brand.sosBanner)
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .padding(horizontal = 20.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                LineIcon(Lucide.siren, size = 18.dp, color = Color.White, stroke = 2.2f)
                Text(
                    when {
                        !incident.active -> stringResource(R.string.papers_sos_resolved_banner)
                        isNow(incident.triggeredAt) -> stringResource(R.string.papers_sos_raised_now)
                        else -> stringResource(R.string.papers_sos_raised_ago, ago(incident.triggeredAt))
                    },
                    style = SType.bodyStrong.copy(letterSpacing = 0.06.sp),
                    color = Color.White,
                    modifier = Modifier.weight(1f),
                )
                CircleButton(Lucide.close, stringResource(R.string.papers_sos_close), navigator::pop, size = 36.dp, iconSize = 14.dp, elevated = false, background = Color.White.copy(alpha = 0.16f), ink = Color.White)
            }

            Column(
                Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Box(Modifier.padding(top = 28.dp).size(190.dp), contentAlignment = Alignment.Center) {
                    if (incident.active) {
                        RippleRings(Color(0xFFDF494E).copy(alpha = 0.5f), periodMs = 2_400, from = 0.55f, to = 1.15f, startAlpha = 0.9f, count = 3)
                    }
                    Box(
                        Modifier
                            .size(150.dp)
                            .clip(CircleShape)
                            .background(Color(0xFFDF494E).copy(alpha = 0.22f + 0.12f * beat)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(
                            Modifier
                                .size(92.dp)
                                .clip(CircleShape)
                                .background(Brand.sosBanner),
                            contentAlignment = Alignment.Center,
                        ) {
                            LineIcon(Lucide.siren, size = 38.dp, color = Color.White, stroke = 2.2f)
                        }
                    }
                }
                Eyebrow(if (incident.active) stringResource(R.string.papers_sos_needs_help) else stringResource(R.string.papers_sos_resolved), color = Color(0xFFFE8A4B))
                Text(name, style = SType.display.copy(fontSize = 34.sp), color = Color.White, textAlign = TextAlign.Center)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    incident.truck?.registrationNumber?.let { PlateChip(it, size = 12.sp) }
                    Text(
                        listOfNotNull(SosApi.typeWord(incident.type), incident.address?.substringBefore(',')).joinToString(" · "),
                        style = SType.small,
                        color = Color.White.copy(alpha = 0.8f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                incident.description?.ifBlank { null }?.let {
                    Text(it, style = SType.body, color = Color.White.copy(alpha = 0.75f), textAlign = TextAlign.Center)
                }

                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(22.dp))
                        .background(Color.White.copy(alpha = 0.06f))
                        .border(1.dp, Color.White.copy(alpha = 0.1f), RoundedCornerShape(22.dp))
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        IconWell(Lucide.users, well = Color(0x2E3DAE79), ink = Color(0xFF3DAE79), size = 40.dp, shape = CircleShape, iconSize = 18.dp)
                        Column(Modifier.weight(1f)) {
                            Text(
                                pluralStringResource(
                                    if (incident.active) R.plurals.papers_sos_trucks_alerted else R.plurals.papers_sos_trucks_were_alerted,
                                    incident.responderCount,
                                    incident.responderCount,
                                ),
                                style = SType.bodyStrong,
                                color = Color.White,
                            )
                            Text(
                                when {
                                    !incident.active -> incident.searchRadiusMeters?.let { stringResource(R.string.papers_sos_within_km, it / 1000) }
                                        ?: stringResource(R.string.papers_sos_nearby)
                                    else -> incident.searchRadiusMeters?.let { stringResource(R.string.papers_sos_within_km_widens, it / 1000) }
                                        ?: stringResource(R.string.papers_sos_widens)
                                },
                                style = SType.caption,
                                color = Color.White.copy(alpha = 0.65f),
                            )
                        }
                    }
                    coming.forEach { responder ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .background(Color.White.copy(alpha = 0.06f))
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            PlateChip(responder.registrationNumber, size = 11.sp)
                            Text(
                                responder.distanceKm?.let { stringResource(R.string.papers_sos_coming_distance, "%.1f".format(it)) }
                                    ?: stringResource(R.string.papers_sos_coming),
                                style = SType.small,
                                color = Color.White.copy(alpha = 0.8f),
                                modifier = Modifier.weight(1f),
                            )
                            Text(if (responder.status == "ARRIVED") stringResource(R.string.papers_sos_arrived) else stringResource(R.string.papers_sos_accepted), style = SType.captionStrong, color = Color(0xFF3DAE79))
                        }
                    }
                    if (incident.active && coming.isEmpty() && canWiden) {
                        LinkButton(stringResource(R.string.papers_sos_widen), onClick = {
                            scope.launch {
                                message = runCatching { sos.expandSearch(incident.id) }
                                    .fold({ Words.get(if (it) R.string.papers_sos_widened else R.string.papers_sos_widest) }, { it.readable() })
                            }
                        }, color = Color(0xFFFE8A4B), style = SType.smallStrong)
                    }
                }
                message?.let { NoticeCard(it, NoticeTone.INFO) }
                Spacer(Modifier.height(8.dp))
            }

            Column(
                Modifier
                    .fillMaxWidth()
                    .windowInsetsPadding(WindowInsets.navigationBars)
                    .padding(start = 20.dp, end = 20.dp, bottom = 16.dp, top = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (phone != null) {
                    SaarthiButton(stringResource(R.string.papers_sos_call_driver, name.substringBefore(' ')), onClick = { context.dial(phone) }, tone = ButtonTone.WHITE, leading = Lucide.phone, leadingTint = Brand.sosBanner)
                }
                ButtonRow {
                    // Once it is resolved there is no emergency left to ring 112 about.
                    if (incident.active) EmergencyButton(stringResource(R.string.papers_sos_call_112), Modifier.weight(1f)) { context.dial("112") }
                    SaarthiButton(
                        stringResource(R.string.papers_sos_open_map),
                        onClick = {
                            val lat = incident.latitude
                            val lng = incident.longitude
                            if (lat != null && lng != null) {
                                runCatching {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("geo:$lat,$lng?q=$lat,$lng(${Uri.encode(name)})")))
                                }
                            }
                        },
                        tone = ButtonTone.GHOST,
                        modifier = Modifier.weight(1f),
                    )
                }
                if (incident.active && canResolve) {
                    LinkButton(stringResource(R.string.papers_sos_mark_resolved_link), { resolving = true }, color = Color.White.copy(alpha = 0.85f), modifier = Modifier.align(Alignment.CenterHorizontally))
                }
            }
        }

        BottomSheet(visible = resolving, onDismiss = { resolving = false }) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(stringResource(R.string.papers_sos_what_happened), style = SType.sheetTitle, color = Color.White)
                NotesField(note, { note = it.take(1000) }, label = stringResource(R.string.papers_sos_note_label), minHeight = 90.dp)
                SaarthiButton(
                    stringResource(R.string.papers_sos_mark_resolved),
                    onClick = {
                        busy = true
                        scope.launch {
                            runCatching { sos.resolve(incident.id, note.trim()) }
                                .onSuccess {
                                    resolving = false
                                    runCatching { sos.get(incident.id) }.getOrNull()?.let { incident = it }
                                }
                                .onFailure { message = it.readable() }
                            busy = false
                        }
                    },
                    enabled = note.trim().length >= 5,
                    busy = busy,
                )
            }
        }
    }
}

/** The red button: the one call that is not to anyone in the app. */
@Composable
private fun EmergencyButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .height(56.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Brand.sosBanner)
            .pressable(scale = 0.985f, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = SType.button, color = Color.White)
    }
}

/** "SOS · Imran needs help" — the red card a home puts above everything else. */
@Composable
fun SosCard(incident: SosApi.Incident, modifier: Modifier = Modifier, onOpen: () -> Unit) {
    val beat by rememberLoop(1_200, Ease.standard, reverse = true, rest = 0f, label = "sos-card-beat")
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(Brush.horizontalGradient(listOf(Brand.sosBanner, Brand.sosDeep)))
            .border(2.dp, Color.White.copy(alpha = 0.12f + 0.25f * beat), RoundedCornerShape(22.dp))
            .pressable(scale = 0.98f, onClick = onOpen)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.18f)),
            contentAlignment = Alignment.Center,
        ) {
            LineIcon(Lucide.siren, size = 22.dp, color = Color.White, stroke = 2.2f)
        }
        Column(Modifier.weight(1f)) {
            Text(
                incident.driver?.name?.substringBefore(' ')?.let { stringResource(R.string.papers_sos_card_title, it) }
                    ?: stringResource(R.string.papers_sos_card_title_unknown),
                style = SType.bodyStrong,
                color = Color.White,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                listOfNotNull(
                    SosApi.typeWord(incident.type),
                    incident.address?.substringBefore(','),
                    if (isNow(incident.triggeredAt)) stringResource(R.string.papers_sos_just_now) else stringResource(R.string.papers_sos_ago, ago(incident.triggeredAt)),
                )
                    .joinToString(" · "),
                style = SType.caption,
                color = Color.White.copy(alpha = 0.85f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = Color.White)
    }
}
