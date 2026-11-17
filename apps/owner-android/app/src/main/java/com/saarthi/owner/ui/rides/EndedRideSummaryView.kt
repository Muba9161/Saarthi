package com.saarthi.owner.ui.rides

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.R
import com.saarthi.owner.network.LiveRidesApi
import com.saarthi.owner.ui.design.Brand
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card
import java.time.Duration
import java.time.Instant
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

private data class SummaryStat(
    val label: String,
    val value: String,
    val hint: String,
    val icon: String,
    val iconColor: Color,
    val iconBg: Color,
)

/**
 * What an ended ride came to, as the server recorded it when sharing stopped,
 * for the few minutes it is kept. Figures only — the road is deleted with the
 * share — and one that was never recorded is left out rather than estimated.
 * The screen stops asking once a ride has ended, so the summary removes
 * itself when its time is up.
 */
@Composable
fun EndedRideSummaryView(summary: LiveRidesApi.Summary, modifier: Modifier = Modifier) {
    val until = remember(summary.shownUntil) { LiveRideSummaryHelper.shownUntil(summary) }
    var shown by remember(until) { mutableStateOf(until != null && until.isAfter(Instant.now())) }
    LaunchedEffect(until) {
        if (until == null) return@LaunchedEffect
        delay(Duration.between(Instant.now(), until).toMillis().coerceAtLeast(0))
        shown = false
    }
    if (!shown) return

    val c = Saarthi.colors
    val stats = buildList {
        add(
            SummaryStat(
                label = stringResource(R.string.rides_summary_duration),
                value = LiveRideSummaryHelper.formatDuration(summary.durationMinutes),
                hint = stringResource(R.string.rides_summary_duration_hint),
                icon = Lucide.clock,
                iconColor = c.fg,
                iconBg = c.sunken,
            ),
        )
        summary.distanceKm?.let {
            add(
                SummaryStat(
                    label = stringResource(R.string.rides_summary_distance),
                    value = String.format(Locale.US, "%.1f km", it),
                    hint = stringResource(R.string.rides_summary_distance_hint),
                    icon = Lucide.navigation,
                    iconColor = c.primary,
                    iconBg = c.primarySoft,
                ),
            )
        }
        summary.avgSpeedKph?.let {
            add(
                SummaryStat(
                    label = stringResource(R.string.rides_summary_avg_speed),
                    value = "${it.roundToInt()} km/h",
                    hint = stringResource(R.string.rides_summary_avg_speed_hint),
                    icon = Lucide.gauge,
                    iconColor = Brand.saffron,
                    iconBg = c.primarySoft,
                ),
            )
        }
        summary.maxSpeedKph?.let {
            add(
                SummaryStat(
                    label = stringResource(R.string.rides_summary_top_speed),
                    value = "${it.roundToInt()} km/h",
                    hint = stringResource(R.string.rides_summary_top_speed_hint),
                    icon = Lucide.zap,
                    iconColor = Brand.saffron,
                    iconBg = c.warningSoft,
                ),
            )
        }
    }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        stats.chunked(2).forEach { pair ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                pair.forEach { stat -> SummaryStatCard(stat, Modifier.weight(1f)) }
                // An odd one out keeps its half of the row.
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun SummaryStatCard(stat: SummaryStat, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(
        modifier = modifier
            .card(radius = 18.dp)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Eyebrow(stat.label)
            Box(
                modifier = Modifier
                    .size(28.dp)
                    .clip(CircleShape)
                    .background(stat.iconBg),
                contentAlignment = Alignment.Center,
            ) {
                LineIcon(stat.icon, size = 14.dp, color = stat.iconColor)
            }
        }
        Text(
            text = stat.value,
            style = SType.title.copy(fontSize = 20.sp, fontWeight = FontWeight.Bold),
            color = c.fg,
        )
        Text(
            text = stat.hint,
            style = SType.caption.copy(fontSize = 11.sp),
            color = c.muted,
        )
    }
}
