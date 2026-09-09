package com.saarthi.driver.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import com.saarthi.core.data.OfflineMaps
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.SaarthiDriverApp
import com.saarthi.driver.ui.design.AlertRed
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.CautionAmber
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.Ember
import com.saarthi.driver.ui.design.FleetButton
import com.saarthi.driver.ui.design.FleetCard
import com.saarthi.driver.ui.design.FleetOutlineButton
import com.saarthi.driver.ui.design.FleetRadius
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.LiveGreen
import com.saarthi.driver.ui.design.OnyxDeep
import com.saarthi.driver.ui.design.SectionHeader
import com.saarthi.driver.ui.design.Slate

/**
 * Keeping the map for where there is no signal.
 *
 * Saarthi already survives a dead zone for everything else — telemetry queues,
 * papers are cached, the trip stays open — and the map was the one part that
 * went blank in exactly the places a driver most needs it.
 *
 * Deliberately a thing the driver asks for rather than something the app does
 * quietly. Map tiles are the largest download Saarthi will ever make, most
 * Indian drivers are on metered data, and spending a day's bundle without being
 * asked would be indefensible however useful the result.
 */
@Composable
fun OfflineMapCard(cockpit: TerminalViewModel) {
    val app = LocalContext.current.applicationContext as SaarthiDriverApp
    val offline = app.offlineMaps
    val status by offline.status.collectAsState()
    val state by cockpit.uiState.collectAsState()
    val position = state.telemetry.position

    LaunchedEffect(Unit) { offline.refresh() }

    FleetCard(Modifier.fillMaxWidth()) {
        SectionHeader("Map for no-signal areas")
        Spacer(Modifier.height(FleetSpace.tight))

        when (val now = status) {
            OfflineMaps.Status.Idle -> {
                Text(
                    "Save the roads around you now and the map will still work where the " +
                        "signal does not. Roughly 30–60 MB, on your data.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Ash,
                )
                Spacer(Modifier.height(FleetSpace.snug))
                FleetButton(
                    label = "Save the area around me",
                    // Refuses rather than guessing a centre. A map saved around
                    // the wrong place is the download wasted and the dead zone
                    // still blank.
                    enabled = position != null,
                    onClick = {
                        position?.let { offline.saveAround(it.latitude, it.longitude) }
                    },
                )
                if (position == null) {
                    Spacer(Modifier.height(FleetSpace.tight))
                    Text(
                        "Saarthi needs to know where you are before it can save the right area.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                    )
                }
            }

            is OfflineMaps.Status.Working -> {
                Text(
                    "Saving the map…",
                    style = MaterialTheme.typography.titleSmall,
                    color = Chalk,
                )
                Spacer(Modifier.height(FleetSpace.snug))

                val fraction = now.fraction
                val filled by animateFloatAsState(
                    targetValue = fraction ?: 0f,
                    label = "offline-map",
                )
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(6.dp())
                        .clip(RoundedCornerShape(FleetRadius.pill))
                        .background(OnyxDeep),
                ) {
                    if (fraction != null) {
                        Box(
                            Modifier
                                .fillMaxWidth(filled)
                                .height(6.dp())
                                .clip(RoundedCornerShape(FleetRadius.pill))
                                .background(Ember),
                        )
                    }
                }
                Spacer(Modifier.height(FleetSpace.tight))
                Text(
                    // Bytes are the honest measure while the total is a guess.
                    // A percentage that revises itself downwards reads as broken.
                    if (fraction == null) {
                        "${megabytes(now.bytes)} saved so far. Keep the app open."
                    } else {
                        "${(fraction * 100).toInt()}% · ${megabytes(now.bytes)}"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate,
                )
            }

            is OfflineMaps.Status.Ready -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Saved",
                        style = MaterialTheme.typography.titleSmall,
                        color = LiveGreen,
                    )
                }
                Spacer(Modifier.height(FleetSpace.hair))
                Text(
                    "${megabytes(now.bytes)} of map is on this phone. It will be used " +
                        "automatically wherever there is no signal.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Ash,
                )
                Spacer(Modifier.height(FleetSpace.snug))
                Row(horizontalArrangement = Arrangement.spacedBy(FleetSpace.tight)) {
                    FleetOutlineButton(
                        label = "Save a new area",
                        onClick = {
                            position?.let { offline.saveAround(it.latitude, it.longitude) }
                        },
                        modifier = Modifier.weight(1f),
                    )
                    FleetOutlineButton(
                        label = "Delete",
                        onClick = { offline.delete() },
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            is OfflineMaps.Status.Failed -> {
                Text(
                    now.reason,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (now.reason.contains("too large")) CautionAmber else AlertRed,
                )
                Spacer(Modifier.height(FleetSpace.snug))
                FleetButton(
                    label = "Try again",
                    enabled = position != null,
                    onClick = {
                        position?.let { offline.saveAround(it.latitude, it.longitude) }
                    },
                )
            }
        }
    }
}

/** Megabytes, to one place. Bytes mean nothing to the person paying for them. */
private fun megabytes(bytes: Long): String = "%.1f MB".format(bytes / 1_048_576.0)

private fun Int.dp() = androidx.compose.ui.unit.Dp(this.toFloat())
