package com.saarthi.driver.ui.shift.nearby

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.core.network.NearbyPlaceDto
import com.saarthi.core.network.PlaceMatchDto
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Brand
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.InlineSpinner
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.MapInk
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.Skeleton
import com.saarthi.driver.ui.design.bottomRule
import com.saarthi.driver.ui.design.brandGradient
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.shift.nearby.NearbyViewModel.Listing
import com.saarthi.driver.ui.shift.nearby.NearbyViewModel.Reason

/** A search in progress, as the panel shows it. */
internal class SearchState(
    val query: String,
    val matches: List<PlaceMatchDto>,
    val searching: Boolean,
    val failure: String?,
)

/**
 * The sheet over the lower part of the map: what is being shown, the kinds of
 * place, the featured place and the rest — or search results while searching.
 *
 * Drawn in the theme's map ink, so it sits on a light map in daylight and a
 * dark one at night like the rest of the Map tab.
 */
@Composable
internal fun NearbyPanel(
    kind: ServiceKind,
    onKind: (ServiceKind) -> Unit,
    listing: Listing,
    onRetry: () -> Unit,
    rows: List<NearbyRow>,
    featured: Int,
    onPick: (Int) -> Unit,
    search: SearchState?,
    routing: String?,
    routeFailed: Boolean,
    onNavigatePlace: (NearbyPlaceDto) -> Unit,
    onNavigateMatch: (PlaceMatchDto) -> Unit,
    modifier: Modifier = Modifier,
) {
    val ink = MapInk
    val shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
    val loaded = listing as? Listing.Loaded
    Column(
        modifier
            .fillMaxSize()
            .shadow(24.dp, shape, spotColor = ink.shadow)
            .clip(shape)
            .background(ink.canvas)
            .border(1.dp, ink.lineStrong, shape),
    ) {
        Box(
            Modifier
                .padding(top = 10.dp)
                .align(Alignment.CenterHorizontally)
                .size(width = 40.dp, height = 5.dp)
                .clip(CircleShape)
                .background(ink.handle),
        )
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 20.dp, top = 12.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    if (search != null) stringResource(R.string.nearby_search_title) else stringResource(kind.title),
                    style = SType.sheetTitle,
                    color = ink.fg,
                    maxLines = 1,
                )
                Text(
                    search?.query ?: stringResource(
                        if (loaded?.roadDistances != false) R.string.nearby_road else R.string.nearby_straight,
                    ),
                    style = SType.small,
                    color = ink.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            val count = search?.matches?.size ?: rows.size
            if (loaded != null || search != null) {
                Text(
                    pluralStringResource(R.plurals.nearby_count, count, count),
                    style = SType.captionStrong,
                    color = ink.soft,
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(ink.well)
                        .border(1.dp, ink.chipRing, CircleShape)
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                )
            }
        }
        if (search == null) {
            KindTiles(kind, loaded?.let { rows.size }, onKind)
        }
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .windowInsetsPadding(WindowInsets.navigationBars)
                .padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (routeFailed) Note(stringResource(R.string.toast_route_failed))
            if (search != null) {
                SearchResults(search, routing, onNavigateMatch)
            } else {
                when (listing) {
                    Listing.Loading -> LoadingRows()
                    is Listing.Failed -> {
                        Note(failureText(listing))
                        if (listing.reason != Reason.NO_POSITION) {
                            LinkButton(stringResource(R.string.action_try_again), onRetry, color = ink.primaryInk)
                        }
                    }
                    is Listing.Loaded -> {
                        if (listing.stale) Note(stringResource(R.string.nearby_stale))
                        if (rows.isEmpty()) {
                            Note(stringResource(R.string.nearby_empty))
                        } else {
                            PlaceList(kind, rows, featured, onPick, routing, onNavigatePlace)
                        }
                        if (!listing.roadDistances && rows.isNotEmpty()) {
                            Footnote(stringResource(R.string.nearby_footnote_straight))
                        }
                    }
                }
            }
            if (kind == ServiceKind.FUEL && search == null) Footnote(stringResource(R.string.nearby_footnote_pumps))
            Footnote(stringResource(R.string.nearby_footnote))
        }
    }
}

