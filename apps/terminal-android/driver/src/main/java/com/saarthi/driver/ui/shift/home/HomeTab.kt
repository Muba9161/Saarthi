package com.saarthi.driver.ui.shift.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.core.domain.DrivingHours
import com.saarthi.core.domain.PumpPrice
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.StatusPill
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger
import com.saarthi.driver.ui.shift.colors
import com.saarthi.driver.ui.shift.headerClearance
import com.saarthi.driver.ui.shift.link
import com.saarthi.driver.ui.shift.sentence
import com.saarthi.driver.ui.shift.tabBarClearance
import com.saarthi.driver.ui.shift.word

/** What Home can ask the shell to do. */
class HomeActions(
    val openMap: () -> Unit,
    val openCheck: () -> Unit,
    val startTrip: () -> Unit,
    val openNearby: () -> Unit,
    val openFuel: () -> Unit,
    val openNotices: () -> Unit,
    val checkNotNeeded: () -> Unit,
)

/**
 * Home, once the driver is on a vehicle.
 *
 * The questions a driver at a loading bay actually has, in the order they
 * have them: is the fleet hearing me, which vehicle am I on, have I been given
 * a job, and what do I do next. Everything is read from the state the server
 * sent; nothing here is inferred, because a home screen that disagrees with the
 * fleet's own record is worse than one that shows less.
 */
@Composable
fun HomeTab(cockpit: TerminalViewModel, fallbackPlate: String?, actions: HomeActions) {
    val c = Saarthi.colors
    val state by cockpit.uiState.collectAsState()
    val hours by cockpit.hours.collectAsState()
    val dispatch by cockpit.dispatch.collectAsState()
    val registration = state.registration ?: fallbackPlate
    val fuelType = state.server?.vehicle?.fuelType

    /*
     * Fetched when Home appears, not on a timer: a FASTag balance, today's
     * diesel rate and the papers do not move minute to minute, and polling them
     * from a cab spends a driver's data on answers that have not changed. The
     * dispatch is the exception worth asking for — a controller can assign work
     * while the driver is looking.
     */
    LaunchedEffect(registration) {
        cockpit.loadFastag()
        if (PumpPrice.worthFetching(fuelType)) cockpit.loadFuelPrice()
        cockpit.loadPapers()
        cockpit.loadNotifications()
        cockpit.loadDispatch()
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = headerClearance(), bottom = tabBarClearance()),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        val link = state.link
        val (ink, ground) = link.colors()
        Row(
            Modifier.rise(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            StatusPill(link.word(), background = ground, ink = ink, live = link == com.saarthi.driver.ui.shift.Link.LIVE)
            Text(link.sentence(), style = SType.small, color = c.muted)
        }

        TrackingCard(
            plate = registration ?: "",
            state = state.state,
            live = state.live,
            onOpenMap = actions.openMap,
            modifier = Modifier.rise(stagger(1)),
        )

        hoursMessage(hours)?.let { message ->
            NoticeCard(
                message,
                if (hours.advice == DrivingHours.Advice.BREAK_DUE || hours.advice == DrivingHours.Advice.SHIFT_DUE) {
                    NoticeTone.DANGER
                } else {
                    NoticeTone.WARNING
                },
                Modifier.rise(stagger(2)),
                icon = Lucide.timer,
            )
        }

        StatTiles(cockpit, fuelType, hours, Modifier.rise(stagger(3)))

        if (dispatch != null) {
            DispatchSection(cockpit, onRouted = actions.openMap, modifier = Modifier.rise(stagger(4)))
        }

        Text(
            stringResource(R.string.home_quick_actions),
            style = SType.section,
            color = c.fg,
            modifier = Modifier
                .padding(top = 10.dp)
                .rise(stagger(5)),
        )
        QuickActions(
            checkOutstanding = state.state.checklistOutstanding,
            actions = actions,
            modifier = Modifier.rise(stagger(5)),
        )

        NextStepCard(
            state = state.state,
            actions = actions,
            modifier = Modifier
                .padding(top = 10.dp)
                .rise(stagger(6)),
        )
    }
}

/** The hours notice, only when there is something worth saying. */
@Composable
private fun hoursMessage(hours: DrivingHours.State): String? = when (hours.advice) {
    DrivingHours.Advice.NONE -> null
    DrivingHours.Advice.BREAK_SOON -> stringResource(R.string.hours_break_soon, DrivingHours.format(hours.stintMs))
    DrivingHours.Advice.BREAK_DUE -> stringResource(R.string.hours_break_due, DrivingHours.format(hours.stintMs))
    DrivingHours.Advice.SHIFT_SOON -> stringResource(R.string.hours_shift_soon, DrivingHours.format(hours.todayMs))
    DrivingHours.Advice.SHIFT_DUE -> stringResource(R.string.hours_shift_due, DrivingHours.format(hours.todayMs))
}
