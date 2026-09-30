package com.saarthi.driver.ui.shift.vehicle

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.core.telemetry.Metric
import com.saarthi.core.telemetry.TelemetrySnapshot
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.BottomSheet
import com.saarthi.driver.ui.design.BrandMark
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.DarkPalette
import com.saarthi.driver.ui.design.EqualRow
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.LocalPalette
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.bottomRule
import com.saarthi.driver.ui.design.rise
import java.util.Locale

/**
 * The vehicle in hand: what its engine is saying, its passport, the driver's
 * own record on it, and the problems reported against it.
 *
 * It opens over the live map, which is dark whatever the appearance setting,
 * so the dark palette is lent here — without the status-bar change
 * `AlwaysDark` makes, because this sheet stays composed while it is hidden.
 */
@Composable
fun VehicleSheet(visible: Boolean, cockpit: TerminalViewModel, onClose: () -> Unit) {
    BackHandler(enabled = visible, onBack = onClose)
    val top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + SHEET_GAP
    CompositionLocalProvider(LocalPalette provides DarkPalette) {
        BottomSheet(
            visible = visible,
            onDismiss = onClose,
            top = top,
            padding = PaddingValues(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 24.dp),
        ) {
            VehicleContent(cockpit, onClose, Modifier.weight(1f))
        }
    }
}

@Composable
private fun VehicleContent(cockpit: TerminalViewModel, onClose: () -> Unit, modifier: Modifier) {
    val state by cockpit.uiState.collectAsState()
    // Each time the sheet opens: a problem the fleet resolved an hour ago should not still read as open.
    LaunchedEffect(Unit) { cockpit.loadIssues() }
    val vehicle = state.server?.vehicle
    val driver = state.server?.session?.driver

    Column(
        modifier
            .fillMaxWidth()
            .imePadding()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        SheetHeader(vehicle?.registrationNumber ?: stringResource(R.string.vehicle_sheet_title), onClose)
        Eyebrow(stringResource(R.string.vehicle_live_title), Modifier.rise(distance = RISE, durationMs = RISE_MS))
        LiveTiles(state.telemetry, Modifier.rise(distance = RISE, durationMs = RISE_MS))
        TroubleCodes(state.telemetry, Modifier.rise(distance = RISE, durationMs = RISE_MS))
        SectionLabel(stringResource(R.string.vehicle_passport_title))
        DetailCard(passportRows(vehicle), Modifier.rise(distance = RISE, durationMs = RISE_MS))
        SectionLabel(stringResource(R.string.vehicle_you_title))
        DetailCard(driverRows(driver), Modifier.rise(distance = RISE, durationMs = RISE_MS))
        IssuesSection(cockpit, offline = state.offline)
    }
}

/** The mark, the plate as large as the design sets it, and close. */
@Composable
private fun SheetHeader(title: String, onClose: () -> Unit) {
    val c = Saarthi.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        BrandMark(height = 30.dp, plated = true)
        Text(title, style = SType.plate(22.sp, 0.02.em), color = c.fg, maxLines = 1, modifier = Modifier.weight(1f))
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

@Composable
private fun SectionLabel(text: String) {
    Eyebrow(
        text,
        Modifier
            .padding(top = 6.dp)
            .rise(distance = RISE, durationMs = RISE_MS),
    )
}

/**
 * Engine speed, battery voltage and engine load — the vehicle's own readings.
 * A reading nobody sent is a dash, never a zero.
 */
@Composable
private fun LiveTiles(telemetry: TelemetrySnapshot, modifier: Modifier = Modifier) {
    EqualRow(modifier, spacing = 8.dp) {
        LiveTile(
            stringResource(R.string.instrument_engine),
            telemetry.value(Metric.RPM)?.let { Grouped.format(Math.round(it)) },
            stringResource(R.string.unit_rpm),
            Modifier.weight(1f),
        )
        LiveTile(
            stringResource(R.string.vehicle_live_battery),
            telemetry.value(Metric.BATTERY_VOLTAGE)?.let { String.format(Locale.getDefault(), "%.1f", it) },
            stringResource(R.string.vehicle_unit_volts),
            Modifier.weight(1f),
        )
        LiveTile(
            stringResource(R.string.vehicle_live_load),
            telemetry.value(Metric.ENGINE_LOAD)?.let { Math.round(it).toString() },
            stringResource(R.string.unit_percent),
            Modifier.weight(1f),
        )
    }
}

@Composable
private fun LiveTile(label: String, value: String?, unit: String, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(
        modifier
            .clip(RoundedCornerShape(16.dp))
            .background(c.elevated)
            .padding(12.dp),
    ) {
        Text(label, style = SType.caption, color = c.muted, maxLines = 1)
        Text(
            buildAnnotatedString {
                append(value ?: "—")
                if (value != null) {
                    append(" ")
                    withStyle(SpanStyle(fontSize = 11.sp, color = c.subtle)) { append(unit) }
                }
            },
            style = SType.cardTitle.copy(fontSize = 17.sp),
            color = c.fg,
            maxLines = 1,
        )
    }
}

/**
 * What the ECU has stored as faults. Read only through the adapter, so without
 * one the row says so rather than claiming a clean bill of health.
 */
@Composable
private fun TroubleCodes(telemetry: TelemetrySnapshot, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val codes = telemetry.diagnostics
    val shape = RoundedCornerShape(14.dp)
    val (wash, ring, dot) = when {
        codes.isNotEmpty() -> Triple(c.warningWash, c.warningRing, c.warning)
        telemetry.isReadingFromObd -> Triple(c.successWash, c.successGlow, c.success)
        else -> Triple(c.sunken, c.border, c.subtle)
    }
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(wash)
            .border(1.dp, ring, shape)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(dot),
            )
            Text(
                when {
                    codes.isNotEmpty() -> pluralStringResource(R.plurals.vehicle_codes_found, codes.size, codes.size)
                    telemetry.isReadingFromObd -> stringResource(R.string.vehicle_codes_none)
                    else -> stringResource(R.string.vehicle_codes_unread)
                },
                style = SType.body,
                color = c.fg,
            )
        }
        codes.forEach { code ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(code.code, style = SType.mono(13.sp), color = c.warning)
                code.description?.let { Text(it, style = SType.small, color = c.muted) }
            }
        }
    }
}

/** Label and value, one per row, as the design's passport card lays them out. */
@Composable
private fun DetailCard(rows: List<Pair<String, String?>>, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(c.elevated),
    ) {
        rows.forEachIndexed { index, (label, value) ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .bottomRule(c.border, show = index < rows.lastIndex)
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(label, style = SType.body, color = c.muted)
                Text(
                    value ?: "—",
                    style = SType.bodyMedium,
                    color = c.fg,
                    textAlign = TextAlign.End,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/** The design's `vh-rise`: 14 dp up over 600 ms. */
private val RISE = 14.dp
private const val RISE_MS = 600

/** Room left above the sheet, under the status bar. */
private val SHEET_GAP = 20.dp
