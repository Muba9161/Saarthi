package com.saarthi.driver.ui.shift.map

import android.text.format.Formatter
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.core.data.OfflineMaps
import com.saarthi.core.domain.TerminalState
import com.saarthi.core.telemetry.Metric
import com.saarthi.core.telemetry.TelemetrySnapshot
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.ArcGauge
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.SaarthiCard
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SlideToAct
import com.saarthi.driver.ui.design.StatusPill
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.popIn
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.rememberLoop
import com.saarthi.driver.ui.shift.driverWord
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.roundToInt

/** Thousands grouped the Indian way — 1,24,560 — as the design writes them. */
private val Grouped: NumberFormat = NumberFormat.getIntegerInstance(Locale("en", "IN"))

/**
 * The four dials and two figures. Every reading is the vehicle's own or the
 * phone's; a reading nobody sent shows a dash and an empty dial, never a zero.
 */
@Composable
fun InstrumentsSection(telemetry: TelemetrySnapshot, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val speed = telemetry.value(Metric.SPEED)
    val rpm = telemetry.value(Metric.RPM)
    val fuel = telemetry.value(Metric.FUEL_LEVEL)
    val coolant = telemetry.value(Metric.COOLANT_TEMPERATURE)
    val odometer = telemetry.value(Metric.ODOMETER)
    // km per litre from the ECU's own fuel rate — only while actually moving,
    // because at idle the ratio means nothing.
    val fuelRate = telemetry.value(Metric.FUEL_RATE)
    val mileage = if (speed != null && fuelRate != null && speed > MOVING_KPH && fuelRate > 0.0) speed / fuelRate else null

    Column(modifier, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
            Text(stringResource(R.string.instruments_title), style = SType.section, color = c.fg, modifier = Modifier.weight(1f))
            Text(
                stringResource(if (telemetry.isReadingFromObd) R.string.instruments_from_obd else R.string.instruments_from_phone),
                style = SType.caption,
                color = c.subtle,
            )
        }
        PairRow {
            GaugeTile(R.string.instrument_speed, speed, R.string.unit_kmh, speed?.let { it / 120.0 }, c.fg, Modifier.weight(1f))
            GaugeTile(R.string.instrument_engine, rpm, R.string.unit_rpm, rpm?.let { it / 4_000.0 }, c.primary, Modifier.weight(1f), grouped = true)
        }
        PairRow {
            GaugeTile(
                R.string.instrument_fuel,
                fuel,
                R.string.unit_percent,
                fuel?.let { it / 100.0 },
                if (fuel != null && fuel < LOW_FUEL_PERCENT) c.warning else c.success,
                Modifier.weight(1f),
                tintValue = true,
            )
            GaugeTile(
                R.string.instrument_coolant,
                coolant,
                R.string.unit_celsius,
                coolant?.let { (it - 40.0) / 80.0 },
                if (coolant != null && coolant > HOT_COOLANT_C) c.danger else c.fg,
                Modifier.weight(1f),
            )
        }
        PairRow {
            FigureTile(R.string.instrument_odometer, odometer?.let { Grouped.format(it.roundToInt()) }, R.string.unit_km, Modifier.weight(1f))
            FigureTile(
                R.string.instrument_mileage,
                mileage?.let { String.format(Locale.getDefault(), "%.1f", it) },
                R.string.unit_kmpl,
                Modifier.weight(1f),
            )
        }
    }
}

/** "Instruments are hidden" — so a driver who turned them off knows where they went. */
@Composable
fun InstrumentsHiddenNote(modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 16.dp, elevated = false)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        LineIcon(Lucide.gauge, size = 18.dp, color = c.subtle)
        Text(stringResource(R.string.instruments_hidden), style = SType.small, color = c.muted)
    }
}

@Composable
private fun PairRow(content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), content = content)
}

@Composable
private fun GaugeTile(
    label: Int,
    value: Double?,
    unit: Int,
    fraction: Double?,
    color: Color,
    modifier: Modifier = Modifier,
    grouped: Boolean = false,
    tintValue: Boolean = false,
) {
    val c = Saarthi.colors
    val shown by animateIntAsState((value ?: 0.0).roundToInt(), tween(1_400, 300), label = "instrument")
    Row(
        modifier
            .card(radius = 20.dp, elevated = false)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ArcGauge(fraction?.toFloat(), color, track = c.sunken)
        Column {
            Eyebrow(stringResource(label), maxLines = 1)
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    when {
                        value == null -> "—"
                        grouped -> Grouped.format(shown)
                        else -> shown.toString()
                    },
                    style = SType.metric,
                    color = if (tintValue && value != null) color else c.fg,
                    maxLines = 1,
                )
                Text(stringResource(unit), style = SType.caption, color = c.subtle, modifier = Modifier.padding(bottom = 4.dp))
            }
        }
    }
}

