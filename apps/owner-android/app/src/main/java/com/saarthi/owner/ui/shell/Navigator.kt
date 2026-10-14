package com.saarthi.owner.ui.shell

import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * The screens opened on top of a tab — a vehicle, a job, an order — newest last.
 *
 * Kept as plain composable content rather than routes: each feature opens its
 * own screens with what it already holds, and Back closes the top one. A
 * closing screen stays in the stack until it has slid away, so it leaves the
 * way it came in. The activity handles configuration changes itself, so the
 * stack survives a rotation or a switch to dark mode.
 */
@Stable
class Navigator {

    /** One opened screen. [key] stops a double tap opening the same thing twice. */
    class Entry(val key: String, val content: @Composable () -> Unit) {
        /** Slides in on arrival; set to false to slide it away. */
        val visibility = MutableTransitionState(false).apply { targetState = true }
        val closing: Boolean get() = !visibility.targetState
    }

    /** Every entry still on screen, including any sliding away. */
    val stack = mutableStateListOf<Entry>()

    private val open: List<Entry> get() = stack.filter { !it.closing }

    val canPop: Boolean get() = open.isNotEmpty()

    /** Open a screen over whatever is showing. Opening the one already on top does nothing. */
    fun push(key: String, content: @Composable () -> Unit) {
        if (open.lastOrNull()?.key == key) return
        stack.add(Entry(key, content))
    }

    /** Close the top screen. */
    fun pop() {
        open.lastOrNull()?.visibility?.targetState = false
    }

    /** Close every opened screen, back to the tabs. */
    fun popAll() {
        open.forEach { it.visibility.targetState = false }
    }

    /** Move a flow on to its next step without leaving the last one behind it. */
    fun replace(key: String, content: @Composable () -> Unit) {
        pop()
        stack.add(Entry(key, content))
    }

    /** Called by the shell once an entry has finished sliding away. */
    internal fun forget(entry: Entry) {
        stack.remove(entry)
    }
}

/** The navigator of the shell a screen is drawn inside. */
val LocalNavigator = staticCompositionLocalOf<Navigator> { error("No Navigator: draw this inside HomeShell.") }
