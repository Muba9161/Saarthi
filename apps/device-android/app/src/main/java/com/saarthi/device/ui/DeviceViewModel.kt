package com.saarthi.device.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.saarthi.device.SaarthiDeviceApp
import com.saarthi.device.data.DeviceRepository
import com.saarthi.device.domain.TelemetrySimulator
import com.saarthi.device.network.SosRequest
import com.saarthi.device.service.TelemetryService
import com.saarthi.device.video.VideoPublisher
import com.saarthi.device.util.DeviceEnvironment
import com.saarthi.device.util.isoNow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * What the screens read and write.
 *
 * Thin on purpose: the repository owns the state, and this exists to expose it
 * to Compose, to run the handful of actions a person can take, and to keep the
 * check results the Test Center needs.
 */
class DeviceViewModel(application: Application) : AndroidViewModel(application) {

    private val repository: DeviceRepository = SaarthiDeviceApp.repository(application)

    val state: StateFlow<DeviceRepository.DeviceState> = repository.state
    val settings get() = repository.settings
    val isEnrolled get() = repository.isEnrolled

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    private val _serviceRunning = MutableStateFlow(false)
    val serviceRunning: StateFlow<Boolean> = _serviceRunning.asStateFlow()

    /**
     * The camera pipeline, read straight from the publisher.
     *
     * Not a copy held here: the service starts and stops streaming, so a
     * view model that kept its own idea of the state would be wrong every
     * time a dashboard command started the camera without the app open.
     */
    val publisher: StateFlow<VideoPublisher.State> =
        VideoPublisher.get(application).state

    /** Where this device is pointed, for the settings screen. */
    val apiBaseUrl: String get() = repository.apiBaseUrl

    fun clearMessage() {
        _message.value = null
    }

    fun refresh() {
        viewModelScope.launch {
            repository.refreshBufferCount()
            if (repository.isEnrolled) repository.refresh()
        }
    }

    // -----------------------------------------------------------------------
    // Identity and pairing
    // -----------------------------------------------------------------------

    /*
     * There is deliberately no `enrol()` here.
     *
     * Enrolment cannot be a step of its own on a device that has never been
     * paired: it has to reach an API, and the address of that API arrives in the
     * pairing QR. An enrol button could only ever post to the build-time
     * default, which is the emulator's host alias and unreachable from a real
     * handset.
     *
     * `DeviceRepository.pair` therefore does both, in the only order that works
     * — take the address from the code, then enrol against it — and the welcome
     * screen goes straight to the scanner.
     */

    /**
     * Handle a scanned code.
     *
     * Returns false for anything that is not a Saarthi pairing code so the
     * scanner can keep looking rather than reporting a failure — a camera
     * pointed at a shelf sees a lot of barcodes.
     */
    fun onQrScanned(raw: String, onPaired: () -> Unit) {
        val payload = repository.parsePairingQr(raw) ?: return
        if (_busy.value) return

        viewModelScope.launch {
            _busy.value = true
            val result = repository.pair(payload)
            _busy.value = false
            result
                .onSuccess {
                    _message.value = "Paired to ${it.vehicle?.registrationNumber ?: "the vehicle"}."
                    onPaired()
                }
                .onFailure { _message.value = it.message }
        }
    }

    fun unpair() {
        viewModelScope.launch {
            _busy.value = true
            stopTracking()
            repository.unpair("Unpaired from the device.")
                .onSuccess { _message.value = "Device unpaired." }
                .onFailure { _message.value = it.message }
            _busy.value = false
        }
    }

    /** Forget everything. The phone is going to somebody else. */
    fun resetDevice() {
        stopTracking()
        repository.reset()
        _message.value = "This device has been reset."
    }

    // -----------------------------------------------------------------------
    // Tracking
    // -----------------------------------------------------------------------

    fun startTracking() {
        TelemetryService.start(getApplication())
        _serviceRunning.value = true
    }