@Composable
private fun FigureTile(label: Int, value: String?, unit: Int, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(
        modifier
            .card(radius = 18.dp, elevated = false)
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Eyebrow(stringResource(label), maxLines = 1)
        Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(value ?: "—", style = SType.headerTitle, color = c.fg, maxLines = 1)
            if (value != null) {
                Text(stringResource(unit), style = SType.caption, color = c.subtle, modifier = Modifier.padding(bottom = 3.dp))
            }
        }
    }
}

/** What the Controls grid can open. */
class ControlActions(
    val services: () -> Unit,
    val assistant: () -> Unit,
    val vehicle: () -> Unit,
    val adapter: () -> Unit,
    val fuelSlip: () -> Unit,
    val fuelNearby: () -> Unit,
)

/**
 * Controls. While the vehicle moves only what a driver may reasonably reach for
 * stays — services and the voice assistant — and the fuel slip, which needs a
 * photograph, gives way to finding fuel.
 */
@Composable
fun ControlsSection(moving: Boolean, actions: ControlActions, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(stringResource(R.string.controls_title), style = SType.section, color = c.fg, modifier = Modifier.padding(top = 10.dp))
        PairRow {
            ControlTile(Lucide.mapPin, R.string.control_services, R.string.control_services_sub, actions.services, Modifier.weight(1f), accent = true, highlighted = true)
            ControlTile(Lucide.mic, R.string.control_saarthi, R.string.control_saarthi_sub, actions.assistant, Modifier.weight(1f), accent = true)
        }
        if (!moving) {
            PairRow {
                ControlTile(Lucide.truck, R.string.control_vehicle, R.string.control_vehicle_sub, actions.vehicle, Modifier.weight(1f))
                ControlTile(Lucide.bluetooth, R.string.control_adapter, R.string.control_adapter_sub, actions.adapter, Modifier.weight(1f))
            }
        }
        if (moving) {
            WideControl(Lucide.fuel, R.string.control_fuel_nearby, R.string.control_fuel_nearby_sub, actions.fuelNearby)
        } else {
            WideControl(Lucide.receipt, R.string.home_action_fuel, R.string.control_fuel_slip_sub, actions.fuelSlip)
        }
    }
}

