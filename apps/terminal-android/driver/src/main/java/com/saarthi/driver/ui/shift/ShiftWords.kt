package com.saarthi.driver.ui.shift

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import com.saarthi.core.domain.TerminalState
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Saarthi

/**
 * The shift stage, in a driver's words rather than the server's.
 *
 * The server owns the lifecycle and this only renames it, so no screen can
 * drift into a second opinion about what state the vehicle is in. The four
 * unsigned states say so plainly rather than falling into "Signed on", which
 * would be the one thing certainly untrue.
 */
@Composable
fun TerminalState.driverWord(): String = stringResource(
    when (this) {
        TerminalState.TRIP_ACTIVE -> R.string.state_in_transit
        TerminalState.TRIP_COMPLETED -> R.string.state_trip_finished
        TerminalState.READY -> R.string.state_ready
        TerminalState.APPROVED,
        TerminalState.CHECKLIST_REQUIRED,
        -> R.string.state_checks_due
        TerminalState.PENDING_APPROVAL -> R.string.state_awaiting_approval
        TerminalState.REJECTED -> R.string.state_not_approved
        TerminalState.REVOKED -> R.string.state_suspended
        TerminalState.UNPAIRED,
        TerminalState.PAIRING,
        TerminalState.VEHICLE_PAIRED,
        TerminalState.AWAITING_DRIVER,
        -> R.string.state_not_signed_on
        else -> R.string.state_signed_on
    },
)

/** Live, offline or still connecting — never "live" before the fleet has actually been reached. */
enum class Link { LIVE, OFFLINE, CONNECTING }

val TerminalViewModel.UiState.link: Link
    get() = when {
        live -> Link.LIVE
        offline -> Link.OFFLINE
        else -> Link.CONNECTING
    }

/** The pill word for the connection. */
@Composable
fun Link.word(): String = stringResource(
    when (this) {
        Link.LIVE -> R.string.status_live
        Link.OFFLINE -> R.string.status_offline
        Link.CONNECTING -> R.string.status_connecting
    },
)

/** The sentence beside the pill. */
@Composable
fun Link.sentence(): String = stringResource(
    when (this) {
        Link.LIVE -> R.string.reporting_live
        Link.OFFLINE -> R.string.reporting_saved
        Link.CONNECTING -> R.string.reporting_connecting
    },
)

/** Ink and ground for the connection pill, in the current theme. */
@Composable
fun Link.colors(): Pair<Color, Color> {
    val c = Saarthi.colors
    return when (this) {
        Link.LIVE -> c.success to c.successBg
        Link.OFFLINE -> c.warning to c.warningBg
        Link.CONNECTING -> c.muted to c.sunken
    }
}

/** `INSURANCE_CERTIFICATE` reads badly on a card; "Insurance certificate" does not. */
fun String.humanised(): String = lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
