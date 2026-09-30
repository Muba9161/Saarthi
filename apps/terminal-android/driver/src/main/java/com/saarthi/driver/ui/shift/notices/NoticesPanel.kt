package com.saarthi.driver.ui.shift.notices

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.saarthi.core.network.DriverNotificationDto
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Brand
import com.saarthi.driver.ui.design.BrandMark
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.GroupLabel
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SystemBars
import com.saarthi.driver.ui.design.card
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Notices — what the fleet and Saarthi have written to this driver.
 *
 * Slides in over the shift from the right, as the design has it. The list is
 * fetched each time the panel opens and marked read only once it closes: the
 * driver has seen the new ones by then, and clearing them on the way in would
 * hide which ones were new while they were being read.
 */
@Composable
fun NoticesPanel(visible: Boolean, cockpit: TerminalViewModel, onClose: () -> Unit) {
    BackHandler(enabled = visible, onBack = onClose)
    // Disposed with `visible = true` exactly when a shown panel goes away —
    // closed, backed out of, or taken off screen with the shift.
    DisposableEffect(visible) {
        onDispose { if (visible) cockpit.markNotificationsRead() }
    }
    val reduced = Saarthi.reducedMotion
    AnimatedVisibility(
        visible = visible,
        enter = if (reduced) EnterTransition.None else slideInHorizontally(tween(500, easing = Ease.out)) { it },
        exit = if (reduced) ExitTransition.None else slideOutHorizontally(tween(300, easing = Ease.standard)) { it },
    ) {
        NoticesContent(cockpit, onClose)
    }
}

@Composable
private fun NoticesContent(cockpit: TerminalViewModel, onClose: () -> Unit) {
    val c = Saarthi.colors
    val notices by cockpit.notifications.collectAsState()
    val state by cockpit.uiState.collectAsState()
    val lastError by cockpit.lastError.collectAsState()
    var attempt by remember { mutableIntStateOf(0) }
    var waiting by remember { mutableStateOf(notices.items.isEmpty()) }

    /*
     * A skeleton only while an empty list is being fetched for the first time.
     *
     * The view model gives no completion signal for this call, so the wait
     * ends on the first thing that settles it: the list changing, the phone
     * being found offline, or a short ceiling — after which an unchanged empty
     * list genuinely is empty. A cached list is shown at once and refreshed
     * underneath.
     */
    LaunchedEffect(attempt) {
        val before = cockpit.notifications.value
        waiting = before.items.isEmpty()
        cockpit.loadNotifications()
        if (waiting) {
            withTimeoutOrNull(FIRST_LOAD_WAIT_MS) {
                combine(cockpit.notifications, cockpit.uiState) { now, ui -> now != before || ui.offline }
                    .first { settled -> settled }
            }
        }
        waiting = false
    }

    SystemBars(lightContent = c.dark)
    val now = remember(notices) { System.currentTimeMillis() }

    Column(
        Modifier
            .fillMaxSize()
            .background(c.canvas)
            .verticalScroll(rememberScrollState())
            .windowInsetsPadding(WindowInsets.statusBars)
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(start = 20.dp, end = 20.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        NoticesHeader(unread = notices.unread, onClose = onClose)
        Text(stringResource(R.string.notices_lead), style = SType.lead, color = c.muted)
        when {
            notices.items.isNotEmpty() -> NoticeSections(notices.items, now)
            waiting -> NoticesLoading()
            state.offline -> NoticesProblem(stringResource(R.string.notices_offline), offline = true) { attempt++ }
            lastError != null -> NoticesProblem(stringResource(R.string.notices_failed), offline = false) { attempt++ }
            else -> NoticesEmpty()
        }
    }
}

/** Back, the mark, the title, and how many are new. */
@Composable
private fun NoticesHeader(unread: Int, onClose: () -> Unit) {
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .height(56.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CircleButton(Lucide.chevronLeft, stringResource(R.string.action_back), onClose)
        BrandMark(height = 32.dp)
        Text(stringResource(R.string.notices_title), style = SType.section, color = c.fg, modifier = Modifier.weight(1f))
        if (unread > 0) {
            Box(
                Modifier
                    .clip(CircleShape)
                    .background(Brand.saffron)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Text(
                    pluralStringResource(R.plurals.notices_new_count, unread, unread),
                    style = SType.captionStrong.copy(fontWeight = FontWeight.Bold),
                    color = Color.White,
                )
            }
        }
    }
}

/**
 * Unread first, each on its own card; everything already read below, grouped.
 * The staggered delays are the design's, so the list lands in the same rhythm.
 */
@Composable
private fun NoticeSections(items: List<DriverNotificationDto>, now: Long) {
    val (fresh, earlier) = items.partition { it.readAt == null }
    if (fresh.isNotEmpty()) {
        Eyebrow(
            stringResource(R.string.notices_section_new),
            Modifier
                .padding(horizontal = 4.dp)
                .padding(top = 6.dp),
        )
        fresh.forEachIndexed { index, notice ->
            FreshNotice(notice, now, delayMs = FRESH_DELAY_MS + FRESH_STEP_MS * index.coerceAtMost(MAX_STAGGER))
        }
    }
    if (earlier.isNotEmpty()) {
        GroupLabel(stringResource(R.string.notices_section_earlier))
        Column(
            Modifier
                .fillMaxWidth()
                .card(),
        ) {
            earlier.forEachIndexed { index, notice ->
                EarlierNotice(
                    notice,
                    now,
                    delayMs = EARLIER_DELAY_MS + EARLIER_STEP_MS * index.coerceAtMost(MAX_STAGGER),
                    divided = index < earlier.lastIndex,
                )
            }
        }
    }
}

/** How long an empty first load may show a skeleton before it is taken at its word. */
private const val FIRST_LOAD_WAIT_MS = 4_000L

private const val FRESH_DELAY_MS = 120
private const val FRESH_STEP_MS = 60
private const val EARLIER_DELAY_MS = 240
private const val EARLIER_STEP_MS = 40

/** Past this many rows the rest arrive together rather than trailing in one by one. */
private const val MAX_STAGGER = 6
