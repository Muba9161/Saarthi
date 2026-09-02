package com.saarthi.terminal.data

import android.content.Context
import com.saarthi.terminal.BuildConfig
import com.saarthi.terminal.telemetry.SimulatedTelemetryProvider

/**
 * Settings the installer owns.
 *
 * A short list on purpose. Almost everything about how a terminal behaves —
 * reporting interval, whether simulation is permitted, whether video is enabled
 * — is decided by Saarthi and pushed down, because a fleet that cannot slow a
 * tablet down when the data bill arrives does not really own its own hardware.
 *
 * What is left here is what only the person standing at the vehicle can know:
 * which server this unit talks to, and which developer scenario a *debug* build
 * should run.
 */
class TerminalSettings(context: Context) {

    private val preferences =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /**
     * The Saarthi base URL.
     *
     * Defaults to whatever the build was compiled with. Overridable from the
     * admin screen because a terminal is fitted before anybody knows which
     * environment it will point at, and reflashing a tablet in a yard to change
     * a hostname is not a workflow.
     */
    var apiUrl: String
        get() = preferences.getString(KEY_API_URL, null) ?: BuildConfig.SAARTHI_API_URL
        set(value) = preferences.edit().putString(KEY_API_URL, value.trim().trimEnd('/')).apply()

    fun resetApiUrl() {
        preferences.edit().remove(KEY_API_URL).apply()
    }

    /**
     * Which simulator scenario a debug build runs.
     *
     * Meaningless in a release build: `ALLOW_SIMULATION` is false there and the
     * simulator refuses to start whatever this says, so a value left behind by a
     * debug install cannot follow a tablet into production.
     */
    var simulationScenario: SimulatedTelemetryProvider.Scenario
        get() = runCatching {
            SimulatedTelemetryProvider.Scenario.valueOf(
                preferences.getString(KEY_SCENARIO, null)
                    ?: SimulatedTelemetryProvider.Scenario.NORMAL.name,
            )
        }.getOrDefault(SimulatedTelemetryProvider.Scenario.NORMAL)
        set(value) = preferences.edit().putString(KEY_SCENARIO, value.name).apply()

    /**
     * Whether the driver has asked for less movement on screen.
     *
     * An accessibility setting rather than a preference (section 60). Honoured
     * by the AI blob, the state transitions and the map camera.
     */
    var reducedMotion: Boolean
        get() = preferences.getBoolean(KEY_REDUCED_MOTION, false)
        set(value) = preferences.edit().putBoolean(KEY_REDUCED_MOTION, value).apply()

    /**
     * Whether the cockpit is drawn dark.
     *
     * Off by default, so the terminal opens light. The earlier default was the
     * system setting, which meant a phone left in dark mode showed a driver a
     * near-black cockpit in daylight — unreadable through a windscreen, and not
     * a choice anybody had made about *this* screen.
     *
     * It stays available because the reason for it is real: a white screen at
     * 3 a.m. on a highway costs a driver their night vision for the next minute.
     * That is a decision for the person in the cab, so it is a switch rather
     * than an inference.
     */
    var darkTheme: Boolean
        get() = preferences.getBoolean(KEY_DARK_THEME, false)
        set(value) = preferences.edit().putBoolean(KEY_DARK_THEME, value).apply()

    /**
     * Whether the wake phrase is listened for.
     *
     * Off by default. Continuous listening costs battery and, more importantly,
     * is a microphone left on in a space where people have private conversations
     * — so it is something the fleet turns on deliberately rather than something
     * that starts on its own.
     */
    var wakeWordEnabled: Boolean
        get() = preferences.getBoolean(KEY_WAKE_WORD, false)
        set(value) = preferences.edit().putBoolean(KEY_WAKE_WORD, value).apply()

    /** Lock-task mode, when this app is the device owner (section 45). */
    var kioskEnabled: Boolean
        get() = preferences.getBoolean(KEY_KIOSK, false)
        set(value) = preferences.edit().putBoolean(KEY_KIOSK, value).apply()

    /**
     * The admin PIN, hashed.
     *
     * Section 46: admin functionality must not be reachable by an ordinary
     * driver. A four-digit PIN is not a security boundary against a determined
     * attacker with the tablet in their hands — the server's authorisation is —
     * but it is the difference between a driver wandering into diagnostics and
     * a driver not.
     */
    var adminPinHash: String?
        get() = preferences.getString(KEY_ADMIN_PIN, null)
        set(value) = preferences.edit().putString(KEY_ADMIN_PIN, value).apply()

    val hasAdminPin: Boolean get() = !adminPinHash.isNullOrBlank()

    private companion object {
        const val FILE = "saarthi_terminal_settings"
        const val KEY_API_URL = "api_url"
        const val KEY_SCENARIO = "simulation_scenario"
        const val KEY_DARK_THEME = "dark_theme"
        const val KEY_REDUCED_MOTION = "reduced_motion"
        const val KEY_WAKE_WORD = "wake_word"
        const val KEY_KIOSK = "kiosk"
        const val KEY_ADMIN_PIN = "admin_pin"
    }
}
