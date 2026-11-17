package com.saarthi.driver.update

import android.content.Context
import android.os.SystemClock
import com.saarthi.core.update.UpdateManager
import com.saarthi.core.update.UpdateSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/**
 * Humsafar keeping itself current.
 *
 * Held by the application, not a screen, so a download carries on while the
 * person moves around the app. The shared [UpdateManager] does the work —
 * checksum, no double download, cache sweep — against the public release
 * routes, so the person is offered an update whether they drive, ride along,
 * or are not signed in yet.
 *
 * One tap does everything: [start] downloads, and the verified build installs
 * by itself as soon as it is ready.
 */
class AppUpdates(
    private val context: Context,
    scope: CoroutineScope,
    private val source: UpdateSource,
) {
    private val manager = UpdateManager(context, scope, unattended = true)

    val state: StateFlow<UpdateManager.State> = manager.state

    /** Set by [start]; the build installs itself the moment it is verified. */
    @Volatile
    var installWhenReady: Boolean = false
        private set

    private var lastCheck = 0L

    /**
     * Ask whether a newer build is published.
     *
     * Throttled, because it is called on every return to the app: once every
     * [CHECK_EVERY_MS] is plenty for something published a few times a month.
     */
    fun check(force: Boolean = false) {
        val now = SystemClock.elapsedRealtime()
        if (!force && lastCheck != 0L && now - lastCheck < CHECK_EVERY_MS) return
        lastCheck = now
        manager.check(source)
    }

    /** The Update button: fetch the build, or install it if it is already here. */
    fun start() {
        installWhenReady = true
        markUpdating(context)
        when (state.value) {
            is UpdateManager.State.Ready -> manager.install()
            else -> manager.download(source)
        }
    }

    /** Called when the verified build is ready and [start] asked for it. */
    fun install() = manager.install()

    /** Android refused the install after the app handed it over. */
    fun installFailed(reason: String) {
        installWhenReady = false
        consumeUpdated(context)
        manager.installFailed(reason)
    }

    fun dismiss() = manager.dismiss()

    companion object {
        const val CHECK_EVERY_MS = 30 * 60 * 1000L

        private const val PREFS = "app_update"
        private const val KEY_UPDATING = "updating"

        /** Remember that this app replaced itself, so the next start can say so. */
        private fun markUpdating(context: Context) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_UPDATING, true).apply()
        }

        /** True once after an update this app started; false for any other install. */
        fun consumeUpdated(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            if (!prefs.getBoolean(KEY_UPDATING, false)) return false
            prefs.edit().remove(KEY_UPDATING).apply()
            return true
        }
    }
}
