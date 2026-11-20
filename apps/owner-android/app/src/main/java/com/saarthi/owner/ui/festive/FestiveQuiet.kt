package com.saarthi.owner.ui.festive

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * The rule that keeps a festival away from an emergency: a screen showing an
 * SOS asks the shell around it to take the garland down for as long as it does.
 */
@Stable
class FestiveQuiet {
    private var holds by mutableIntStateOf(0)

    /** Some screen on show carries an emergency: nothing festive near it. */
    val quiet: Boolean get() = holds > 0

    internal fun hold() {
        holds++
    }

    internal fun release() {
        holds--
    }
}

/** Provided by the shell around the tabs; null where nothing festive is drawn. */
val LocalFestiveQuiet = staticCompositionLocalOf<FestiveQuiet?> { null }

/** Call from a screen while it shows an [emergency] (an open SOS): the garland steps aside. */
@Composable
fun QuietFestival(emergency: Boolean) {
    val quiet = LocalFestiveQuiet.current ?: return
    DisposableEffect(quiet, emergency) {
        if (emergency) quiet.hold()
        onDispose { if (emergency) quiet.release() }
    }
}
