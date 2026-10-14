package com.saarthi.owner.ui.shell

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Layers drawn above the whole shell — a sheet opened from inside a tab.
 *
 * A tab is drawn beneath the floating tab bar, so a sheet drawn inside it
 * would rise up behind the bar with its buttons hidden. Handing the sheet to
 * this host draws it over everything instead, while the tab keeps owning its
 * state.
 */
@Stable
class OverlayHost {
    internal val layers = mutableStateMapOf<String, @Composable () -> Unit>()

    /** Draw every layer, in the order they were opened. */
    @Composable
    fun Draw() {
        layers.values.toList().forEach { it() }
    }
}

val LocalOverlayHost = staticCompositionLocalOf<OverlayHost> { error("No OverlayHost: draw this inside HomeShell.") }

/** Draw [content] above the shell for as long as the calling screen is on screen. */
@Composable
fun ShellOverlay(key: String, content: @Composable () -> Unit) {
    val host = LocalOverlayHost.current
    SideEffect { host.layers[key] = content }
    DisposableEffect(key) { onDispose { host.layers.remove(key) } }
}
