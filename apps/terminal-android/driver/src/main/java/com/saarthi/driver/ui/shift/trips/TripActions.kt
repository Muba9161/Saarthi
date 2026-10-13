package com.saarthi.driver.ui.shift.trips

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.core.network.QueueSuggestionDto
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.Hint
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.card
import java.util.Locale

/** Whether the driver's own trips can be started now, and if not, why. */
internal enum class StartWindow {
    /** Nothing under way and the safety check done: any trip can start. */
    OPEN,

    /** A trip is under way: the next one starts on its own when it ends. */
    AFTER_CURRENT,

    /** The fleet's trip is waiting: it runs first. */
    FLEET_FIRST,

    /** The safety check is not done yet: Start opens it, and the trip starts once it is done. */
    CHECK_FIRST,
}

/** What the driver can do with the trips on the Trips tab. */
internal class TripControls(
    val window: StartWindow,
    val onStart: (tripId: String) -> Unit,
    val onStop: () -> Unit,
    val onMove: (tripId: String, by: Int) -> Unit,
    val onRemove: (tripId: String) -> Unit,
    val saving: Boolean,
)

/** The trip under way: end it where the vehicle is. Confirmed by the shell first. */
@Composable
internal fun RowScope.StopAction(onStop: () -> Unit) {
    SaarthiButton(
        stringResource(R.string.trips_stop),
        onStop,
        Modifier.weight(1f),
        tone = ButtonTone.DANGER_OUTLINE,
        leading = Lucide.stop,
        height = 44.dp,
    )
}

/**
 * Start this trip, and move it up or down the driver's order.
 *
 * An arrow is left out at the end it cannot move past, rather than drawn and
 * refusing, so what is there always does something.
 */
@Composable
internal fun RowScope.QueuedActions(
    canStart: Boolean,
    onStart: () -> Unit,
    onUp: (() -> Unit)?,
    onDown: (() -> Unit)?,
    onRemove: (() -> Unit)? = null,
) {
    val c = Saarthi.colors
    SaarthiButton(
        stringResource(R.string.trips_start),
        onStart,
        Modifier.weight(1f),
        tone = ButtonTone.PRIMARY,
        leading = Lucide.play,
        height = 44.dp,
        enabled = canStart,
    )
    onUp?.let {
        CircleButton(Lucide.arrowUp, stringResource(R.string.trips_move_up), it, background = c.sunken, elevated = false)
    }
    onDown?.let {
        CircleButton(Lucide.arrowDown, stringResource(R.string.trips_move_down), it, background = c.sunken, elevated = false)
    }
    onRemove?.let {
        CircleButton(Lucide.trash, stringResource(R.string.trips_remove), it, background = c.sunken, ink = c.danger, elevated = false)
    }
}

/** Why the trips below cannot start yet, said once above them rather than on every card. */
@Composable
internal fun StartWindowHint(window: StartWindow, modifier: Modifier = Modifier) {
    val text = when (window) {
        StartWindow.OPEN -> return
        StartWindow.AFTER_CURRENT -> R.string.trips_after_current
        StartWindow.FLEET_FIRST -> R.string.trips_fleet_first
        StartWindow.CHECK_FIRST -> R.string.trips_check_first
    }
    Hint(stringResource(text), modifier)
}

/**
 * "A shorter order": the trips in the order that drives least, how much it
 * saves, and a way to take it or leave it.
 */
@Composable
internal fun ShorterOrderCard(
    suggestion: QueueSuggestionDto,
    stops: List<String>,
    saving: Boolean,
    onUse: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    Column(
        modifier
            .fillMaxWidth()
            .card(color = c.primaryWash, ring = c.primaryRing)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Eyebrow(stringResource(R.string.trips_suggest_title), color = c.primary)
        Text(
            stringResource(R.string.trips_suggest_saves, kilometresText(suggestion.savedKm)),
            style = SType.bodyStrong,
            color = c.fg,
        )
        Text(stops.joinToString("  →  "), style = SType.small, color = c.muted)
        Text(
            stringResource(
                R.string.trips_suggest_total,
                kilometresText(suggestion.suggestedKm),
                kilometresText(suggestion.currentKm),
            ),
            style = SType.small,
            color = c.muted,
        )
        if (suggestion.estimated) Hint(stringResource(R.string.trips_suggest_estimated))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SaarthiButton(
                stringResource(R.string.trips_suggest_use),
                onUse,
                Modifier.weight(1f),
                tone = ButtonTone.PRIMARY,
                height = 44.dp,
                busy = saving,
            )
            SaarthiButton(
                stringResource(R.string.trips_suggest_dismiss),
                onDismiss,
                Modifier.weight(1f),
                tone = ButtonTone.SECONDARY,
                height = 44.dp,
            )
        }
    }
}

/** "6.2" — one decimal, a point for the decimal on every phone. */
private fun kilometresText(km: Double): String = String.format(Locale.US, "%.1f", km)
