package com.saarthi.terminal.telemetry

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.saarthi.terminal.util.DebugLog
import com.saarthi.terminal.util.DeviceEnvironment
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The vehicle's ECU, over a Bluetooth OBD adapter.
 *
 * The adapter has been ordered and has not arrived. This provider is therefore
 * **real and registered but produces nothing**: it discovers adapters, reports
 * its own state honestly, and returns an empty sample. That is deliberate, and
 * it is the whole reason the [TelemetryProvider] abstraction exists.
 *
 * What it buys, today, before any hardware is in the building:
 *
 *  * The cockpit, the checklist and the assistant are already written against a
 *    provider that reports NOT_CONNECTED and contributes no metrics — which is
 *    exactly what a real generic adapter does for most of the values a truck's
 *    ECU knows. Section 18: never claim a generic adapter provides a parameter
 *    when it does not.
 *  * The admin screen already has a Bluetooth diagnostics surface (section 46),
 *    so an installer can see whether the tablet's radio works before the adapter
 *    is even fitted.
 *  * The permission model — which differs sharply either side of Android 12 — is
 *    already declared, requested and handled. Discovering that on the day the
 *    hardware lands is how a delivery slips a week.
 *
 * When the adapter arrives, [connect] gains an RFCOMM socket and an ELM327
 * command loop, [sample] starts returning values stamped [MetricSource.OBD],
 * and nothing above this file changes — not the gauges, not the checklist
 * rules, not the frames posted to Saarthi. That is the test of whether the
 * abstraction was worth having.
 */
class BluetoothObdTelemetryProvider(
    private val context: Context,
) : TelemetryProvider {

    override val id = "obd"
    override val label = "Bluetooth OBD adapter"

    /**
     * What an ELM327-class adapter can genuinely read on a typical vehicle.
     *
     * Declared as capability, not as promise. `sample()` returns only what was
     * actually read: a specific truck may expose none of these, and reporting a
     * metric because the adapter *could* read it on some other vehicle is the
     * failure section 18 names.
     */
    override val supportedMetrics = setOf(
        Metric.RPM,
        Metric.SPEED,
        Metric.ENGINE_LOAD,
        Metric.COOLANT_TEMPERATURE,
        Metric.FUEL_LEVEL,
        Metric.THROTTLE_POSITION,
        Metric.BATTERY_VOLTAGE,
        Metric.DTC,
    )

    private val _status = MutableStateFlow(ProviderStatus.NOT_CONNECTED)
    override val status: StateFlow<ProviderStatus> = _status.asStateFlow()

    private val _pairedAdapters = MutableStateFlow<List<ObdCandidate>>(emptyList())

    /** Bonded devices whose name looks like an OBD adapter. For the admin screen. */
    val pairedAdapters: StateFlow<List<ObdCandidate>> = _pairedAdapters.asStateFlow()

    private val _connectedTo = MutableStateFlow<ObdCandidate?>(null)
    val connectedTo: StateFlow<ObdCandidate?> = _connectedTo.asStateFlow()

    data class ObdCandidate(val address: String, val name: String)

    private val bluetoothAdapter: BluetoothAdapter?
        get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    /** True when the platform will let this app touch Bluetooth at all. */
    fun hasBluetoothPermission(): Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        DeviceEnvironment.hasPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT)
    } else {
        // Below Android 12 the permissions are install-time and always granted.
        true
    }

    override suspend fun start() {
        val adapter = bluetoothAdapter
        when {
            !context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH) ||
                adapter == null -> {
                _status.value = ProviderStatus.UNAVAILABLE
                DebugLog.info("obd", "This device has no Bluetooth radio")
            }

            !hasBluetoothPermission() -> {
                _status.value = ProviderStatus.PERMISSION_DENIED
                DebugLog.info("obd", "Bluetooth permission not granted")
            }

            !adapter.isEnabled -> {
                // Not an error. The installer has not switched Bluetooth on yet,
                // and there is no adapter plugged into the vehicle either.
                _status.value = ProviderStatus.NOT_CONNECTED
                refreshPairedAdapters()
            }

            else -> {
                refreshPairedAdapters()
                // No adapter has been fitted, so there is nothing to connect to.
                // This is the resting state, not a failure, and the UI is
                // written to treat it as such.
                _status.value = ProviderStatus.NOT_CONNECTED
            }
        }
    }

    override suspend fun stop() {
        _connectedTo.value = null
        _status.value = ProviderStatus.STOPPED
    }

    /**
     * Bonded devices that look like an OBD adapter.
     *
     * Filtered by name because that is all a bonded-device list offers before a
     * connection, and every adapter on the market announces itself as one of a
     * handful of strings. Shown on the admin screen so an installer can confirm
     * the pairing worked before wondering why no data arrives.
     */
    fun refreshPairedAdapters() {
        if (!hasBluetoothPermission()) {
            _pairedAdapters.value = emptyList()
            return
        }
        val adapter = bluetoothAdapter ?: return
        _pairedAdapters.value = try {
            @Suppress("MissingPermission") // Checked immediately above.
            adapter.bondedDevices.orEmpty()
                .filter { looksLikeObd(it) }
                .map { ObdCandidate(it.address, it.name ?: it.address) }
        } catch (error: SecurityException) {
            DebugLog.warn("obd", "Bonded device list refused: ${error.message}")
            emptyList()
        }
    }

    private fun looksLikeObd(device: BluetoothDevice): Boolean {
        val name = try {
            @Suppress("MissingPermission")
            device.name.orEmpty().uppercase()
        } catch (_: SecurityException) {
            return false
        }
        return OBD_NAME_HINTS.any { name.contains(it) }
    }

    /**
     * Connect to an adapter.
     *
     * Not implemented, because there is no adapter to test against and a
     * plausible-looking ELM327 loop that nobody has ever run against real
     * hardware is worse than an honest gap: it would look finished, and the
     * first person to plug in an adapter would be debugging somebody's guesses.
     *
     * What goes here when the hardware lands: an RFCOMM socket on the
     * well-known serial UUID, `ATZ`/`ATE0`/`ATSP0` initialisation, a supported-PID
     * probe via `0100`/`0120`/`0140`, and a polling loop that requests only the
     * PIDs that probe reported. That last part is the one this abstraction is
     * protecting — `supportedMetrics` above is what an adapter *can* read, and
     * `sample()` must return only what a given vehicle actually answered.
     */
    @Suppress("UnusedParameter")
    suspend fun connect(candidate: ObdCandidate): Boolean {
        DebugLog.info(
            "obd",
            "Connect requested for ${candidate.name} — no OBD adapter is fitted yet",
        )
        _status.value = ProviderStatus.NOT_CONNECTED
        return false
    }

    /**
     * Nothing, until an adapter is connected.
     *
     * An empty map is the honest answer, and it is exactly what the rest of the
     * app is built to handle: the cockpit shows "not reported", and the
     * checklist falls back to a manual inspection instead of inventing a
     * verdict.
     */
    override fun sample(): Map<Metric, MetricValue> = emptyMap()

    fun diagnostics(): List<DiagnosticCode> = emptyList()

    private companion object {
        val OBD_NAME_HINTS = listOf("OBD", "ELM", "VGATE", "VEEPEAK", "KONNWEI", "OBDII")
    }
}