@Composable
private fun ControlTile(
    icon: String,
    title: Int,
    subtitle: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    accent: Boolean = false,
    highlighted: Boolean = false,
) {
    val c = Saarthi.colors
    Row(
        modifier
            .defaultMinSize(minHeight = 76.dp)
            .card(radius = 20.dp, ring = if (highlighted) c.primaryRing else c.ring, elevated = false)
            .pressable(label = stringResource(title), onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconWell(
            icon,
            well = if (accent) c.primarySoft else c.sunken,
            ink = if (accent) Color(0xFF8E98F5) else c.muted,
            size = 42.dp,
        )
        Column {
            Text(stringResource(title), style = SType.bodyStrong, color = c.fg, maxLines = 1)
            Text(stringResource(subtitle), style = SType.caption, color = c.muted, modifier = Modifier.padding(top = 2.dp))
        }
    }
}

@Composable
private fun WideControl(icon: String, title: Int, subtitle: Int, onClick: () -> Unit) {
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 72.dp)
            .card(radius = 20.dp, elevated = false)
            .pressable(label = stringResource(title), onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconWell(icon, well = c.accentSoft, ink = c.accent, size = 42.dp)
        Column(Modifier.weight(1f)) {
            Text(stringResource(title), style = SType.bodyStrong, color = c.fg)
            Text(stringResource(subtitle), style = SType.caption, color = c.muted, modifier = Modifier.padding(top = 2.dp))
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}

/**
 * Keep the map for places with no signal. The download itself is MapLibre's;
 * this card only starts it, shows how far it has got and says when it is done.
 */
@Composable
fun OfflineMapCard(
    status: OfflineMaps.Status,
    hasPosition: Boolean,
    hasRoute: Boolean,
    onSaveHere: () -> Unit,
    onSaveRoute: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    val context = LocalContext.current
    SaarthiCard(modifier, padding = PaddingValues(18.dp), spacing = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            LineIcon(Lucide.download, size = 20.dp, color = c.primary)
            Text(stringResource(R.string.offline_title), style = SType.cardTitle, color = c.fg, modifier = Modifier.weight(1f))
            if (status is OfflineMaps.Status.Ready) {
                StatusPill(stringResource(R.string.offline_saved), background = c.successBg, ink = c.success, dot = false, modifier = Modifier.popIn())
            }
        }
        when (status) {
            is OfflineMaps.Status.Working -> {
                Text(stringResource(R.string.offline_saving), style = SType.small, color = c.muted)
                ProgressBar(status.fraction)
                Text(stringResource(R.string.offline_keep_open), style = SType.caption, color = c.subtle)
            }
            is OfflineMaps.Status.Ready -> {
                Text(
                    stringResource(R.string.offline_ready, Formatter.formatShortFileSize(context, status.bytes)),
                    style = SType.small,
                    color = c.muted,
                )
                PairRow {
                    SaarthiButton(
                        stringResource(R.string.offline_new_area),
                        onSaveHere,
                        Modifier.weight(1f),
                        tone = ButtonTone.SECONDARY,
                        enabled = hasPosition,
                        height = 48.dp,
                        radius = 14.dp,
                        textStyle = SType.bodyMedium,
                    )
                    DeleteButton(onDelete, Modifier.weight(1f))
                }
            }
            else -> {
                if (status is OfflineMaps.Status.Failed) {
                    NoticeCard(stringResource(R.string.offline_failed, status.reason), NoticeTone.DANGER)
                }
                Text(
                    stringResource(if (hasPosition) R.string.offline_idle else R.string.offline_no_position),
                    style = SType.small,
                    color = c.muted,
                )
                SaarthiButton(
                    stringResource(R.string.offline_save_here),
                    onSaveHere,
                    tone = ButtonTone.SECONDARY,
                    enabled = hasPosition,
                    height = 52.dp,
                )
                if (hasRoute) {
                    SaarthiButton(stringResource(R.string.offline_save_route), onSaveRoute, tone = ButtonTone.SECONDARY, height = 52.dp)
                }
            }
        }
    }
}

/** Indigo into saffron, as the design fills it; a sliding band until the total is known. */
@Composable
private fun ProgressBar(fraction: Float?) {
    val c = Saarthi.colors
    val sweep by rememberLoop(1_400, Ease.inOut, rest = 0.5f, label = "offline-progress")
    val fill = Brush.horizontalGradient(listOf(c.primary, Color(0xFFFE5D09)))
    Box(
        Modifier
            .fillMaxWidth()
            .height(6.dp)
            .clip(CircleShape)
            .background(c.sunken)
            .drawBehind {
                val corner = CornerRadius(size.height / 2)
                if (fraction != null) {
                    drawRoundRect(fill, size = Size(size.width * fraction, size.height), cornerRadius = corner)
                } else {
                    val band = size.width * INDETERMINATE_WIDTH
                    val x = -band + (size.width + band) * sweep
                    drawRoundRect(fill, topLeft = Offset(x, 0f), size = Size(band, size.height), cornerRadius = corner)
                }
            },
    )
}

@Composable
private fun DeleteButton(onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Box(
        modifier
            .height(48.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(c.sunken)
            .pressable(label = stringResource(R.string.offline_delete), onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(stringResource(R.string.offline_delete), style = SType.bodyMedium, color = c.danger)
    }
}

/** What the shift card can do. */
class ShiftCardActions(
    val startTrip: () -> Unit,
    val endTrip: () -> Unit,
    val signOff: () -> Unit,
)

/**
 * The shift, at the foot of the map: slide to start, slide to end, or sign off.
 * Every branch reads the server's state; nothing here guesses at the next one.
 */
@Composable
fun ShiftCard(state: TerminalState, actions: ShiftCardActions, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    SaarthiCard(modifier, radius = 24.dp, padding = PaddingValues(18.dp), spacing = 12.dp) {
        val title: String
        val body: String
        when {
            state == TerminalState.READY -> {
                title = stringResource(R.string.home_ready_title)
                body = stringResource(R.string.home_ready_body)
            }
            state == TerminalState.TRIP_ACTIVE -> {
                title = stringResource(R.string.home_active_title)
                body = stringResource(R.string.shift_end_body)
            }
            state.checklistOutstanding -> {
                title = stringResource(R.string.state_checks_due)
                body = stringResource(R.string.shift_checks_body)
            }
            state == TerminalState.TRIP_COMPLETED -> {
                title = stringResource(R.string.state_trip_finished)
                body = stringResource(R.string.shift_finished_body)
            }
            else -> {
                title = state.driverWord()
                body = stringResource(if (state.waitingOnFleet) R.string.next_step_awaiting else R.string.next_step_blurb)
            }
        }
        Text(title, style = SType.cardTitle.copy(fontSize = 17.sp), color = c.fg)
        Text(body, style = SType.small, color = c.muted)
        when (state) {
            TerminalState.READY -> SlideToAct(stringResource(R.string.slide_start_trip), actions.startTrip)
            TerminalState.TRIP_ACTIVE -> SlideToAct(stringResource(R.string.slide_end_trip), actions.endTrip)
            else -> SaarthiButton(stringResource(R.string.shift_sign_off), actions.signOff, tone = ButtonTone.SECONDARY, height = 52.dp)
        }
    }
}

private const val MOVING_KPH = 5.0
private const val LOW_FUEL_PERCENT = 15.0
private const val HOT_COOLANT_C = 105.0
private const val INDETERMINATE_WIDTH = 0.3f