/** Why the list is not there, in words that say what to do about it. */
@Composable
private fun failureText(failure: Listing.Failed): String = when (failure.reason) {
    Reason.OFFLINE -> stringResource(R.string.nearby_failed_offline)
    Reason.NO_POSITION -> stringResource(R.string.offline_no_position)
    Reason.BUSY -> stringResource(R.string.nearby_failed_busy)
    Reason.REFUSED -> failure.message?.takeIf { it.isNotBlank() } ?: stringResource(R.string.nearby_failed)
}

/** The kinds of place, as a row of tiles; the chosen one carries its count. */
@Composable
private fun KindTiles(kind: ServiceKind, count: Int?, onKind: (ServiceKind) -> Unit) {
    val ink = MapInk
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ServiceKind.entries.forEach { option ->
            val on = option == kind
            val shape = RoundedCornerShape(18.dp)
            Column(
                Modifier
                    .width(80.dp)
                    .height(78.dp)
                    .clip(shape)
                    .background(if (on) ink.primarySoft else ink.well)
                    .border(if (on) 1.5.dp else 1.dp, if (on) ink.primary else ink.chipRing, shape)
                    .semantics { selected = on }
                    .pressable(role = Role.Tab, scale = 0.95f, label = stringResource(option.label)) { onKind(option) },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(7.dp, Alignment.CenterVertically),
            ) {
                Box {
                    Box(
                        Modifier
                            .size(36.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (on) ink.primary else ink.chip),
                        contentAlignment = Alignment.Center,
                    ) {
                        LineIcon(option.icon, size = 18.dp, color = if (on) ink.onPrimary else ink.muted)
                    }
                    if (on && count != null) {
                        Text(
                            count.toString(),
                            style = SType.microStrong.copy(fontSize = 10.sp),
                            color = ink.canvas,
                            modifier = Modifier
                                .align(Alignment.TopEnd)
                                .offset(x = 8.dp, y = (-5).dp)
                                .clip(CircleShape)
                                .background(ink.fg)
                                .border(2.dp, ink.primarySoft, CircleShape)
                                .padding(horizontal = 5.dp, vertical = 1.dp),
                        )
                    }
                }
                Text(
                    stringResource(option.label),
                    style = SType.microStrong.copy(fontSize = 11.5.sp),
                    color = if (on) ink.fg else ink.chipInk,
                    maxLines = 1,
                )
            }
        }
    }
}

/** The featured place on the brand card, then everything else. */
@Composable
private fun PlaceList(
    kind: ServiceKind,
    rows: List<NearbyRow>,
    featured: Int,
    onPick: (Int) -> Unit,
    routing: String?,
    onNavigate: (NearbyPlaceDto) -> Unit,
) {
    AnimatedContent(
        targetState = featured.coerceIn(0, rows.lastIndex),
        transitionSpec = {
            (fadeIn(tween(550, easing = Ease.out)) + slideInVertically(tween(550, easing = Ease.out)) { it / 8 }) togetherWith fadeOut(tween(150))
        },
        label = "nearby-featured",
    ) { index ->
        FeaturedCard(kind, index, rows[index], routing == rows[index].place.name, onNavigate)
    }
    val others = rows.withIndex().filter { it.index != featured }
    if (others.isEmpty()) {
        Note(stringResource(R.string.nearby_no_others))
        return
    }
    Eyebrow(stringResource(R.string.nearby_also), Modifier.padding(start = 2.dp, top = 6.dp), color = MapInk.muted)
    Column {
        others.forEach { (index, row) ->
            PlaceRow(index, row, routing == row.place.name, onPick = { onPick(index) }, onNavigate = { onNavigate(row.place) })
        }
    }
}

