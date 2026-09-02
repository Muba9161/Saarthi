package com.saarthi.terminal

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import com.saarthi.terminal.data.EventOutbox
import com.saarthi.terminal.data.TerminalIdentityStore
import com.saarthi.terminal.data.TerminalRepository
import com.saarthi.terminal.data.TerminalSettings
import com.saarthi.terminal.network.RealtimeClient
import com.saarthi.terminal.telemetry.TelemetryHub
import com.saarthi.terminal.util.DebugLog
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
class SaarthiTerminalApp : Application() {

    /**
     * Application-lifetime work.
     *
     * `SupervisorJob` so one failed child — a socket that cannot connect, say —
     * does not take down telemetry with it. In a truck, those two failing
     * together would mean losing a journey because a websocket was unhappy.
     */
    val scope: CoroutineScope by lazy { CoroutineScope(SupervisorJob() + Dispatchers.Default) }

    val identity: TerminalIdentityStore by lazy { TerminalIdentityStore(this) }
    val settings: TerminalSettings by lazy { TerminalSettings(this) }
    val outbox: EventOutbox by lazy { EventOutbox(this) }
    val telemetry: TelemetryHub by lazy { TelemetryHub(this, scope) }

    val repository: TerminalRepository by lazy {
        TerminalRepository(
            context = this,
            identity = identity,
            settings = settings,
            outbox = outbox,
            telemetry = telemetry,
            scope = scope,
        )
    }

    val realtime: RealtimeClient by lazy {
        RealtimeClient(repository.api, identity, scope)
    }

    override fun onCreate() {
        super.onCreate()

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
