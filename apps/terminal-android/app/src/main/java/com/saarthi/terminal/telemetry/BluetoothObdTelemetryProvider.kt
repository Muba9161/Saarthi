package com.saarthi.terminal.telemetry

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.saarthi.terminal.util.DebugLog
import com.saarthi.terminal.util.DeviceEnvironment
import java.io.IOException
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The vehicle's ECU, over a Bluetooth OBD adapter.
 *
 * Bluetooth Classic, on the serial port profile — which is what an ELM327 and
 * every clone of it speaks. The protocol itself lives in [ObdSession]; this
 * file owns the radio, the socket and the polling loop, and nothing else.
 *
 * This was a documented stub until an adapter existed to test against, and the
 * abstraction it was written behind did its job: nothing above this file changed
 * when it became real. Not the gauges, not the checklist rules, not the frames
 * posted to Saarthi. The values simply started arriving stamped
 * [MetricSource.OBD] instead of never arriving at all.
 *
 * Three things it is careful about, each because of how this fails in a yard:
 *
 * **Connecting is not the same as reading.** An adapter answers happily with the
 * ignition off while the ECU is asleep, returning nothing for every PID. That is
 * reported as connected-with-no-data rather than as a fault, because the fix is
 * to turn the key rather than to replace the adapter.
 *
 * **A dropped link reconnects on its own.** The adapter loses power with the
 * ignition on some vehicles, and a driver cannot be asked to go into a settings
 * screen mid-shift. The loop backs off and retries.
 *
 * **What the vehicle does not answer is absent, never zero.** Section 18, and
 * the reason [ObdSession] asks the ECU which PIDs it supports before polling
 * anything.
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
        Metric.INTAKE_TEMPERATURE,
        Metric.FUEL_LEVEL,
        Metric.FUEL_RATE,
        Metric.THROTTLE_POSITION,
        Metric.BATTERY_VOLTAGE,
        Metric.ODOMETER,
        Metric.DTC,
    )

    /**
     * The VIN the vehicle reported, if it answered mode 09.
     *
     * Read once per connection and held, because it cannot change while the
     * adapter is plugged in. Surfaced so a fleet can check that the truck this
     * terminal is bolted to is the truck Saarthi has on file.
     */
    private val _vin = MutableStateFlow<String?>(null)
    val vin: StateFlow<String?> = _vin.asStateFlow()

    /** What the vehicle said it answers. For diagnostics — see [ObdSession]. */
    private val _supportedPids = MutableStateFlow<List<String>>(emptyList())
    val supportedPids: StateFlow<List<String>> = _supportedPids.asStateFlow()

    private val _status = MutableStateFlow(ProviderStatus.NOT_CONNECTED)
    override val status: StateFlow<ProviderStatus> = _status.asStateFlow()

    private val _pairedAdapters = MutableStateFlow<List<ObdCandidate>>(emptyList())

    /** Bonded devices whose name looks like an OBD adapter. For the admin screen. */
    val pairedAdapters: StateFlow<List<ObdCandidate>> = _pairedAdapters.asStateFlow()

    private val _connectedTo = MutableStateFlow<ObdCandidate?>(null)
    val connectedTo: StateFlow<ObdCandidate?> = _connectedTo.asStateFlow()

    data class ObdCandidate(val address: String, val name: String)

    /** The last sample, replaced whole so a reader never sees a half-updated set. */
    private val latest = AtomicReference<Map<Metric, MetricValue>>(emptyMap())
    private val faults = AtomicReference<List<DiagnosticCode>>(emptyList())

    private var socket: BluetoothSocket? = null
    private var pump: Job? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * The adapter to reconnect to without being asked.
     *
     * Set by [connect]. A terminal that had to be told which adapter to use
     * after every ignition cycle would be a terminal nobody uses.
     */
    var preferredAddress: String? = null

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
                _status.value = ProviderStatus.NOT_CONNECTED

                /*
                 * Reconnect to a known adapter without being asked.
                 *
                 * The remembered one first, then the only bonded candidate if
                 * there is exactly one — which is the case in every cab. More
                 * than one and the choice is the installer's, because guessing
                 * between two adapters is how a terminal ends up reading the
                 * van parked next to it.
                 */
                val candidates = _pairedAdapters.value
                val target = candidates.firstOrNull { it.address == preferredAddress }
                    ?: candidates.singleOrNull()
                if (target != null) scope.launch { connect(target) }
            }
        }
    }

    override suspend fun stop() {
        pump?.cancel()
        pump = null
        closeSocket()
        latest.set(emptyMap())
        faults.set(emptyList())
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
     * Open a serial link to an adapter and start polling it.
     *
     * Discovery is cancelled first — a scanning radio and an outbound RFCOMM
     * connection contend for the same hardware, and the connection is the one
     * that loses. This is the single most common reason a pairing that worked
     * yesterday fails today.
     */
    suspend fun connect(candidate: ObdCandidate): Boolean = withContext(Dispatchers.IO) {
        if (!hasBluetoothPermission()) {
            _status.value = ProviderStatus.PERMISSION_DENIED
            return@withContext false
        }
        val adapter = bluetoothAdapter ?: return@withContext false

        pump?.cancel()
        closeSocket()
        preferredAddress = candidate.address
        _status.value = ProviderStatus.STARTING

        val opened = try {
            @Suppress("MissingPermission") // Checked above.
            adapter.cancelDiscovery()

            val device = adapter.getRemoteDevice(candidate.address)
            @Suppress("MissingPermission")
            val created = device.createRfcommSocketToServiceRecord(SPP_UUID)
            created.connect()
            created
        } catch (error: IOException) {
            DebugLog.warn("obd", "Could not open ${candidate.name}: ${error.message}")
            _status.value = ProviderStatus.NOT_CONNECTED
            return@withContext false
        } catch (error: SecurityException) {
            DebugLog.warn("obd", "Bluetooth refused: ${error.message}")
            _status.value = ProviderStatus.PERMISSION_DENIED
            return@withContext false
        }

        val session = try {
            ObdSession(opened.inputStream, opened.outputStream)
        } catch (error: IOException) {
            DebugLog.warn("obd", "No streams on ${candidate.name}: ${error.message}")
            runCatching { opened.close() }
            _status.value = ProviderStatus.NOT_CONNECTED
            return@withContext false
        }

        if (!session.initialise()) {
            DebugLog.warn("obd", "${candidate.name} did not answer as an ELM327")
            runCatching { opened.close() }
            _status.value = ProviderStatus.NOT_CONNECTED
            return@withContext false
        }

        socket = opened
        _connectedTo.value = candidate
        // Once per connection. Neither can change while the adapter is in.
        _vin.value = session.readVin()
        _supportedPids.value = session.supportedPids
        // Connected, but the engine may still be asleep. `hasVehicle` is what
        // separates "adapter present" from "ECU answering".
        _status.value = if (session.hasVehicle) ProviderStatus.RUNNING else ProviderStatus.DEGRADED
        DebugLog.info("obd", "Connected to ${candidate.name}")

        pump = scope.launch { poll(session, candidate) }
        true
    }

    /**
     * Read the vehicle until the link drops.
     *
     * One pass a second. Faster buys nothing — an ELM327 serialises requests
     * over a slow serial link, and a truck's coolant temperature does not change
     * between ticks — while a slower loop makes the speed readout visibly lag
     * the road.
     *
     * Fault codes are read far less often. Mode 03 is slow, it is the one call
     * that can stall a cheap adapter for a second, and a stored code that
     * appeared thirty seconds ago is news just as fresh.
     */
    private suspend fun poll(session: ObdSession, candidate: ObdCandidate) {
        var tick = 0L
        while (currentCoroutineContext().isActive) {
            val now = System.currentTimeMillis()
            val values = try {
                session.readAll(now)
            } catch (error: IOException) {
                DebugLog.warn("obd", "Link to ${candidate.name} dropped: ${error.message}")
                break
            }

            latest.set(values)
            // Connected but silent is a real state: the ignition is off, or the
            // adapter is in a socket whose ECU has gone to sleep.
            _status.value = if (values.isEmpty()) ProviderStatus.DEGRADED else ProviderStatus.RUNNING

            if (tick % FAULT_SCAN_TICKS == 0L) {
                faults.set(
                    session.readFaultCodes().map { code ->
                        DiagnosticCode(code = code, description = null, source = MetricSource.OBD)
                    },
                )
            }

            tick += 1
            delay(POLL_INTERVAL_MS)
        }

        closeSocket()
        latest.set(emptyMap())
        _vin.value = null
        _supportedPids.value = emptyList()
        _connectedTo.value = null
        _status.value = ProviderStatus.NOT_CONNECTED

        /*
         * Reconnect on its own.
         *
         * Adapters lose power when the ignition is cycled, and some clones drop
         * the link after a few minutes of quiet. A driver mid-shift cannot be
         * asked to go and find a settings screen, so the loop comes back by
         * itself — after a pause, so a genuinely absent adapter is not hammered
         * for the rest of the day.
         */
        if (scope.isActive) {
            delay(RECONNECT_DELAY_MS)
            if (scope.isActive) connect(candidate)
        }
    }

    private fun closeSocket() {
        runCatching { socket?.close() }
        socket = null
    }

    /**
     * What the vehicle answered on the last pass.
     *
     * An empty map is the honest answer when nothing is connected or the ECU is
     * asleep, and it is exactly what the rest of the app is built to handle: the
     * cockpit shows "not reported", and the checklist falls back to a manual
     * inspection instead of inventing a verdict.
     */
    override fun sample(): Map<Metric, MetricValue> = latest.get()

    fun diagnostics(): List<DiagnosticCode> = faults.get()

    private companion object {
        val OBD_NAME_HINTS = listOf("OBD", "ELM", "VGATE", "VEEPEAK", "KONNWEI", "OBDII")

        /** The serial port profile. Every ELM327 and clone exposes exactly this. */
        val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

        /** One pass a second: faster than the values change, slower than the road. */
        const val POLL_INTERVAL_MS = 1_000L

        /** Fault codes every thirty passes. Mode 03 is slow and rarely changes. */
        const val FAULT_SCAN_TICKS = 30L

        /** Long enough that an absent adapter is not retried all day. */
        const val RECONNECT_DELAY_MS = 15_000L
    }
}
