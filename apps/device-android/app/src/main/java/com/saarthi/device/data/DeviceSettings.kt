package com.saarthi.device.data

import android.content.Context
import com.saarthi.device.BuildConfig
import com.saarthi.device.domain.TelemetrySimulator
import com.saarthi.device.network.DeviceConfigDto

/**
 * Settings a tester can change, and settings only Saarthi can.
 *
 * The split is the point of this class. Camera quality and which simulation
 * profile to run are the tester's business. The reporting interval is not — an
 * operator has to be able to slow a phone down from the dashboard when the data
 * bill arrives, and a device that could override that would make the control
 * decorative. So the interval lives here but is written by the server, and the
 * UI presents it as a request rather than a switch.
 *
 * Ordinary preferences, not encrypted ones: nothing here is a credential, and
 * `DeviceIdentityStore` is where anything that is goes.
 */
class DeviceSettings(context: Context) {

    private val prefs = context.getSharedPreferences("saarthi_device_settings", Context.MODE_PRIVATE)

    /**
     * How often to report, in seconds.
     *
     * Server-owned. Written by the pairing response and re-confirmed on every
     * heartbeat, so a change made in the dashboard reaches the device within one
     * beat whether or not the app asks for it.
     */
    var reportingIntervalSeconds: Int
        get() = prefs.getInt(KEY_INTERVAL, DEFAULT_INTERVAL)
        set(value) = prefs.edit().putInt(KEY_INTERVAL, value.coerceIn(1, 300)).apply()

    /**
     * Which invented engine profile to run.
     *
     * Forced off in release builds regardless of what is stored: fabricated
     * telemetry reaching a real fleet is a worse outcome than a test being
     * inconvenient, and a stored preference should not be able to survive into
     * a production install.
     */
    var simulationMode: TelemetrySimulator.Mode
        get() {
            if (!BuildConfig.ALLOW_SIMULATION) return TelemetrySimulator.Mode.OFF
            val stored = prefs.getString(KEY_SIMULATION, null) ?: return TelemetrySimulator.Mode.NORMAL
            return runCatching { TelemetrySimulator.Mode.valueOf(stored) }
                .getOrDefault(TelemetrySimulator.Mode.NORMAL)
        }
        set(value) = prefs.edit().putString(KEY_SIMULATION, value.name).apply()

    /** Whether the backend has anywhere for this device to publish video. */
    var videoEnabled: Boolean
        get() = prefs.getBoolean(KEY_VIDEO, false)
        set(value) = prefs.edit().putBoolean(KEY_VIDEO, value).apply()

    /** Whether this environment accepts simulated engine data at all. */
    var simulationAllowedByServer: Boolean
        get() = prefs.getBoolean(KEY_SIM_ALLOWED, true)
        set(value) = prefs.edit().putBoolean(KEY_SIM_ALLOWED, value).apply()

    /**
     * Which lens to publish.
     *
     * Channel 1 is the road-facing camera and channel 2 the cabin, matching the
     * two the backend registers at pairing. The road camera is the default
     * because a cabin camera points at a person and should be a deliberate act.
     */
    var cameraChannel: Int
        get() = prefs.getInt(KEY_CAMERA_CHANNEL, 1)
        set(value) = prefs.edit().putInt(KEY_CAMERA_CHANNEL, value).apply()

    /** Whether the service should come back up after a reboot. */
    var autoStart: Boolean
        get() = prefs.getBoolean(KEY_AUTOSTART, false)
        set(value) = prefs.edit().putBoolean(KEY_AUTOSTART, value).apply()

    /** Whether the service was running when it last stopped, for boot recovery. */
    var wasRunning: Boolean
        get() = prefs.getBoolean(KEY_WAS_RUNNING, false)
        set(value) = prefs.edit().putBoolean(KEY_WAS_RUNNING, value).apply()

    fun applyServerConfig(config: DeviceConfigDto) {
        reportingIntervalSeconds = config.reportingIntervalSeconds
        videoEnabled = config.videoEnabled
        simulationAllowedByServer = config.simulationAllowed
        if (!config.simulationAllowed) {
            simulationMode = TelemetrySimulator.Mode.OFF
        }
    }

    /** The mode actually in force, after both switches have had their say. */
    fun effectiveSimulationMode(): TelemetrySimulator.Mode =
        if (!BuildConfig.ALLOW_SIMULATION || !simulationAllowedByServer) {
            TelemetrySimulator.Mode.OFF
        } else {
            simulationMode
        }

    fun reset() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val KEY_INTERVAL = "reporting_interval_seconds"
        const val KEY_SIMULATION = "simulation_mode"
        const val KEY_VIDEO = "video_enabled"
        const val KEY_SIM_ALLOWED = "simulation_allowed"
        const val KEY_CAMERA_CHANNEL = "camera_channel"
        const val KEY_AUTOSTART = "auto_start"
        const val KEY_WAS_RUNNING = "was_running"

        /** Matches `DEFAULT_REPORTING_INTERVAL_SECONDS` in the shared contract. */
        const val DEFAULT_INTERVAL = 5
    }
}
