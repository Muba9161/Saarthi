package com.saarthi.driver.ui.shift

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import com.saarthi.core.ui.TerminalViewModel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Arming, sending and the outcome of one emergency.
 *
 * The cockpit raises it; this only watches for the answer. An alert has landed
 * when the fleet hands back a reference it had not given before — anything
 * else, the request finishing without one or no answer in time, is a failure
 * the screen must say out loud so the driver tries again.
 */
@Stable
class SosController internal constructor(private val cockpit: TerminalViewModel) {
    var sending by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set
    internal var baseline: String? = null
        private set

    fun arm() {
        failed = false
        cockpit.armSos()
    }

    fun cancel() = cockpit.cancelSos()

    fun send() {
        if (sending) return
        baseline = cockpit.sosReference.value
        failed = false
        sending = true
        cockpit.triggerSos()
    }

    internal fun finish(landed: Boolean) {
        sending = false
        failed = !landed
    }
}

@Composable
fun rememberSosController(cockpit: TerminalViewModel, onSent: () -> Unit): SosController {
    val controller = remember(cockpit) { SosController(cockpit) }
    val sent by rememberUpdatedState(onSent)
    LaunchedEffect(controller.sending) {
        if (!controller.sending) return@LaunchedEffect
        val before = controller.baseline
        var started = false
        val reference = withTimeoutOrNull(SOS_ANSWER_MS) {
            combine(cockpit.busy, cockpit.sosReference) { busy, reference -> busy to reference }
                .first { (busy, reference) ->
                    if (busy) started = true
                    (reference != null && reference != before) || (started && !busy)
                }
                .second
        }
        val landed = reference != null && reference != before
        controller.finish(landed)
        if (landed) sent()
    }
    return controller
}

/** How long to wait for the fleet's reference before saying the alert did not go. */
private const val SOS_ANSWER_MS = 20_000L