@Composable
private fun FeaturedCard(kind: ServiceKind, index: Int, row: NearbyRow, busy: Boolean, onNavigate: (NearbyPlaceDto) -> Unit) {
    val place = row.place
    val shape = RoundedCornerShape(24.dp)
    // The brand card is navy in both themes, so its ink is white in both.
    val onCard = Color.White
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .brandGradient(shape)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(13.dp))
                    .background(onCard.copy(alpha = 0.14f))
                    .border(1.dp, onCard.copy(alpha = 0.2f), RoundedCornerShape(13.dp)),
                contentAlignment = Alignment.Center,
            ) {
                LineIcon(kind.icon, size = 20.dp, color = onCard)
            }
            Column(Modifier.weight(1f)) {
                Eyebrow(row.whereWord(), color = onCard.copy(alpha = 0.72f))
                Text(place.name, style = SType.headerTitle, color = onCard, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Number(index, onCard, Brand.navy, size = 28.dp)
        }
        place.detail().takeIf { it.isNotBlank() }?.let {
            Text(it, style = SType.smallStrong, color = onCard.copy(alpha = 0.9f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        place.meta().takeIf { it.isNotBlank() }?.let {
            Text(it, style = SType.small, color = onCard.copy(alpha = 0.78f), maxLines = 2)
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(
                        place.kmLabel(),
                        style = SType.hero.copy(fontSize = 30.sp, lineHeight = 30.sp, letterSpacing = (-0.04).em),
                        color = onCard,
                    )
                    Text(
                        stringResource(R.string.unit_km),
                        style = SType.bodyMedium.copy(fontSize = 15.sp),
                        color = onCard,
                        modifier = Modifier.padding(start = 4.dp, bottom = 2.dp),
                    )
                }
                Text(
                    place.distance.durationMinutes?.takeIf { place.distance.isRoad }?.let { stringResource(R.string.nearby_by_road, it) }
                        ?: stringResource(R.string.nearby_straight_line),
                    style = SType.caption,
                    color = onCard.copy(alpha = 0.75f),
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            place.dialable()?.let { number ->
                CallButton(place.name, number, ground = onCard.copy(alpha = 0.16f), ink = onCard, size = 48.dp)
            }
            Row(
                Modifier
                    .height(48.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(onCard)
                    .pressable(enabled = !busy, label = stringResource(R.string.nearby_navigate_to, place.name)) { onNavigate(place) }
                    .padding(horizontal = 18.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (busy) InlineSpinner(Brand.navy, size = 16.dp) else LineIcon(Lucide.navigation, size = 17.dp, color = Brand.navy, stroke = 2.2f)
                Text(stringResource(R.string.nearby_navigate), style = SType.bodyStrong, color = Brand.navy)
            }
        }
    }
}

@Composable
private fun PlaceRow(index: Int, row: NearbyRow, busy: Boolean, onPick: () -> Unit, onNavigate: () -> Unit) {
    val ink = MapInk
    val place = row.place
    val ahead = row.side == Side.AHEAD
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 68.dp)
            .bottomRule(ink.rule),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            Modifier
                .weight(1f)
                .defaultMinSize(minHeight = 60.dp)
                .pressable(label = stringResource(R.string.nearby_pin, index + 1, place.name), scale = 0.99f, onClick = onPick),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Number(index, if (ahead) ink.fg else ink.sunken, if (ahead) ink.canvas else ink.fg, size = 30.dp)
            Column(Modifier.weight(1f)) {
                Text(place.name, style = SType.bodyStrong, color = ink.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    listOf(place.detail(), place.meta()).filter { it.isNotBlank() }.joinToString(" · ").ifBlank { row.whereWord() },
                    style = SType.caption,
                    color = ink.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("${place.kmLabel()} ${stringResource(R.string.unit_km)}", style = SType.bodyStrong, color = ink.fg)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    row.side?.let { LineIcon(it.arrow, size = 11.dp, color = if (ahead) ink.primaryInk else ink.muted, stroke = 2.6f) }
                    Text(
                        place.distance.durationMinutes?.takeIf { place.distance.isRoad }?.let { stringResource(R.string.nearby_by_road, it) }
                            ?: stringResource(R.string.nearby_straight_short),
                        style = SType.micro,
                        color = if (ahead) ink.primaryInk else ink.muted,
                    )
                }
            }
        }
        place.dialable()?.let { number ->
            CallButton(place.name, number, ground = ink.well, ink = ink.fg, size = 44.dp)
        }
        NavigateButton(place.name, busy, onNavigate)
    }
}

/** Search results: the same rows, measured in a straight line from here. */
@Composable
private fun SearchResults(search: SearchState, routing: String?, onNavigate: (PlaceMatchDto) -> Unit) {
    val ink = MapInk
    when {
        search.searching && search.matches.isEmpty() -> LoadingRows()
        search.failure != null -> Note(search.failure)
        search.matches.isEmpty() -> Note(stringResource(R.string.nearby_search_none))
        else -> Column {
            search.matches.forEachIndexed { index, match ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 68.dp)
                        .bottomRule(ink.rule),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Number(index, ink.fg, ink.canvas, size = 30.dp)
                    Column(Modifier.weight(1f)) {
                        Text(match.name, style = SType.bodyStrong, color = ink.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        match.address?.takeIf { it.isNotBlank() }?.let {
                            Text(it, style = SType.caption, color = ink.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    match.straightLineKm?.let { km ->
                        Text(
                            "${String.format(java.util.Locale.getDefault(), "%.1f", km)} ${stringResource(R.string.unit_km)}",
                            style = SType.bodyStrong,
                            color = ink.fg,
                        )
                    }
                    NavigateButton(match.name, routing == match.name) { onNavigate(match) }
                }
            }
        }
    }
}

/** Opens the dialler with the number filled in; the driver presses call themselves. */
@Composable
private fun CallButton(name: String, number: String, ground: Color, ink: Color, size: Dp) {
    val context = LocalContext.current
    Box(
        Modifier
            .size(size)
            .clip(RoundedCornerShape(14.dp))
            .background(ground)
            .pressable(scale = 0.92f, label = stringResource(R.string.nearby_call_place, name)) {
                context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$number")))
            },
        contentAlignment = Alignment.Center,
    ) {
        LineIcon(Lucide.phone, size = 17.dp, color = ink, stroke = 2.2f)
    }
}

@Composable
private fun NavigateButton(name: String, busy: Boolean, onClick: () -> Unit) {
    val ink = MapInk
    Box(
        Modifier
            .size(44.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(ink.primarySoft)
            .pressable(enabled = !busy, scale = 0.92f, label = stringResource(R.string.nearby_navigate_to, name), onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (busy) InlineSpinner(ink.primaryInk, size = 16.dp) else LineIcon(Lucide.navigation, size = 18.dp, color = ink.primaryInk, stroke = 2.2f)
    }
}

@Composable
private fun Number(index: Int, ground: Color, ink: Color, size: Dp) {
    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .background(ground),
        contentAlignment = Alignment.Center,
    ) {
        Text((index + 1).toString(), style = SType.smallStrong.copy(fontSize = 13.sp), color = ink)
    }
}

@Composable
private fun LoadingRows() {
    val well = MapInk.well
    val shine = Saarthi.colors.shine
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Skeleton(Modifier.fillMaxWidth().height(150.dp), color = well, shine = shine, radius = 24.dp)
        repeat(3) { Skeleton(Modifier.fillMaxWidth().height(56.dp), color = well, shine = shine, radius = 14.dp) }
    }
}

@Composable
private fun Note(text: String) {
    val ink = MapInk
    Text(
        text,
        style = SType.small,
        color = ink.muted,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(ink.well)
            .border(1.dp, ink.rule, RoundedCornerShape(16.dp))
            .padding(PaddingValues(horizontal = 16.dp, vertical = 14.dp)),
    )
}

@Composable
private fun Footnote(text: String) {
    Text(text, style = SType.micro, color = MapInk.subtle, modifier = Modifier.padding(horizontal = 2.dp))
}
