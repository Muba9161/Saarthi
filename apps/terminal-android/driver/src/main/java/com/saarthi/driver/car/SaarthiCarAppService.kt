package com.saarthi.driver.car

import android.content.Intent
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.SessionInfo
import androidx.car.app.validation.HostValidator
import com.saarthi.driver.BuildConfig

/**
 * Saarthi on the car's screen.
 *
 * A second *interface* to the running app, never a second app. Everything the
 * car shows is read from the same repositories, the same telemetry hub and the
 * same session the phone is using — there is no separate state here, no second
 * login, and no second connection to anything.
 *
 * The phone remains the whole of the machine. It holds the Bluetooth link to
 * the OBD adapter, polls the PIDs, keeps the foreground service alive, buffers
 * the outbox and talks to Saarthi. The car screen is a window onto that, and if
 * it were closed mid-journey nothing would stop being recorded. That division
 * is not an implementation detail: a head unit cannot pair to an ELM327, and an
 * app that expected it to would fail in a cab with no way to diagnose it.
 *
 * What is deliberately absent is as important. No QR scanning, no sign-in, no
 * text entry, no document handling, no settings — those live on the phone
 * because they need a keyboard, a camera or attention, and Android Auto's
 * templates refuse them for the same reason.
 */
class SaarthiCarAppService : CarAppService() {

    /**
     * Who may drive this service.
     *
     * The allow-list host validator in a debug build accepts the emulator and
     * the desktop head unit, which is what makes development possible at all.
     * A release build accepts only hosts signed by Google — anything else
     * projecting a driver's fleet data onto an unknown screen is exactly the
     * attack this validator exists to stop.
     */
    override fun createHostValidator(): HostValidator =
        if (BuildConfig.DEBUG) {
            HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
        } else {
            HostValidator.Builder(applicationContext)
                .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
                .build()
        }

    override fun onCreateSession(sessionInfo: SessionInfo): Session = SaarthiCarSession()

    // Kept for host versions that still call the older overload.
    override fun onCreateSession(): Session = SaarthiCarSession()
}

/**
 * One connection from a car screen.
 *
 * Holds nothing itself. The first screen decides what to show from the app's
 * live state, and every screen below it reads the same — so a driver who signs
 * on, pairs and starts a trip on the phone sees the car screen follow without
 * anything being pushed to it.
 */
class SaarthiCarSession : Session() {
    override fun onCreateScreen(intent: Intent): Screen = CarHomeScreen(carContext)
}
