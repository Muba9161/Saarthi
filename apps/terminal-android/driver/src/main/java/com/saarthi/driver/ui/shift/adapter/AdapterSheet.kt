package com.saarthi.driver.ui.shift.adapter

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.statusBars
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.core.telemetry.BluetoothObdTelemetryProvider.ObdCandidate
import com.saarthi.core.telemetry.ProviderStatus
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.BottomSheet
import com.saarthi.driver.ui.design.BrandMark
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.DarkPalette
import com.saarthi.driver.ui.design.LocalPalette
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Pair the Bluetooth OBD adapter the driver was handed with the keys.
 *
 * Every state shown is the provider's own — connecting while it is opening
 * the link, connected only once it holds one — so the sheet never claims an
 * engine is being read when it is not. Opened over the live map, so it wears
 * the dark palette whatever the theme (lent without the status-bar change,
 * because the sheet stays composed while hidden).
 */
@Composable
fun AdapterSheet(visible: Boolean, cockpit: TerminalViewModel, onClose: () -> Unit) {
    BackHandler(enabled = visible, onBack = onClose)
    val top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + SHEET_GAP
    CompositionLocalProvider(LocalPalette provides DarkPalette) {
        BottomSheet(
            visible = visible,
            onDismiss = onClose,
            top = top,
            padding = PaddingValues(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 24.dp),
        ) {
            AdapterContent(cockpit, onClose, Modifier.weight(1f))
        }
    }
}

/** Which of the sheet's faces is showing. */
internal sealed interface AdapterPhase {
    data class Connecting(val name: String) : AdapterPhase
    data class Connected(val engineAnswering: Boolean) : AdapterPhase
    data object NoRadio : AdapterPhase
    data class NeedsPermission(val refused: Boolean) : AdapterPhase
    data object BluetoothOff : AdapterPhase
    data object NonePaired : AdapterPhase
    data class Choose(val adapters: List<ObdCandidate>, val failedName: String?) : AdapterPhase
}

@Composable
private fun AdapterContent(cockpit: TerminalViewModel, onClose: () -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    val obd = cockpit.telemetryHub.obd
    val adapters by cockpit.obdAdapters.collectAsState()
    val status by obd.status.collectAsState()
    val connectedTo by obd.connectedTo.collectAsState()
    val radio = rememberBluetoothRadio(obd)
    var attempt by remember { mutableStateOf<ObdCandidate?>(null) }
    var failedName by remember { mutableStateOf<String?>(null) }

    // On opening, and again whenever the phone becomes able to see its pairings.
    LaunchedEffect(radio.granted, radio.enabled) { cockpit.refreshObdAdapters() }

    /*
     * One connection attempt, followed to its end.
     *
     * The provider goes STARTING while it opens the link and leaves it either
     * holding a connection or not; the ceiling only guards against missing
     * that brief state altogether. Whatever it ended on, the provider's own
     * `connectedTo` is the verdict.
     */
    LaunchedEffect(attempt) {
        val target = attempt ?: return@LaunchedEffect
        failedName = null
        cockpit.connectObd(target)
        withTimeoutOrNull(CONNECT_WAIT_MS) {
            obd.status.first { it == ProviderStatus.STARTING }
            obd.status.first { it != ProviderStatus.STARTING }
        }
        if (obd.connectedTo.value?.address != target.address) failedName = target.name
        attempt = null
    }

    val linked = connectedTo
    val phase = when {
        attempt != null || status == ProviderStatus.STARTING -> AdapterPhase.Connecting(
            attempt?.name
                ?: adapters.firstOrNull { it.address == obd.preferredAddress }?.name
                ?: stringResource(R.string.adapter_generic_name),
        )
        linked != null && (status == ProviderStatus.RUNNING || status == ProviderStatus.DEGRADED) ->
            AdapterPhase.Connected(engineAnswering = status == ProviderStatus.RUNNING)
        !radio.present || status == ProviderStatus.UNAVAILABLE -> AdapterPhase.NoRadio
        !radio.granted -> AdapterPhase.NeedsPermission(refused = radio.refused)
        !radio.enabled -> AdapterPhase.BluetoothOff
        adapters.isEmpty() -> AdapterPhase.NonePaired
        else -> AdapterPhase.Choose(adapters, failedName)
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        AdapterHeader(onClose)
        AdapterBody(
            phase = phase,
            actions = AdapterActions(
                pick = { candidate -> attempt = candidate },
                lookAgain = cockpit::refreshObdAdapters,
                allow = radio.request,
                openBluetooth = { context.openBluetoothSettings() },
                openAppSettings = { context.openAppSettings() },
            ),
            modifier = Modifier.weight(1f),
        )
    }
}

/** The mark, the title and close — the same head every map sheet wears. */
@Composable
private fun AdapterHeader(onClose: () -> Unit) {
    val c = Saarthi.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        BrandMark(height = 30.dp, plated = true)
        Text(stringResource(R.string.adapter_title), style = SType.sheetTitle, color = c.fg, modifier = Modifier.weight(1f))
        CircleButton(
            Lucide.close,
            stringResource(R.string.action_close),
            onClose,
            background = c.sunken,
            elevated = false,
            stroke = 2f,
        )
    }
}

/** What each face of the sheet can ask for. */
internal class AdapterActions(
    val pick: (ObdCandidate) -> Unit,
    val lookAgain: () -> Unit,
    val allow: () -> Unit,
    val openBluetooth: () -> Unit,
    val openAppSettings: () -> Unit,
)

/**
 * Long enough for a slow adapter to open its link and answer as an ELM327;
 * only reached if the brief connecting state was never seen at all.
 */
private const val CONNECT_WAIT_MS = 30_000L

/** Room left above the sheet, under the status bar — the design's 200 px from the top. */
private val SHEET_GAP = 160.dp
