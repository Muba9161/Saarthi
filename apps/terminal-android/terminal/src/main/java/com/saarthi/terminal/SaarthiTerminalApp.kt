package com.saarthi.terminal

import com.saarthi.core.CoreConfig
import com.saarthi.core.SaarthiApp
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import com.saarthi.core.data.EventOutbox
import com.saarthi.core.data.TerminalIdentityStore
import com.saarthi.core.data.TerminalRepository
import com.saarthi.core.data.TerminalSettings
import com.saarthi.core.network.RealtimeClient
import com.saarthi.core.telemetry.TelemetryHub
import com.saarthi.core.util.DebugLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import org.maplibre.android.MapLibre

/**
 * The application object, and the app's only composition root.
 *
 * There is no dependency-injection framework here on purpose. This app has
 * about eight long-lived objects with a completely static wiring graph, and a
 * DI container would add a compile-time cost, a learning cost and an indirection
 * for every one of them in exchange for solving a problem the app does not have.
 * When the graph grows a genuine variant — a second telemetry source that is
 * chosen at runtime, say — that is the moment to reconsider, and the abstraction
 * that would need it already exists in `TelemetryProvider`.
 *
 * The scope here outlives every screen and the foreground service, which is
 * correct: a terminal keeps reporting while the driver is looking at a map, at
 * nothing, or at another app entirely.
 */
class SaarthiTerminalApp : Application(), SaarthiApp {

    /**
     * Application-lifetime work.
     *
     * `SupervisorJob` so one failed child — a socket that cannot connect, say —
     * does not take down telemetry with it. In a truck, those two failing
     * together would mean losing a journey because a websocket was unhappy.
     */
    override val scope: CoroutineScope by lazy { CoroutineScope(SupervisorJob() + Dispatchers.Default) }

    override val identity: TerminalIdentityStore by lazy { TerminalIdentityStore(this) }
    override val settings: TerminalSettings by lazy { TerminalSettings(this) }
    override val outbox: EventOutbox by lazy { EventOutbox(this) }
    override val telemetry: TelemetryHub by lazy { TelemetryHub(this, scope) }

    override val repository: TerminalRepository by lazy {
        TerminalRepository(
            context = this,
            identity = identity,
            settings = settings,
            outbox = outbox,
            telemetry = telemetry,
            scope = scope,
        )
    }

    /** Tapping the reporting notification comes back to the cockpit. */
    override val mainActivity: Class<out android.app.Activity> = MainActivity::class.java

    /** The tablet's own mark, in the status bar. */
    override val notificationIcon: Int = R.drawable.ic_launcher_foreground

    override val realtime: RealtimeClient by lazy {
        RealtimeClient(repository.api, identity, scope)
    }

    override fun onCreate() {
        super.onCreate()

        /*
         * The shared code's view of which app it is inside.
         *
         * This was missed when `:core` was split out, and the effect was
         * quiet rather than loud: the library fell back to its own defaults, so
         * the terminal reported version "0.0.0" on every heartbeat, compared
         * update version codes against 0, lost the simulator in debug builds,
         * and — worst — a fresh install fell back to the *production* API rather
         * than the URL this build was configured with.
         *
         * Nothing crashed, which is why it survived a build and a test run.
         */
        CoreConfig.initialise(
            host = CoreConfig.Host.TERMINAL,
            applicationId = BuildConfig.APPLICATION_ID,
            versionName = BuildConfig.VERSION_NAME,
            versionCode = BuildConfig.VERSION_CODE,
            defaultApiUrl = BuildConfig.SAARTHI_API_URL,
            mapStyleUrl = BuildConfig.MAP_STYLE_URL,
            debug = BuildConfig.DEBUG,
            developerTools = BuildConfig.DEVELOPER_TOOLS,
            allowSimulation = BuildConfig.ALLOW_SIMULATION,
        )

        // MapLibre wants initialising before any map view is inflated. The empty
        // API key is correct and not an oversight: OpenFreeMap needs no
        // registration, which is exactly why the web app uses it too.
        MapLibre.getInstance(this)

        createNotificationChannel()

        DebugLog.info(
            "app",
            "Saarthi Terminal ${BuildConfig.VERSION_NAME} starting against ${settings.apiUrl}",
        )
        if (!identity.usingHardwareBackedStorage) {
            // Worth saying out loud on the admin screen: this tablet's keystore
            // is unavailable, so the device secret is not hardware-protected.
            DebugLog.warn(
                "app",
                "Keystore unavailable — credentials are stored without hardware backing",
            )
        }
    }

    /**
     * The foreground-service channel.
     *
     * `IMPORTANCE_LOW`: the notification must be *present* — it is the privacy
     * notice, and it cannot be dismissed while the service runs — but it must
     * not make a sound every time it updates. A tablet that chimes each time it
     * reports a position is a tablet somebody switches off.
     */
    private fun createNotificationChannel() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            SERVICE_CHANNEL_ID,
            getString(R.string.service_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.service_channel_description)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    companion object {
        const val SERVICE_CHANNEL_ID = "saarthi-terminal-service"

        fun from(context: Context): SaarthiTerminalApp =
            context.applicationContext as SaarthiTerminalApp
    }
}
