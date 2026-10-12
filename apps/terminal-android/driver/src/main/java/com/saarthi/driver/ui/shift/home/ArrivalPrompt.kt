package com.saarthi.driver.ui.shift.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.core.network.TerminalTripDto
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.SaarthiCard
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * "You have reached …" — the vehicle's GPS shows it at the destination, and
 * the driver is asked to confirm.
 *
 * Never confirmed on the GPS alone: a truck stopped outside the gate for tea
 * has not delivered anything. Confirming records the time the GPS saw it
 * arrive, not the moment of the tap, so a driver who confirms late costs the
 * fleet nothing in accuracy.
 */
@Composable
internal fun ArrivalPrompt(job: TerminalTripDto, cockpit: TerminalViewModel, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    var sending by remember(job.id) { mutableStateOf(false) }
    var failed by remember(job.id) { mutableStateOf(false) }
    val stop = job.destinationStop
    val place = stop?.name?.takeIf { it.isNotBlank() } ?: job.destinationAddress
    val since = clockTime(stop?.reachedAt)

    SaarthiCard(modifier, padding = androidx.compose.foundation.layout.PaddingValues(18.dp), spacing = 14.dp) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            IconWell(Lucide.flag, well = c.successBg, ink = c.success, size = 44.dp, radius = 14.dp, iconSize = 22.dp)
            Column(Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite }) {
                Text(
                    stringResource(R.string.arrival_reached, place),
                    style = SType.cardTitle,
                    color = c.fg,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    since?.let { stringResource(R.string.arrival_since, it) } ?: stringResource(R.string.arrival_confirm_body),
                    style = SType.small,
                    color = c.muted,
                )
            }
        }
        if (failed) Text(stringResource(R.string.arrival_failed), style = SType.small, color = c.warning)
        SaarthiButton(
            stringResource(R.string.arrival_confirm),
            {
                sending = true
                failed = false
                cockpit.confirmArrival { ok ->
                    sending = false
                    failed = !ok
                }
            },
            busy = sending,
            busyText = stringResource(R.string.arrival_confirming),
            leading = Lucide.check,
        )
    }
}

/** "10:42 am", in the phone's own clock style; null for nothing usable. */
private fun clockTime(iso: String?): String? = iso?.let {
    runCatching {
        Instant.parse(it).atZone(ZoneId.systemDefault()).toLocalTime()
            .format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT))
    }.getOrNull()
}
