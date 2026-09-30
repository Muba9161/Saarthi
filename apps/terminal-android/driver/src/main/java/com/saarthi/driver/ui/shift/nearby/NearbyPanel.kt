package com.saarthi.driver.ui.shift.nearby

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
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.InlineSpinner
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.MapInk
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Skeleton
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.bottomRule
import com.saarthi.driver.ui.design.brandGradient
import com.saarthi.driver.ui.design.pressable

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
 */
@Composable
internal fun NearbyPanel(
    kind: ServiceKind,
    onKind: (ServiceKind) -> Unit,
    loading: Boolean,
    failed: Boolean,
    onRetry: () -> Unit,
    hasPosition: Boolean,
    roadDistances: Boolean,
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
    val shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
    Column(
        modifier
            .fillMaxSize()
            .shadow(24.dp, shape, spotColor = Color.Black.copy(alpha = 0.8f))
            .clip(shape)
            .background(PanelGround)
            .border(1.dp, Color(0x14FFFFFF), shape),
    ) {
        Box(
            Modifier
                .padding(top = 10.dp)
                .align(Alignment.CenterHorizontally)
                .size(width = 40.dp, height = 5.dp)
                .clip(CircleShape)
                .background(Color(0xFF3F3F46)),
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
                    color = MapInk.fg,
                    maxLines = 1,
                )
                Text(
                    search?.query ?: stringResource(if (roadDistances) R.string.nearby_road else R.string.nearby_straight),
                    style = SType.small,
                    color = MapInk.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            val count = search?.matches?.size ?: rows.size
            if (!loading || search != null) {
                Text(
                    pluralStringResource(R.plurals.nearby_count, count, count),
                    style = SType.captionStrong,
                    color = MapInk.soft,
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(MapInk.well)
                        .border(1.dp, Color(0xFF2A2A2E), CircleShape)
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                )
            }
        }
        if (search == null) {
            KindTiles(kind, if (loading) null else rows.size, onKind)
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
            when {
                search != null -> SearchResults(search, routing, onNavigateMatch)
                !hasPosition -> Note(stringResource(R.string.offline_no_position))
                loading -> LoadingRows()
                failed -> {
                    Note(stringResource(R.string.nearby_failed))
                    LinkButton(stringResource(R.string.action_try_again), onRetry, color = MapInk.primaryInk)
                }
                rows.isEmpty() -> Note(stringResource(R.string.nearby_empty))
                else -> PlaceList(kind, rows, featured, onPick, routing, onNavigatePlace)
            }
            if (!roadDistances && search == null && rows.isNotEmpty()) {
                Footnote(stringResource(R.string.nearby_footnote_straight))
            }
            Footnote(stringResource(R.string.nearby_footnote))
        }
    }
}

