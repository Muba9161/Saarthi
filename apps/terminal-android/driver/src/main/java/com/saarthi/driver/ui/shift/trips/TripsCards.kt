package com.saarthi.driver.ui.shift.trips

import androidx.annotation.StringRes
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.core.network.DriverTripDto
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Brand
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.Skeleton
import com.saarthi.driver.ui.design.StatusPill
import com.saarthi.driver.ui.design.bottomRule
import com.saarthi.driver.ui.design.brandGradient
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.topRule
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

/** How far each block on this tab travels as it rises in — the design's 18px. */
internal val TripsRise: Dp = 18.dp

/** Thousands grouped the Indian way — 2,340 or 1,24,560 — as the design writes them. */
private val Grouped: NumberFormat = NumberFormat.getIntegerInstance(Locale("en", "IN"))

/** What stands in for a distance nobody measured. Never a zero. */
private const val DASH = "—"

/** The placeholder a bolded figure replaces in its sentence. */
private const val ARG = "%1\$s"

private val BarHeight: Dp = 52.dp

/** Rounded tops and squarer feet, as the design draws each bar. */
private val BarShape = RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp, bottomStart = 2.dp, bottomEnd = 2.dp)

/** "94 km", grouped. */
@Composable
private fun kilometres(km: Double): String = stringResource(R.string.trips_km, Grouped.format(km.roundToInt()))

/** "29 Sep", in the phone's zone and the app's language; null when the server sent no usable time. */
@Composable
private fun dayOf(iso: String?): String? {
    val locale = LocalConfiguration.current.locales[0]
    val instant = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return null
    return DateTimeFormatter.ofPattern("d MMM", locale).withZone(ZoneId.systemDefault()).format(instant)
}

/**
 * A sentence with its figure in bold — "**512 km** planned".
 *
 * Built from the unformatted template so a translation can put the figure
 * wherever its grammar wants it, and the figure is bold wherever it lands.
 */
@Composable
private fun emphasised(@StringRes template: Int, figure: String): AnnotatedString {
    val ink = Saarthi.colors.fg
    val raw = stringResource(template)
    val at = raw.indexOf(ARG)
    return buildAnnotatedString {
        if (at < 0) {
            append(raw)
        } else {
            append(raw.substring(0, at))
            withStyle(SpanStyle(color = ink, fontWeight = FontWeight.SemiBold)) { append(figure) }
            append(raw.substring(at + ARG.length))
        }
    }
}

/**
 * The brand panel: the kilometres Saarthi measured, and the shape of the last
 * six finished trips beside it.
 *
 * Only measured distance is summed, and the sentence underneath says how many
 * trips that covers, so the total never reads as more than it is.
 */
@Composable
internal fun TripsSummary(board: TripsBoard) {
    val c = Saarthi.colors
    val unit = stringResource(R.string.trips_km_unit)
    val figure = buildAnnotatedString {
        append(board.measuredKm?.let { Grouped.format(it.roundToInt()) } ?: DASH)
        append(" ")
        withStyle(SpanStyle(fontSize = 16.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.sp)) { append(unit) }
    }
    val caption = if (board.measuredCount > 0) {
        pluralStringResource(R.plurals.trips_measured_across, board.measuredCount, board.measuredCount)
    } else {
        stringResource(R.string.trips_none_measured)
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            Modifier
                .rise(distance = TripsRise)
                .fillMaxWidth()
                .brandGradient(RoundedCornerShape(24.dp))
                .padding(horizontal = 20.dp, vertical = 18.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Eyebrow(stringResource(R.string.trips_distance_recorded), color = Color.White.copy(alpha = 0.72f))
                Text(figure, style = SType.figure, color = Color.White, maxLines = 1, modifier = Modifier.padding(top = 6.dp))
            }
            DistanceBars(board.bars)
        }
        Text(
            caption,
            style = SType.caption.copy(lineHeight = 18.sp),
            color = c.subtle,
            modifier = Modifier
                .rise(40, TripsRise)
                .padding(horizontal = 4.dp)
                .offset(y = (-2).dp),
        )
    }
}

/**
 * One column per recent trip, each growing up from its foot in turn; the
 * newest is white. Decorative — the figure beside it is what a screen reader hears.
 */
