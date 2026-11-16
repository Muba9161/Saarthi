package com.saarthi.owner.ui.rides

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
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
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.design.Brand
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiCard
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.map.MapPin
import com.saarthi.owner.ui.map.PinKind
import com.saarthi.owner.ui.map.TrailRun
import com.saarthi.owner.ui.map.VehicleMap
import com.saarthi.owner.ui.tracking.Fix
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Full Journey Summary view displayed when a live ride share has ended.
 * Matches the live link's informative bento layout while preserving the
 * VorldX Saarthi native Android design system.
 */
@Composable
fun EndedRideSummaryView(
    ride: LiveRidesApi.LiveRide,
    trail: List<TrailRun>,
    fixes: List<Fix>,
    mine: Boolean,
    modifier: Modifier = Modifier,
) {
    val summary = remember(ride, fixes) {
        LiveRideSummaryHelper.resolveRideSummary(ride, fixes)
    }
    val name = ride.riderName.trim().ifEmpty { null } ?: stringResource(R.string.rides_someone)
    val plate = ride.registrationNumber?.trim()?.ifEmpty { null }
    val waypointCount = remember(trail, fixes) {
        val count = trail.sumOf { it.points.size }
        if (count > 0) count else fixes.size
    }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        SummaryHeader(
            summary = summary,
            name = name,
            plate = plate,
            mine = mine,
        )

        SummaryBentoGrid(summary = summary)

        SummaryTimelineCard(summary = summary)

        SummaryMapCard(
            summary = summary,
            trail = trail,
            waypointCount = waypointCount,
        )

        NoticeCard(
            text = stringResource(
                R.string.rides_summary_notice,
                LiveRideSummaryHelper.formatTime(summary.endedAt),
            ),
            tone = NoticeTone.INFO,
            icon = Lucide.shieldCheck,
        )
    }
}

/** Header with Journey Completed badge, plate, title, and date/time range. */
@Composable
private fun SummaryHeader(
    summary: LiveRidesApi.Summary,
    name: String,
    plate: String?,
    mine: Boolean,
) {
    val c = Saarthi.colors
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            StatusPill(
                stringResource(R.string.rides_summary_completed),
                background = c.sunken,
                ink = c.muted,
                live = false,
            )
            if (plate != null) {
                PlateChip(plate)
            }
        }

        Text(
            text = if (mine) {
                stringResource(R.string.rides_summary_title_mine)
            } else {
                stringResource(R.string.rides_summary_title, name)
            },
            style = SType.title.copy(fontSize = 24.sp, fontWeight = FontWeight.Bold),
            color = c.fg,
        )

        val dateStr = LiveRideSummaryHelper.formatDate(summary.startedAt)
        val startTime = LiveRideSummaryHelper.formatTime(summary.startedAt)
        val endTime = LiveRideSummaryHelper.formatTime(summary.endedAt)
        val durationStr = "${summary.durationMinutes} min"

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            LineIcon(Lucide.calendar, size = 14.dp, color = c.muted)
            Text(dateStr, style = SType.caption, color = c.muted)
            Text("•", style = SType.caption, color = c.muted)
            LineIcon(Lucide.clock, size = 14.dp, color = c.muted)
            Text("$startTime – $endTime ($durationStr)", style = SType.caption, color = c.muted)
        }
    }
}

