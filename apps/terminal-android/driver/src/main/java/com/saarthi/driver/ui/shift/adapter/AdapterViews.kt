package com.saarthi.driver.ui.shift.adapter

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.core.telemetry.BluetoothObdTelemetryProvider.ObdCandidate
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.MapInk
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.RingSpinner
import com.saarthi.driver.ui.design.RippleRings
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SuccessDisc
import com.saarthi.driver.ui.design.bottomRule
import com.saarthi.driver.ui.design.pressable

/** Lucide `bluetooth-off`, for the radio switched off. */
private const val BLUETOOTH_OFF = "m17 17-5 5V12l-5 5M2 2l20 20M14.5 9.5 17 7l-5-5v4.5"

/** The sheet below its head: whichever face the phase calls for. */
@Composable
internal fun AdapterBody(phase: AdapterPhase, actions: AdapterActions, modifier: Modifier = Modifier) {
    when (phase) {
        is AdapterPhase.Connecting -> Connecting(phase.name, modifier)
        is AdapterPhase.Connected -> Connected(phase.engineAnswering, modifier)
        is AdapterPhase.Choose -> ChooseAdapter(phase.adapters, phase.failedName, actions, modifier)
        AdapterPhase.NoRadio -> Blocked(
            icon = Lucide.ban,
            title = stringResource(R.string.adapter_no_radio_title),
            body = stringResource(R.string.adapter_no_radio_body),
            modifier = modifier,
        )
        is AdapterPhase.NeedsPermission -> Blocked(
            icon = Lucide.bluetooth,
            title = stringResource(R.string.adapter_permission_title),
            body = stringResource(if (phase.refused) R.string.adapter_permission_refused else R.string.adapter_permission_body),
            action = if (phase.refused) {
                stringResource(R.string.adapter_open_app_settings) to actions.openAppSettings
            } else {
                stringResource(R.string.adapter_permission_allow) to actions.allow
            },
            modifier = modifier,
        )
        AdapterPhase.BluetoothOff -> Blocked(
            icon = BLUETOOTH_OFF,
            title = stringResource(R.string.adapter_off_title),
            body = stringResource(R.string.adapter_off_body),
            action = stringResource(R.string.adapter_open_bluetooth) to actions.openBluetooth,
            modifier = modifier,
        )
        AdapterPhase.NonePaired -> Blocked(
            icon = Lucide.search,
            title = stringResource(R.string.adapter_empty_title),
            body = stringResource(R.string.adapter_empty_body),
            action = stringResource(R.string.adapter_open_bluetooth) to actions.openBluetooth,
            secondary = stringResource(R.string.adapter_look_again) to actions.lookAgain,
            modifier = modifier,
        )
    }
}

/** The radar, the one-line instruction and the paired adapters to choose from. */
@Composable
private fun ChooseAdapter(
    adapters: List<ObdCandidate>,
    failedName: String?,
    actions: AdapterActions,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    Column(
        modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .padding(vertical = 10.dp),
            contentAlignment = Alignment.Center,
        ) {
            Radar()
        }
        Text(stringResource(R.string.adapter_intro), style = SType.body, color = c.muted)
        failedName?.let { NoticeCard(stringResource(R.string.adapter_failed, it), NoticeTone.WARNING) }
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(c.elevated),
        ) {
            adapters.forEachIndexed { index, adapter ->
                AdapterRow(adapter, divided = index < adapters.lastIndex) { actions.pick(adapter) }
            }
        }
        LinkButton(
            stringResource(R.string.adapter_look_again),
            actions.lookAgain,
            Modifier.align(Alignment.CenterHorizontally),
            color = MapInk.primaryInk,
        )
    }
}

/** Three rings sweeping out from the Bluetooth mark — the design's `ad-wave`. */
@Composable
private fun Radar() {
    val c = Saarthi.colors
    Box(Modifier.size(84.dp), contentAlignment = Alignment.Center) {
        RippleRings(
            color = c.primary.copy(alpha = 0.6f),
            periodMs = 2_200,
            from = 0.7f,
            to = 1.9f,
            startAlpha = 0.9f,
            count = 3,
            filled = false,
            strokeWidth = 2.dp,
        )
        Box(
            Modifier
                .size(56.dp)
                .clip(CircleShape)
                .background(c.primarySoft),
            contentAlignment = Alignment.Center,
        ) {
            LineIcon(Lucide.bluetooth, size = 26.dp, color = MapInk.primaryInk)
        }
    }
}

@Composable
private fun AdapterRow(adapter: ObdCandidate, divided: Boolean, onPick: () -> Unit) {
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 64.dp)
            .bottomRule(c.border, show = divided)
            .pressable(scale = 0.98f, label = stringResource(R.string.adapter_connect_label, adapter.name), onClick = onPick)
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconWell(Lucide.bluetooth, well = c.sunken, ink = c.muted, size = 38.dp, radius = 12.dp, iconSize = 18.dp)
        Column(Modifier.weight(1f)) {
            Text(adapter.name, style = SType.bodyStrong, color = c.fg, maxLines = 1)
            Text(adapter.address, style = SType.mono(12.sp, FontWeight.Medium, 0.em), color = c.subtle, maxLines = 1)
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}

@Composable
private fun Connecting(name: String, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(
        modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterVertically),
    ) {
        RingSpinner(track = c.sunken, head = c.primary, size = 60.dp, stroke = 5.dp)
        Text(
            stringResource(R.string.adapter_connecting, name),
            style = SType.cardTitle.copy(fontSize = 17.sp),
            color = c.fg,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}

/**
 * The link is up. "Reading the engine" only when the engine answers; an
 * adapter awake beside a sleeping ECU says to turn the key instead.
 */
@Composable
private fun Connected(engineAnswering: Boolean, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(
        modifier
            .fillMaxSize()
            .padding(horizontal = 10.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    ) {
        SuccessDisc(
            size = 96.dp,
            disc = c.successSoft,
            tick = c.success,
            halo = c.successWash,
            haloWidth = 12.dp,
            tickSize = 44.dp,
            tickStroke = 2.6f,
        )
        Text(
            stringResource(if (engineAnswering) R.string.adapter_connected else R.string.adapter_engine_asleep),
            style = SType.lead.copy(fontSize = 16.sp, lineHeight = 25.sp),
            color = c.fg,
            textAlign = TextAlign.Center,
        )
        Text(
            stringResource(R.string.adapter_connected_note),
            style = SType.body,
            color = c.muted,
            textAlign = TextAlign.Center,
        )
    }
}

/** Something stands between the phone and the adapter: say what, and offer the way past it. */
@Composable
private fun Blocked(
    icon: String,
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    action: Pair<String, () -> Unit>? = null,
    secondary: Pair<String, () -> Unit>? = null,
) {
    val c = Saarthi.colors
    Column(
        modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(top = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(icon, well = c.sunken, ink = c.muted, size = 64.dp, shape = CircleShape, iconSize = 28.dp)
        Text(title, style = SType.cardTitle.copy(fontSize = 17.sp), color = c.fg, textAlign = TextAlign.Center)
        Text(body, style = SType.body, color = c.muted, textAlign = TextAlign.Center)
        action?.let { (label, go) ->
            SaarthiButton(label, go, Modifier.padding(top = 4.dp), height = 52.dp, textStyle = SType.bodyStrong)
        }
        secondary?.let { (label, go) -> LinkButton(label, go, color = MapInk.primaryInk) }
    }
}