    fun stopTracking() {
        TelemetryService.stop(getApplication())
        _serviceRunning.value = false
    }

    fun setSimulationMode(mode: TelemetrySimulator.Mode) {
        settings.simulationMode = mode
        _message.value = if (mode == TelemetrySimulator.Mode.OFF) {
            "Simulated engine data switched off."
        } else {
            "Simulating: ${mode.label}. Every value is sent marked as simulated."
        }
    }

    fun setReportingInterval(seconds: Int) {
        settings.reportingIntervalSeconds = seconds
        // Restarting is what actually applies it: the location request is built
        // with the interval baked in, so changing the stored value alone would
        // do nothing until the next reboot.
        if (_serviceRunning.value) {
            stopTracking()
            startTracking()
        }
        _message.value = "Reporting every ${seconds}s. Saarthi may override this."
    }

    fun flushNow() {
        viewModelScope.launch {
            _busy.value = true
            val uploaded = repository.flush()
            _busy.value = false
            _message.value = when {
                uploaded == null -> "Could not reach Saarthi. Events are still buffered."
                uploaded == 0 -> "Nothing waiting to upload."
                else -> "Uploaded $uploaded event(s)."
            }
        }
    }

    // -----------------------------------------------------------------------
    // SOS
    // -----------------------------------------------------------------------

    /**
     * Raise an emergency.
     *
     * The last known position is used when there is no current fix, and the app
     * says which it sent. An SOS with a stale position is far better than an SOS
     * refused for want of a fresh one — but the responder needs to know.
     */
    fun raiseSos(type: String, description: String?, onDone: (String?) -> Unit) {
        val fix = repository.lastKnownFix
        if (fix == null) {
            _message.value =
                "Saarthi has no position for this phone yet. Start the device first so an alert can say where you are."
            onDone(null)
            return
        }

        viewModelScope.launch {
            _busy.value = true
            val battery = DeviceEnvironment.battery(getApplication())
            val result = repository.raiseSos(
                SosRequest(
                    eventId = repository.newEventId(),
                    type = type,
                    latitude = fix.latitude,
                    longitude = fix.longitude,
                    speedKph = fix.speedKph,
                    heading = fix.heading,
                    accuracy = fix.accuracy,
                    description = description,
                    cameraAvailable =
                        DeviceEnvironment.cameraStatus(getApplication()) == DeviceEnvironment.Status.OK,
                    networkType = DeviceEnvironment.networkType(getApplication()),
                    batteryPercent = battery.percent,
                    triggeredAt = isoNow(),
                ),
            )
            _busy.value = false
            result
                .onSuccess {
                    _message.value = "Emergency raised — ${it.reference}. Saarthi is alerting your fleet."
                    onDone(it.reference)
                }
                .onFailure {
                    _message.value = it.message
                    onDone(null)
                }
        }
    }

    // -----------------------------------------------------------------------
    // Live video
    // -----------------------------------------------------------------------

    /**
     * Start streaming.
     *
     * Handed to the service rather than done here. The service holds the
     * camera foreground-service type Android 14 requires, and it outlives this
     * view model — so a stream survives the screen being closed, which is the
     * only behaviour that makes sense for a device fitted to a vehicle.
     */
    fun startPublishing() {
        if (!settings.videoEnabled) {
            _message.value =
                "Saarthi has no video gateway on this environment, so there is nowhere to publish."
            return
        }
        TelemetryService.startCamera(getApplication(), settings.cameraChannel)
    }

    fun stopPublishing() {
        TelemetryService.stopCamera(getApplication())
    }

    /**
     * Switch lens.
     *
     * Restarts the stream when one is running, because the channel is part of
     * the ticket: Saarthi authorises a specific camera, and quietly sending a
     * different one would put the cabin on a session somebody opened for the
     * road.
     */
    fun setCameraChannel(channel: Int) {
        settings.cameraChannel = channel
        if (publisher.value.capturing) {
            TelemetryService.startCamera(getApplication(), channel)
        }
    }
}