/** 2x2 Bento grid for Total Distance, Duration, Average Speed, and Top Speed. */
@Composable
private fun SummaryBentoGrid(summary: LiveRidesApi.Summary) {
    val c = Saarthi.colors

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            SummaryStatCard(
                label = stringResource(R.string.rides_summary_distance),
                value = String.format(Locale.US, "%.1f km", summary.distanceKm),
                hint = stringResource(R.string.rides_summary_distance_hint),
                icon = Lucide.navigation,
                iconColor = c.primary,
                iconBg = c.primarySoft,
                modifier = Modifier.weight(1f),
            )
            SummaryStatCard(
                label = stringResource(R.string.rides_summary_duration),
                value = LiveRideSummaryHelper.formatDuration(summary.durationMinutes),
                hint = stringResource(R.string.rides_summary_duration_hint),
                icon = Lucide.clock,
                iconColor = c.fg,
                iconBg = c.sunken,
                modifier = Modifier.weight(1f),
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            SummaryStatCard(
                label = stringResource(R.string.rides_summary_avg_speed),
                value = "${summary.avgSpeedKph.roundToInt()} km/h",
                hint = stringResource(R.string.rides_summary_avg_speed_hint),
                icon = Lucide.gauge,
                iconColor = Brand.saffron,
                iconBg = c.primarySoft,
                modifier = Modifier.weight(1f),
            )
            SummaryStatCard(
                label = stringResource(R.string.rides_summary_top_speed),
                value = "${summary.maxSpeedKph.roundToInt()} km/h",
                hint = stringResource(R.string.rides_summary_top_speed_hint),
                icon = Lucide.zap,
                iconColor = Brand.saffron,
                iconBg = c.warningSoft,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** Single stat card for the bento grid. */
@Composable
private fun SummaryStatCard(
    label: String,
    value: String,
    hint: String,
    icon: String,
    iconColor: Color,
    iconBg: Color,
    modifier: Modifier = Modifier,
) {
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
            Eyebrow(label)
            Box(
                modifier = Modifier
                    .size(28.dp)
                    .clip(CircleShape)
                    .background(iconBg),
                contentAlignment = Alignment.Center,
            ) {
                LineIcon(icon, size = 14.dp, color = iconColor)
            }
        }
        Text(
            text = value,
            style = SType.title.copy(fontSize = 20.sp, fontWeight = FontWeight.Bold),
            color = c.fg,
        )
        Text(
            text = hint,
            style = SType.caption.copy(fontSize = 11.sp),
            color = c.muted,
        )
    }
}

/** Origin -> Destination journey timeline card with vertical connector. */
@Composable
private fun SummaryTimelineCard(summary: LiveRidesApi.Summary) {
    val c = Saarthi.colors
    val startTime = LiveRideSummaryHelper.formatTime(summary.startedAt)
    val endTime = LiveRideSummaryHelper.formatTime(summary.endedAt)
    val startCoord = summary.startPoint?.let {
        String.format(Locale.US, "%.4f, %.4f", it.latitude, it.longitude)
    } ?: stringResource(R.string.rides_live_no_location)
    val endCoord = summary.endPoint?.let {
        String.format(Locale.US, "%.4f, %.4f", it.latitude, it.longitude)
    } ?: stringResource(R.string.rides_live_no_location)

    SaarthiCard(
        modifier = Modifier.fillMaxWidth(),
        radius = 20.dp,
        padding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        spacing = 14.dp,
    ) {
        Eyebrow(stringResource(R.string.rides_summary_timeline))

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
        ) {
            // Timeline track (dots and connecting vertical line)
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(top = 2.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(14.dp)
                        .clip(CircleShape)
                        .background(c.successSoft)
                        .border(2.dp, c.success, CircleShape),
                )
                Box(
                    modifier = Modifier
                        .width(2.dp)
                        .height(34.dp)
                        .background(c.ring),
                )
                Box(
                    modifier = Modifier
                        .size(14.dp)
                        .clip(CircleShape)
                        .background(c.dangerSoft)
                        .border(2.dp, c.danger, CircleShape),
                )
            }

            Spacer(Modifier.width(12.dp))

            // Text labels for Departed and Arrived
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = stringResource(R.string.rides_summary_departed),
                            style = SType.bodyStrong.copy(fontSize = 13.sp),
                            color = c.fg,
                        )
                        Text(
                            text = startTime,
                            style = SType.caption.copy(fontSize = 12.sp, fontWeight = FontWeight.Medium),
                            color = c.muted,
                        )
                    }
                    Text(
                        text = startCoord,
                        style = SType.caption.copy(fontSize = 11.sp),
                        color = c.muted,
                    )
                }

                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = stringResource(R.string.rides_summary_arrived),
                            style = SType.bodyStrong.copy(fontSize = 13.sp),
                            color = c.fg,
                        )
                        Text(
                            text = endTime,
                            style = SType.caption.copy(fontSize = 12.sp, fontWeight = FontWeight.Medium),
                            color = c.muted,
                        )
                    }
                    Text(
                        text = endCoord,
                        style = SType.caption.copy(fontSize = 11.sp),
                        color = c.muted,
                    )
                }
            }
        }
    }
}

/** Map displaying completed road trail fitted to view with start and finish pins. */
@Composable
private fun SummaryMapCard(
    summary: LiveRidesApi.Summary,
    trail: List<TrailRun>,
    waypointCount: Int,
) {
    val c = Saarthi.colors
    val pins = remember(summary.startPoint, summary.endPoint) {
        val list = mutableListOf<MapPin>()
        summary.startPoint?.let {
            list.add(MapPin("start", it.latitude, it.longitude, PinKind.PICKUP))
        }
        summary.endPoint?.let {
            if (it.latitude != summary.startPoint?.latitude || it.longitude != summary.startPoint?.longitude) {
                list.add(MapPin("end", it.latitude, it.longitude, PinKind.DROP))
            }
        }
        list
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                LineIcon(Lucide.navigation, size = 15.dp, color = c.primary)
                Text(
                    text = stringResource(R.string.rides_summary_completed_route),
                    style = SType.bodyStrong,
                    color = c.fg,
                )
            }
            if (waypointCount > 0) {
                Text(
                    text = stringResource(R.string.rides_summary_waypoints, waypointCount),
                    style = SType.caption,
                    color = c.muted,
                )
            }
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(260.dp)
                .card(radius = 20.dp),
        ) {
            VehicleMap(
                vehicles = emptyList(),
                selectedId = null,
                onSelect = {},
                trail = trail,
                pins = pins,
                frameAllRequest = 1,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
