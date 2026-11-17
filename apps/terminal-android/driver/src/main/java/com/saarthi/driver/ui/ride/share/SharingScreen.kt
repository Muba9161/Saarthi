package com.saarthi.driver.ui.ride.share

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.core.telemetry.Position
import com.saarthi.core.ui.TerminalMap
import com.saarthi.driver.R
import com.saarthi.driver.network.RideSharesApi
import com.saarthi.driver.ride.RideSharePolicy
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.LiveDot
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.MapInk
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.SlideToAct
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.shift.map.HumsafarMapLook
import com.saarthi.driver.ui.shift.map.MapCredits
import com.saarthi.driver.ui.shift.map.MapScrim
import com.saarthi.driver.ui.shift.map.mapPanel
import com.saarthi.driver.ui.shift.map.mapStyleUrl
import com.saarthi.driver.ui.start.rememberLocationAccess
import com.saarthi.driver.ui.start.withLastPosition
import kotlinx.coroutines.delay
import java.time.Instant

/**
 * Sharing a ride with family: the phone on the map, the link, and the way out.
 *
 * The map follows the phone — its own fix, refreshed while the screen is
 * open, with the share's last reported position standing in until there is
 * one. The card says the one thing a
 * person sharing their whereabouts must never have to guess: that they are
 * being shared, and until when.
 *
 * Stopping is a slide rather than a tap, as getting off is: a phone in a
 * pocket collects taps.
 */
@Composable
fun SharingScreen(viewModel: DriverViewModel, sharing: DriverViewModel.Stage.Sharing) {
    val share = sharing.share
    val context = LocalContext.current
    val busy by viewModel.busy.collectAsState()
    val error by viewModel.error.collectAsState()
    val location = rememberLocationAccess()
    val ownerAccount by viewModel.sharing.hasOwnerAccount.collectAsState()
    var adding by rememberSaveable { mutableStateOf(false) }

    // Asked once: sharing a ride is sharing a position, and there is none without it.
    var asked by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(location.granted) {
        if (!location.granted && !asked) {
            asked = true
            location.request()
        }
    }

    var phone by remember { mutableStateOf<Position?>(null) }
    LaunchedEffect(location.granted) {
        if (!location.granted) return@LaunchedEffect
        while (true) {
            withLastPosition(context) { lat, lng ->
                if (lat != null && lng != null) phone = Position(latitude = lat, longitude = lng)
            }
            delay(PHONE_FIX_EVERY_MS)
        }
    }
    val position = phone ?: share.lastLocation?.let(::positionOf)

    val message = stringResource(R.string.sharing_link_message, share.link)
    val chooserTitle = stringResource(R.string.sharing_send_link)

    Box(
        Modifier
            .fillMaxSize()
            .background(MapInk.ground),
    ) {
        TerminalMap(
            position = position,
            headingDegrees = share.lastLocation?.heading,
            modifier = Modifier.matchParentSize(),
            vehicleType = SHARE_MARKER,
            look = HumsafarMapLook,
            styleUrl = mapStyleUrl(),
        )
        MapScrim(MapInk.ground, top = 0.3f, bottom = 0.6f, footAlpha = 0.92f)

        Column(
            Modifier
                .align(Alignment.TopCenter)
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(start = 16.dp, end = 16.dp, top = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            ShareCard(
                share = share,
                named = sharing.named,
                selfShare = RideSharePolicy.selfShareOf(ownerAccount, share),
                busy = busy,
                onShowSelf = viewModel.sharing::showOnOwnerApp,
                modifier = Modifier.rise(100, distance = (-16).dp),
            )
            if (!location.granted) {
                NoticeCard(
                    stringResource(R.string.sharing_location_off),
                    NoticeTone.WARNING,
                    Modifier.rise(150),
                    icon = Lucide.mapPin,
                    trailing = {
                        LinkButton(stringResource(R.string.sharing_location_allow), location.request, style = SType.smallStrong)
                    },
                )
            }
        }

        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .windowInsetsPadding(WindowInsets.navigationBars)
                .padding(start = 16.dp, end = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            MapCredits(Modifier.padding(start = 4.dp))
            if (!adding) error?.let { NoticeCard(it, NoticeTone.DANGER) }
            SaarthiButton(
                chooserTitle,
                { sendShareLink(context, message, chooserTitle) },
                Modifier.rise(120),
                enabled = share.link.isNotBlank(),
                leading = Lucide.send,
            )
            SaarthiButton(
                stringResource(R.string.sharing_add_family),
                {
                    viewModel.clearError()
                    adding = true
                },
                Modifier.rise(135),
                tone = ButtonTone.MAP,
                leading = Lucide.users,
            )
            SlideToAct(
                stringResource(R.string.sharing_stop),
                viewModel.sharing::stop,
                Modifier.rise(150),
                enabled = !busy,
            )
        }

        AddFamilySheet(
            visible = adding,
            busy = busy,
            error = error,
            onAdd = { phone -> viewModel.sharing.addFamily(phone) { adding = false } },
            onDismiss = {
                adding = false
                viewModel.clearError()
            },
        )
    }
}

/** That this phone is being shared, the vehicle, until when — who is told, and the rider's own owner app. */
@Composable
private fun ShareCard(
    share: RideSharesApi.ShareView,
    named: List<String>,
    selfShare: RideSharePolicy.SelfShare,
    busy: Boolean,
    onShowSelf: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val locale = LocalConfiguration.current.locales[0]
    val until = remember(share.expiresAt, locale) { clockTime(share.expiresAt, locale) }
    Column(
        modifier
            .fillMaxWidth()
            .mapPanel(22.dp, fill = MapInk.panelSolid, lifted = true)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LiveDot(MapInk.success, size = 8.dp)
            Eyebrow(stringResource(R.string.sharing_eyebrow), Modifier.weight(1f), color = MapInk.muted, maxLines = 1)
        }
        share.registrationNumber?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = SType.plate(24.sp, 0.02.em), color = MapInk.fg, maxLines = 1)
        }
        until?.let { Text(stringResource(R.string.sharing_until, it), style = SType.bodyStrong, color = MapInk.fg) }
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LineIcon(Lucide.users, size = 14.dp, color = MapInk.primary, modifier = Modifier.padding(top = 3.dp))
            Text(stringResource(R.string.sharing_told), style = SType.small, color = MapInk.muted)
        }
        NamedContacts(named, color = MapInk.subtle)
        OwnerAppLine(selfShare, busy, onShowSelf)
    }
}

/** The share's last reported position, as the map draws it. */
private fun positionOf(location: RideSharesApi.LastLocation): Position = Position(
    latitude = location.latitude,
    longitude = location.longitude,
    at = location.recordedAt
        ?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
        ?: System.currentTimeMillis(),
)

/**
 * A person in a vehicle Saarthi does not know — a cab, an auto, a friend's
 * car — drawn with the car pin rather than the lorry an unknown type falls to.
 */
private const val SHARE_MARKER = "CAR"

/** How often the map takes the phone's latest fix; the reporting service keeps it fresh. */
private const val PHONE_FIX_EVERY_MS = 5_000L
