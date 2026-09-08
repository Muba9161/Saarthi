package com.saarthi.core

/**
 * What the shared code needs to know about the app it is running inside.
 *
 * `:core` is a library, and a library has no `BuildConfig` of the app that
 * consumes it — `com.saarthi.terminal.BuildConfig` simply does not exist from
 * in here. Rather than give the library its own build fields and then have to
 * keep two sets of them in step, each app fills this in once at startup and the
 * shared code reads it.
 *
 * That turns out to be the better shape anyway. The fitted tablet and the
 * driver's phone genuinely differ on three of these — the tablet may simulate
 * telemetry in a debug build and expose developer tools, and a phone never
 * should — and a build constant could not have expressed that difference at
 * all.
 *
 * Every field has a safe default, so shared code that runs before
 * [initialise] — a unit test, a Compose preview — behaves like the most
 * restricted app rather than crashing.
 */
object CoreConfig {

    /** Which product is hosting the shared code. */
    enum class Host {
        /** A tablet fitted to a vehicle. Kiosk, admin gate, pairing codes. */
        TERMINAL,

        /** A driver's own phone. Signs in as a person, no hardware to manage. */
        DRIVER,
    }

    var host: Host = Host.TERMINAL
        private set

    /** The app's own version name, sent on every heartbeat. */
    var versionName: String = "0.0.0"
        private set

    /**
     * The app's version code.
     *
     * The only number the update pipeline compares, so it has to be the *app's*
     * and not the library's.
     */
    var versionCode: Int = 0
        private set

    /** Where this build points when nothing has been configured on the device. */
    var defaultApiUrl: String = "https://api.vorldxsaarthi.com"
        private set

    /** The basemap style the cockpit renders. */
    var mapStyleUrl: String = "https://tiles.openfreemap.org/styles/liberty"
        private set

    /**
     * This app's package name.
     *
     * Sent with every update check, because the server cannot otherwise tell
     * which of the two Saarthi apps is asking — a fitted tablet and a driver's
     * phone authenticate as the same kind of device. A phone offered the
     * tablet's build would replace its own sign-in with a kiosk.
     */
    var applicationId: String = "com.saarthi.terminal"
        private set

    /** A debuggable build. Only ever widens logging, never behaviour. */
    var debug: Boolean = false
        private set

    /**
     * Whether the developer tools exist in this build at all.
     *
     * Section 49 requires the telemetry simulator be unreachable from driver
     * mode. On the tablet that is enforced by build type; on a driver's phone it
     * is false in every build, because there is no screen from which to reach it.
     */
    var developerTools: Boolean = false
        private set

    /**
     * Whether simulated telemetry may ever be produced.
     *
     * Separate from [developerTools] on purpose: a build could plausibly want
     * the diagnostics screen without the simulator, and section 19's rule that a
     * fabricated reading must never present as measured is worth two switches.
     */
    var allowSimulation: Boolean = false
        private set

    /**
     * Called once, from the app's `Application.onCreate`.
     *
     * Idempotent rather than fatal on a second call: a test that initialises
     * twice is a nuisance, not a bug worth crashing a truck's screen for.
     */
    fun initialise(
        host: Host,
        applicationId: String,
        versionName: String,
        versionCode: Int,
        defaultApiUrl: String,
        mapStyleUrl: String,
        debug: Boolean,
        developerTools: Boolean,
        allowSimulation: Boolean,
    ) {
        this.host = host
        this.applicationId = applicationId
        this.versionName = versionName
        this.versionCode = versionCode
        this.defaultApiUrl = defaultApiUrl
        this.mapStyleUrl = mapStyleUrl
        this.debug = debug
        this.developerTools = developerTools
        this.allowSimulation = allowSimulation
    }
}
