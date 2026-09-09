package com.saarthi.driver

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import com.saarthi.core.CoreConfig
import org.maplibre.android.MapLibre
import com.saarthi.core.SaarthiApp
import com.saarthi.core.data.EventOutbox
import com.saarthi.core.data.TerminalIdentityStore
import com.saarthi.core.data.TerminalRepository
import com.saarthi.core.data.TerminalSettings
import com.saarthi.core.network.RealtimeClient
import com.saarthi.core.telemetry.TelemetryHub
import com.saarthi.core.util.DebugLog
import com.saarthi.driver.data.DriverAccountStore
import com.saarthi.core.data.OfflineMaps
import com.saarthi.core.data.PaperCache
import com.saarthi.driver.data.QuickLoginStore
import com.saarthi.driver.data.SharedDestinationInbox
import com.saarthi.driver.network.DriverApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * Saarthi, on a driver's own phone.
 *
 * The same graph the fitted terminal builds, plus the two things only this app
 * has: the driver's own signed-in account, and the client that speaks to Saarthi
 * as a person rather than as a device.
 *
 * Holding both credentials at once is the design, not an accident. The person is
 * who the fleet approves; the device is what reports telemetry. Keeping them
 * separate here is what lets the whole cockpit — written once, in `:core` — run
 * unchanged on a phone that a driver signed into and a tablet that a fitter
 * paired.
 */
class SaarthiDriverApp : Application(), SaarthiApp {

    override val scope: CoroutineScope by lazy {
        CoroutineScope(SupervisorJob() + Dispatchers.Default)
    }

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

    override val realtime: RealtimeClient by lazy {
        RealtimeClient(repository.api, identity, scope)
    }

    override val mainActivity: Class<out android.app.Activity> = DriverActivity::class.java

    override val notificationIcon: Int = R.drawable.ic_launcher_foreground

    /** Who is signed in, and the credential that keeps them signed in. */
    val account: DriverAccountStore by lazy { DriverAccountStore(this) }

    /** Saarthi, spoken to as a person: sign-in, scanning, approval. */
    val driverApi: DriverApi by lazy { DriverApi(settings.apiUrl, account) }

    /**
     * Saarthi Quick Login: the PIN and biometric vault.
     *
     * Phone only. A fitted tablet is shared between drivers and holds a device
     * credential rather than a person's session, so there is nothing there for a
     * fingerprint to unlock.
     */
    val quickLogin: QuickLoginStore by lazy { QuickLoginStore(this) }

    /**
     * Somewhere a driver was sent, waiting to be acted on.
     *
     * Held on the application rather than in the activity because a share can
     * land while the driver is still signing in or waiting for their fleet to
     * approve them — and a destination dropped because the app was not ready is
     * a destination the driver has to go and find in another app.
     */
    val sharedDestinations = SharedDestinationInbox()

    /**
     * The driver's papers, held on this phone for a checkpoint with no signal.
     *
     * Present here and null on the tablet, which is the whole distinction: a
     * document wallet is something a person carries and produces on demand, and
     * a tablet bolted to a lorry is shared between drivers. A licence cached on
     * one would belong to whoever drove last.
     */
    override val papers: PaperCache by lazy { PaperCache(this, repository.api) }

    /**
     * The map kept for where there is no signal.
     *
     * On the application rather than a screen: a download runs for minutes and
     * must survive the driver moving between the cockpit and the dashboard.
     */
    val offlineMaps: OfflineMaps by lazy { OfflineMaps(this) }

    override fun onCreate() {
        super.onCreate()

        /*
         * Where a rotated refresh token goes while Quick Login holds it.
         *
         * The server rotates the refresh token on every single use, so this
         * fires constantly — and until it existed, each rotation was written
         * back into readable preferences while the Keystore kept the copy from
         * enrolment. That copy was dead the moment it was first used, so the
         * next fingerprint unlock replayed it and the driver was told their
         * session had expired. Re-sealing keeps the sealed copy current and
         * keeps it the only copy.
         */
        account.custodian = { rotated -> quickLogin.reseal(rotated) }

        /*
         * The shared code's view of which app it is inside.
         *
         * Simulation is off in every build type here, unlike the tablet. A
         * driver's phone is only ever in a real cab, and a fabricated reading
         * reaching a fleet's records from a driver's own handset is precisely
         * what section 19 forbids.
         */
        CoreConfig.initialise(
            host = CoreConfig.Host.DRIVER,
            // The release pipeline keys on this, so it must be the real
            // package rather than a constant that could drift from it.
            applicationId = BuildConfig.APPLICATION_ID,
            versionName = BuildConfig.VERSION_NAME,
            versionCode = BuildConfig.VERSION_CODE,
            defaultApiUrl = BuildConfig.SAARTHI_API_URL,
            mapStyleUrl = BuildConfig.MAP_STYLE_URL,
            debug = BuildConfig.DEBUG,
            // No admin gate and no diagnostics screen exist in this app, so
            // there is nowhere for developer tools to be reached from.
            developerTools = false,
            allowSimulation = BuildConfig.ALLOW_SIMULATION,
        )

        /*
         * MapLibre wants initialising before any map view is inflated.
         *
         * Missed when this app was written: the terminal does it and the driver
         * app did not, so the cockpit's first map would have thrown. The empty
         * API key is correct and not an oversight — OpenFreeMap needs no
         * registration, which is why the web app uses it too.
         */
        MapLibre.getInstance(this)

        createNotificationChannel()

        DebugLog.info(
            "app",
            "Saarthi Driver ${BuildConfig.VERSION_NAME} starting against ${settings.apiUrl}",
        )
    }

    /**
     * The channel the reporting service posts to.
     *
     * Created before any service can start. A foreground service posting to a
     * channel that does not exist is a crash on Android 14, not a missing
     * notification.
     */
    private fun createNotificationChannel() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            SaarthiApp.SERVICE_CHANNEL_ID,
            getString(R.string.service_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.service_channel_description)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }
}