@Composable
private fun DistanceBars(bars: List<Float?>) {
    Row(
        Modifier
            .size(width = 116.dp, height = BarHeight)
            .clearAndSetSemantics {},
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        bars.forEachIndexed { index, fraction ->
            if (fraction == null) {
                Spacer(Modifier.weight(1f))
            } else {
                GrowingBar(
                    fraction = fraction,
                    color = if (index == bars.lastIndex) Color.White else Color.White.copy(alpha = 0.35f),
                    delayMs = 250 + index * 70,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun GrowingBar(fraction: Float, color: Color, delayMs: Int, modifier: Modifier = Modifier) {
    val reduced = Saarthi.reducedMotion
    val grown = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) { if (!reduced) grown.animateTo(1f, tween(900, delayMs, Ease.out)) }
    Box(
        modifier
            // A measured zero still gets a foot, so the column reads as "none" rather than missing.
            .height((BarHeight * fraction).coerceAtLeast(2.dp))
            .graphicsLayer {
                transformOrigin = TransformOrigin(0.5f, 1f)
                scaleY = grown.value
            }
            .clip(BarShape)
            .background(color),
    )
}

/**
 * The trip on the road now: where from, where to, how far was planned and
 * when it began. Anything the server did not say is left out, not guessed.
 */
@Composable
internal fun OpenTripCard(trip: OpenTrip, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val started = dayOf(trip.startedAt)
    Column(
        modifier
            .fillMaxWidth()
            .card()
            .padding(horizontal = 18.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatusPill(stringResource(R.string.trips_in_progress), background = c.warningBg, ink = c.warning, live = true)
            Spacer(Modifier.weight(1f))
            trip.reference?.let { Text(it, style = SType.mono(12.sp, tracking = 0.em), color = c.subtle, maxLines = 1) }
        }
        if (trip.origin != null || trip.destination != null) {
            RouteLines(trip.origin, trip.destination)
        }
        if (trip.plannedKm != null || started != null || trip.registration != null) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .topRule(c.border)
                    .padding(top = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                trip.plannedKm?.let {
                    Text(emphasised(R.string.trips_planned, kilometres(it)), style = SType.small, color = c.muted, maxLines = 1)
                }
                started?.let {
                    Text(emphasised(R.string.trips_started, it), style = SType.small, color = c.muted, maxLines = 1)
                }
                Spacer(Modifier.weight(1f))
                trip.registration?.let { Text(it, style = SType.mono(12.sp, tracking = 0.em), color = c.muted, maxLines = 1) }
            }
        }
    }
}

/** Origin in grey above the destination in bold, joined by the design's route rail. */
@Composable
private fun RouteLines(origin: String?, destination: String?) {
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        RouteRail(Modifier.fillMaxHeight())
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            origin?.let { Text(it, style = SType.body, color = c.muted, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            Text(
                destination ?: stringResource(R.string.trips_no_destination),
                style = SType.cardTitle.copy(lineHeight = 21.sp),
                color = if (destination != null) c.fg else c.muted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Origin ring, dashed line, saffron destination square — stretched to the lines beside it. */
@Composable
private fun RouteRail(modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(
        modifier
            .width(11.dp)
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box(
            Modifier
                .size(9.dp)
                .border(2.dp, c.primary, CircleShape),
        )
        Canvas(
            Modifier
                .width(2.dp)
                .weight(1f),
        ) {
            drawLine(
                c.borderStrong,
                Offset(size.width / 2, 0f),
                Offset(size.width / 2, size.height),
                size.width,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx())),
            )
        }
        Box(
            Modifier
                .size(9.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(Brand.saffron),
        )
    }
}

/** The finished trips, newest first, in one card with hairlines between them. */
@Composable
internal fun FinishedList(trips: List<DriverTripDto>, modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .card(),
    ) {
        trips.forEachIndexed { index, trip -> FinishedRow(trip, divider = index < trips.lastIndex) }
    }
}

@Composable
private fun FinishedRow(trip: DriverTripDto, divider: Boolean) {
    val c = Saarthi.colors
    val details = listOfNotNull(dayOf(trip.startedAt ?: trip.completedAt), trip.registrationNumber).joinToString(" · ")
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 68.dp)
            .bottomRule(c.border, show = divider)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconWell(Lucide.check, well = c.successBg, ink = c.success, size = 36.dp, radius = 12.dp, iconSize = 16.dp, stroke = 2.4f)
        Column(Modifier.weight(1f)) {
            Text(routeTitle(trip), style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (details.isNotEmpty()) {
                Text(
                    details,
                    style = SType.caption,
                    color = c.subtle,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
        TripDistance(trip)
    }
}

/** "Kanpur → Lucknow", or whichever end is known, or the trip's reference. */
@Composable
private fun routeTitle(trip: DriverTripDto): String {
    val from = trip.fromLabel?.takeIf { it.isNotBlank() }
    val to = trip.toLabel?.takeIf { it.isNotBlank() }
    return when {
        from != null && to != null -> stringResource(R.string.trips_route, from, to)
        else -> to ?: from ?: trip.reference?.takeIf { it.isNotBlank() } ?: stringResource(R.string.trips_untitled)
    }
}

/**
 * The distance on a finished row: bold when Saarthi measured it, grey and
 * marked "planned" when only the plan is known, a dash when neither is.
 */
@Composable
private fun TripDistance(trip: DriverTripDto) {
    val c = Saarthi.colors
    val km = trip.distanceKm
    Column(horizontalAlignment = Alignment.End) {
        Text(
            km?.let { kilometres(it) } ?: DASH,
            style = SType.bodyStrong,
            color = if (trip.distanceIsPlanned) c.muted else c.fg,
            maxLines = 1,
        )
        if (km != null && trip.distanceIsPlanned) {
            Text(stringResource(R.string.trips_planned_word), style = SType.micro, color = c.subtle)
        }
    }
}

/**
 * The whole-tab message when there is nothing to list: none yet, no signal,
 * or the fleet could not be reached — each with its own icon and, where it
 * helps, a way to ask again.
 */
@Composable
internal fun TripsStateCard(
    icon: String,
    well: Color,
    ink: Color,
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
) {
    val c = Saarthi.colors
    Column(
        modifier
            .fillMaxWidth()
            .card()
            .padding(horizontal = 20.dp, vertical = 24.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        IconWell(icon, well = well, ink = ink)
        Text(title, style = SType.cardTitle, color = c.fg, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
        Text(body, style = SType.small, color = c.muted, textAlign = TextAlign.Center)
        onRetry?.let { LinkButton(stringResource(R.string.trips_retry), it) }
    }
}

/** The tab's shape while the first answer is on its way: the summary, the filter and three rows. */
@Composable
internal fun TripsSkeleton(modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val loading = stringResource(R.string.trips_loading)
    Column(
        modifier.clearAndSetSemantics { contentDescription = loading },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ShimmerCard(radius = 24.dp) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .height(96.dp)
                    .padding(horizontal = 20.dp, vertical = 18.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.Bottom),
            ) {
                Bone(0.45f, 10.dp)
                Bone(0.35f, 28.dp)
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(44.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(c.segment),
        )
        ShimmerCard(radius = 20.dp) {
            repeat(3) { index ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 68.dp)
                        .bottomRule(c.border, show = index < 2)
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(
                        Modifier
                            .size(36.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(c.sunken),
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Bone(0.55f, 12.dp)
                        Bone(0.4f, 10.dp)
                    }
                }
            }
        }
    }
}

/** A card with the design's shimmer sweeping across the whole of it. */
@Composable
private fun ShimmerCard(radius: Dp, content: @Composable () -> Unit) {
    val c = Saarthi.colors
    Box(Modifier.fillMaxWidth()) {
        Column(
            Modifier
                .fillMaxWidth()
                .card(radius = radius),
        ) { content() }
        Skeleton(Modifier.matchParentSize(), color = Color.Transparent, shine = c.shine, radius = radius)
    }
}

/** One grey placeholder line, [fraction] of the width. */
@Composable
private fun Bone(fraction: Float, height: Dp) {
    Box(
        Modifier
            .fillMaxWidth(fraction)
            .height(height)
            .clip(RoundedCornerShape(6.dp))
            .background(Saarthi.colors.sunken),
    )
}