/** The kinds of place, as a row of tiles; the chosen one carries its count. */
@Composable
private fun KindTiles(kind: ServiceKind, count: Int?, onKind: (ServiceKind) -> Unit) {
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
                    .background(if (on) OnTile else OffTile)
                    .border(if (on) 1.5.dp else 1.dp, if (on) MapInk.primary else Color(0xFF26262A), shape)
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
                            .background(if (on) MapInk.primary else Color(0xFF232326)),
                        contentAlignment = Alignment.Center,
                    ) {
                        LineIcon(option.icon, size = 18.dp, color = if (on) MapInk.onPrimary else MapInk.muted)
                    }
                    if (on && count != null) {
                        Text(
                            count.toString(),
                            style = SType.microStrong.copy(fontSize = 10.sp),
                            color = MapInk.onPrimary,
                            modifier = Modifier
                                .align(Alignment.TopEnd)
                                .offset(x = 8.dp, y = (-5).dp)
                                .clip(CircleShape)
                                .background(Color.White)
                                .border(2.dp, OnTile, CircleShape)
                                .padding(horizontal = 5.dp, vertical = 1.dp),
                        )
                    }
                }
                Text(
                    stringResource(option.label),
                    style = SType.microStrong.copy(fontSize = 11.5.sp),
                    color = if (on) MapInk.fg else Color(0xFFB4B4BC),
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
                    .background(Color.White.copy(alpha = 0.14f))
                    .border(1.dp, Color.White.copy(alpha = 0.2f), RoundedCornerShape(13.dp)),
                contentAlignment = Alignment.Center,
            ) {
                LineIcon(kind.icon, size = 20.dp, color = Color.White)
            }
            Column(Modifier.weight(1f)) {
                Eyebrow(row.whereWord(), color = Color.White.copy(alpha = 0.72f))
                Text(place.name, style = SType.headerTitle, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Number(index, Color.White, Brand.navy, size = 28.dp)
        }
        place.meta().takeIf { it.isNotBlank() }?.let {
            Text(it, style = SType.small, color = Color.White.copy(alpha = 0.78f), maxLines = 2)
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(
                        place.kmLabel(),
                        style = SType.hero.copy(fontSize = 30.sp, lineHeight = 30.sp, letterSpacing = (-0.04).em),
                        color = Color.White,
                    )
                    Text(
                        stringResource(R.string.unit_km),
                        style = SType.bodyMedium.copy(fontSize = 15.sp),
                        color = Color.White,
                        modifier = Modifier.padding(start = 4.dp, bottom = 2.dp),
                    )
                }
                Text(
                    place.distance.durationMinutes?.takeIf { place.distance.isRoad }?.let { stringResource(R.string.nearby_by_road, it) }
                        ?: stringResource(R.string.nearby_straight_line),
                    style = SType.caption,
                    color = Color.White.copy(alpha = 0.75f),
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            Row(
                Modifier
                    .height(48.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color.White)
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
    val place = row.place
    val ahead = row.side == Side.AHEAD
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 68.dp)
            .bottomRule(Color(0xFF232326)),
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
            Number(index, if (ahead) MapInk.fg else Color(0xFF2E2E33), if (ahead) MapInk.onPrimary else Color(0xFFE4E4E7), size = 30.dp)
            Column(Modifier.weight(1f)) {
                Text(place.name, style = SType.bodyStrong, color = MapInk.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    place.meta().ifBlank { row.whereWord() },
                    style = SType.caption,
                    color = MapInk.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("${place.kmLabel()} ${stringResource(R.string.unit_km)}", style = SType.bodyStrong, color = MapInk.fg)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    row.side?.let { LineIcon(it.arrow, size = 11.dp, color = if (ahead) MapInk.primaryInk else MapInk.muted, stroke = 2.6f) }
                    Text(
                        place.distance.durationMinutes?.takeIf { place.distance.isRoad }?.let { stringResource(R.string.nearby_by_road, it) }
                            ?: stringResource(R.string.nearby_straight_short),
                        style = SType.micro,
                        color = if (ahead) MapInk.primaryInk else MapInk.muted,
                    )
                }
            }
        }
        NavigateButton(place.name, busy, onNavigate)
    }
}

/** Search results: the same rows, measured in a straight line from here. */
@Composable
private fun SearchResults(search: SearchState, routing: String?, onNavigate: (PlaceMatchDto) -> Unit) {
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
                        .bottomRule(Color(0xFF232326)),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Number(index, MapInk.fg, MapInk.onPrimary, size = 30.dp)
                    Column(Modifier.weight(1f)) {
                        Text(match.name, style = SType.bodyStrong, color = MapInk.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        match.address?.takeIf { it.isNotBlank() }?.let {
                            Text(it, style = SType.caption, color = MapInk.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    match.straightLineKm?.let { km ->
                        Text(
                            "${String.format(java.util.Locale.getDefault(), "%.1f", km)} ${stringResource(R.string.unit_km)}",
                            style = SType.bodyStrong,
                            color = MapInk.fg,
                        )
                    }
                    NavigateButton(match.name, routing == match.name) { onNavigate(match) }
                }
            }
        }
    }
}

@Composable
private fun NavigateButton(name: String, busy: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .size(44.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xFF1E2140))
            .pressable(enabled = !busy, scale = 0.92f, label = stringResource(R.string.nearby_navigate_to, name), onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (busy) InlineSpinner(MapInk.primaryInk, size = 16.dp) else LineIcon(Lucide.navigation, size = 18.dp, color = MapInk.primaryInk, stroke = 2.2f)
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
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Skeleton(Modifier.fillMaxWidth().height(150.dp), color = MapInk.well, shine = SkeletonShine, radius = 24.dp)
        repeat(3) { Skeleton(Modifier.fillMaxWidth().height(56.dp), color = MapInk.well, shine = SkeletonShine, radius = 14.dp) }
    }
}

@Composable
private fun Note(text: String) {
    Text(
        text,
        style = SType.small,
        color = MapInk.muted,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Color(0xFF18181B))
            .border(1.dp, Color(0xFF232326), RoundedCornerShape(16.dp))
            .padding(PaddingValues(horizontal = 16.dp, vertical = 14.dp)),
    )
}

@Composable
private fun Footnote(text: String) {
    Text(text, style = SType.micro, color = MapInk.subtle, modifier = Modifier.padding(horizontal = 2.dp))
}

/** The sheet's own grounds, a shade apart from the map beneath. */
private val PanelGround = Color(0xFF111113)
private val OnTile = Color(0xFF1E2140)
private val OffTile = Color(0xFF18181B)
private val SkeletonShine = Color(0x0DFFFFFF)
