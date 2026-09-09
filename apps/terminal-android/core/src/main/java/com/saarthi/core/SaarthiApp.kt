package com.saarthi.core

import android.app.Activity
import android.content.Context
import com.saarthi.core.data.EventOutbox
import com.saarthi.core.data.TerminalIdentityStore
import com.saarthi.core.data.PaperCache
import com.saarthi.core.data.TerminalRepository
import com.saarthi.core.data.TerminalSettings
import com.saarthi.core.network.RealtimeClient
import com.saarthi.core.telemetry.TelemetryHub
import kotlinx.coroutines.CoroutineScope

/**
 * The long-lived objects a Saarthi app holds, from the shared code's side.
 *
 * The reporting service, the boot receiver and the cockpit's view model all need
 * the repository, the telemetry hub and the settings — and all three outlive any
 * screen, so they belong to the `Application`. Before there were two apps that
 * was simply `SaarthiTerminalApp`; shared code cannot name a particular app's
 * class, so it names this instead and each app implements it.
 *
 * Deliberately an interface over the *existing* objects rather than a new
 * container. Nothing about how the tablet builds its graph changed — it declares
 * that it satisfies this and the shared code stops knowing which app it is
 * inside.
 *
 * There is no service locator here and no injection framework. One `Application`
 * with half a dozen lazy properties is the whole dependency graph of this
 * product, and a framework to manage six objects would be more machinery than
 * the thing it manages.
 */
interface SaarthiApp {

    /** Application-lifetime scope. Work started here outlives every screen. */
    val scope: CoroutineScope

    /** The device credential, at rest. */
    val identity: TerminalIdentityStore

    /** Server address, OBD adapter, and the handful of on-device preferences. */
    val settings: TerminalSettings

    /** Events waiting for a connection. A yard has no signal. */
    val outbox: EventOutbox

    /** Whatever is currently reporting: GPS, an OBD adapter, or the simulator. */
    val telemetry: TelemetryHub

    /** Everything the app knows about its vehicle, driver and session. */
    val repository: TerminalRepository

    /** The live channel, for approvals and commands that cannot wait for a poll. */
    val realtime: RealtimeClient

    /**
     * Where the driver's papers are held for a checkpoint with no signal.
     *
     * Null on the fitted tablet, and that is the honest default rather than an
     * oversight: a document wallet is a thing a person carries and produces on
     * demand, and the tablet is bolted to the vehicle and shared between
     * drivers. A licence cached on it would belong to whoever drove last.
     */
    val papers: PaperCache? get() = null

    /**
     * The screen the reporting notification opens.
     *
     * Named by the app because each has its own entry point — the tablet opens
     * its cockpit, the phone opens whatever screen its driver is mid-way
     * through. The notification is permanent while the service runs, so tapping
     * it has to land somewhere sensible rather than nowhere.
     */
    val mainActivity: Class<out Activity>

    /**
     * The small icon that notification carries.
     *
     * A drawable id rather than a shared asset: the two apps have different
     * icons, and a notification wearing the wrong product's mark is confusing
     * in exactly the situation where it matters — a driver glancing at a status
     * bar while moving.
     */
    val notificationIcon: Int

    companion object {
        /**
         * The notification channel the reporting service posts to.
         *
         * Shared because the service is shared. Both apps create a channel with
         * this id in `onCreate`; a service posting to a channel that does not
         * exist is a foreground service that cannot start, and on Android 14
         * that is a crash rather than a missing notification.
         */
        const val SERVICE_CHANNEL_ID = "saarthi.telemetry"

        /**
         * The app, from any context.
         *
         * Throws rather than returning null: every caller is inside the app, so
         * a failure here means the `Application` class is not wired up in the
         * manifest — a build mistake that should be loud and immediate, not a
         * null that surfaces later as an unexplained blank screen.
         */
        fun from(context: Context): SaarthiApp =
            context.applicationContext as? SaarthiApp
                ?: error(
                    "The application class does not implement SaarthiApp. Check " +
                        "android:name in the manifest.",
                )
    }
}
