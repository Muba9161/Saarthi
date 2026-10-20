package com.saarthi.owner.ui.alerts

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.owner.R
import com.saarthi.owner.network.AlertsApi
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.ago
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SegmentedControl
import com.saarthi.owner.ui.design.bottomRule
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Everything Saarthi has told this person, newest first, grouped by day.
 *
 * Opening an alert marks it read and, when it points at something this app
 * shows, opens that; "Mark all read" clears the bell in one go.
 */
@Composable
fun AlertsScreen(api: AlertsApi, onBack: () -> Unit, onFollow: (AlertsApi.Alert) -> Unit = {}) {
    val model = viewModel { AlertsModel(api) }
    val state by model.state.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf(AlertFilter.ALL) }
    val c = Saarthi.colors
    val list = (state as? Loadable.Ready)?.value

    Column(
        Modifier
            .fillMaxSize()
            .background(c.canvas)
            .windowInsetsPadding(WindowInsets.statusBars),
    ) {
        Column(
            Modifier.padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CircleButton(Lucide.chevronLeft, stringResource(R.string.action_back), onBack, size = 48.dp)
                Column(Modifier.weight(1f)) {
                    Eyebrow(
                        list?.let {
                            if (it.unread > 0) pluralStringResource(R.plurals.ui_alerts_new_count, it.unread, it.unread) else stringResource(R.string.ui_alerts_all_read)
                        } ?: stringResource(R.string.ui_alerts),
                    )
                    Text(stringResource(R.string.ui_alerts), style = SType.headerTitle.copy(fontSize = SType.section.fontSize), color = c.fg)
                }
                if ((list?.unread ?: 0) > 0) {
                    LinkButton(stringResource(R.string.ui_alerts_mark_all_read), model::markAllRead, style = SType.smallStrong)
                }
            }
            SegmentedControl(
                options = AlertFilter.entries.map { it.label },
                selected = filter.ordinal,
                onSelect = { filter = AlertFilter.entries[it] },
                height = 42.dp,
            )
        }

        when (val shown = state) {
            Loadable.Loading -> SkeletonCards(modifier = Modifier.padding(20.dp))
            is Loadable.Failed -> FailedCard(shown.message, model::load, Modifier.padding(20.dp))
            is Loadable.Ready -> AlertFeed(
                list = shown.value,
                filter = filter,
                onOpen = { alert ->
                    model.open(alert.id)
                    onFollow(alert)
                },
                onLoadMore = model::loadMore,
            )
        }
    }
}

@Composable
private fun AlertFeed(
    list: AlertList,
    filter: AlertFilter,
    onOpen: (AlertsApi.Alert) -> Unit,
    onLoadMore: () -> Unit,
) {
    val shown = list.items.filter { it.matches(filter) }
    val groups = shown.groupBy { dayLabel(it.createdAt) }

    LazyColumn(
        Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.navigationBars),
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (shown.isEmpty()) {
            item { EmptyAlerts(filter) }
        }
        groups.forEach { (day, alerts) ->
            item(key = "label-$day") { GroupLabel(day) }
            item(key = "group-$day") {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .card(radius = 22.dp),
                ) {
                    alerts.forEachIndexed { index, alert ->
                        AlertRow(alert, divider = index < alerts.lastIndex, onOpen = { onOpen(alert) })
                    }
                }
            }
        }
        if (list.hasMore) {
            item(key = "more") {
                SaarthiButton(
                    stringResource(R.string.ui_alerts_show_older),
                    onClick = onLoadMore,
                    busy = list.loadingMore,
                    tone = ButtonTone.SECONDARY,
                    height = 50.dp,
                )
            }
        }
    }
}

@Composable
private fun AlertRow(alert: AlertsApi.Alert, divider: Boolean, onOpen: () -> Unit) {
    val c = Saarthi.colors
    val look = alert.look()
    val unread = alert.readAt == null
    Row(
        Modifier
            .fillMaxWidth()
            .pressable(scale = 0.99f, onClick = onOpen)
            .bottomRule(c.border, show = divider)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        IconWell(look.icon, well = look.well, ink = look.ink, size = 40.dp, radius = 12.dp, iconSize = 18.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    alert.title,
                    style = if (unread) SType.bodyStrong else SType.rowTitle,
                    color = c.fg,
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(ago(alert.createdAt), style = SType.caption, color = c.subtle)
            }
            alert.body?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = SType.small, color = c.muted, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
        }
        if (unread) {
            Box(
                Modifier
                    .padding(top = 6.dp)
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(c.accent),
            )
        }
    }
}

@Composable
private fun EmptyAlerts(filter: AlertFilter) {
    val c = Saarthi.colors
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        IconWell(Lucide.bell, well = c.sunken, ink = c.muted, size = 64.dp, shape = CircleShape, iconSize = 26.dp)
        Text(
            if (filter == AlertFilter.ALL) stringResource(R.string.ui_alerts_empty) else stringResource(R.string.ui_alerts_empty_filter, filter.label),
            style = SType.cardTitle,
            color = c.fg,
        )
        Text(stringResource(R.string.ui_alerts_empty_hint), style = SType.small, color = c.muted)
    }
}

// Made on each use, so the month and day names follow the app\'s language when it changes.
private val DayFormat: DateTimeFormatter get() = DateTimeFormatter.ofPattern("d MMM")

/** "Today", "Yesterday", or the date. */
private fun dayLabel(iso: String): String {
    val day = runCatching {
        java.time.Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate()
    }.getOrNull() ?: return Words.get(R.string.ui_alerts_day_earlier)
    val today = LocalDate.now()
    return when (day) {
        today -> Words.get(R.string.ui_alerts_day_today)
        today.minusDays(1) -> Words.get(R.string.ui_alerts_day_yesterday)
        else -> DayFormat.format(day)
    }
}
