package com.saarthi.device.domain

import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlin.math.sqrt

/**
 * Phone motion.
 *
 * Section 22 asks for accelerometer and gyroscope data and is careful to add
 * that it is not equivalent to vehicle CAN data. That caveat is the important
 * part, and it is a physical fact rather than a legal disclaimer: a unit bolted
 * to a chassis measures the vehicle, while a handset measures the handset. A
 * phone sliding across a dashboard registers a harsh event the truck never made,
 * and a phone in a driver's pocket registers walking.
 *
 * So this class does three things to stay honest.
 *
 * **It removes gravity.** A phone lying flat reads about 9.8 m/s² on one axis
 * forever. Reporting that as sustained acceleration would be nonsense, so a
 * low-pass filter estimates the gravity vector and the reported value is what
 * remains.
 *
 * **It reports magnitude, not axes-as-driving.** Which way a phone is facing is
 * unknown and changes when somebody picks it up, so "forward deceleration"
 * cannot be inferred from a device axis. Harsh events are flagged from total
 * linear acceleration, and the individual axes are passed through as raw sensor
 * output rather than as a claim about the vehicle.
 *
 * **It requires corroborating speed.** A harsh-braking flag is only raised when
 * GPS agrees the vehicle was moving and slowed. A phone dropped in a stationary
 * cab produces a large spike and no speed change, and that is not braking.
 */
class MotionDetector(private val sensorManager: SensorManager?) : SensorEventListener {

    /** Low-pass coefficient for the gravity estimate. Standard for this filter. */
    private val alpha = 0.8f

    private val gravity = FloatArray(3)

    @Volatile private var linearX = 0f
    @Volatile private var linearY = 0f
    @Volatile private var linearZ = 0f

    /** Peak linear magnitude seen since the last frame, in g. */
    @Volatile private var peakG = 0f

    @Volatile private var available = false

    val isAvailable: Boolean get() = available

    fun start() {
        val manager = sensorManager ?: return
        val accelerometer = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        if (accelerometer == null) {
            available = false
            return
        }
        available = true
        // UI rate rather than FASTEST: harsh-event detection needs tens of
        // samples a second, not hundreds, and the fastest rate is a measurable
        // amount of battery for no extra fidelity.
        manager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_UI)
    }

    fun stop() {
        sensorManager?.unregisterListener(this)
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ACCELEROMETER) return

        for (axis in 0..2) {
            gravity[axis] = alpha * gravity[axis] + (1 - alpha) * event.values[axis]
        }

        linearX = event.values[0] - gravity[0]
        linearY = event.values[1] - gravity[1]
        linearZ = event.values[2] - gravity[2]

        val magnitudeG =
            sqrt(linearX * linearX + linearY * linearY + linearZ * linearZ) / SensorManager.GRAVITY_EARTH
        if (magnitudeG > peakG) peakG = magnitudeG
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    data class Reading(
        val accelerationX: Double?,
        val accelerationY: Double?,
        val accelerationZ: Double?,
        val harshBraking: Boolean,
        val harshAcceleration: Boolean,
        val suddenMovement: Boolean,
    )

    /**
     * Read and reset.
     *
     * `speedDeltaKph` and `secondsElapsed` come from consecutive GPS fixes and
     * are what turn a sensor spike into a claim about driving. Without them this
     * would report a phone being picked up as harsh braking.
     */
    fun sample(speedDeltaKph: Double, secondsElapsed: Double, movingKph: Double): Reading {
        val peak = peakG
        peakG = 0f

        if (!available) {
            return Reading(null, null, null, false, false, false)
        }

        // A spike with no corroborating speed change is the phone moving, not
        // the truck. Both have to agree before anything is claimed.
        val plausibleWindow = secondsElapsed in 0.5..60.0
        val decelerating = plausibleWindow && movingKph > 20 && speedDeltaKph <= -HARSH_DELTA_KPH
        val accelerating = plausibleWindow && speedDeltaKph >= HARSH_DELTA_KPH

        return Reading(
            accelerationX = (linearX / SensorManager.GRAVITY_EARTH).toDouble().coerceIn(-8.0, 8.0),
            accelerationY = (linearY / SensorManager.GRAVITY_EARTH).toDouble().coerceIn(-8.0, 8.0),
            accelerationZ = (linearZ / SensorManager.GRAVITY_EARTH).toDouble().coerceIn(-8.0, 8.0),
            harshBraking = decelerating && peak >= HARSH_G,
            harshAcceleration = accelerating && peak >= HARSH_G,
            // Reported on its own terms: something shook the phone hard. It is
            // not described as a crash, because a phone cannot tell the
            // difference between an impact and being dropped.
            suddenMovement = peak >= SUDDEN_G,
        )
    }

    private companion object {
        /** Sustained g at which an event is worth flagging. */
        const val HARSH_G = 0.45f

        /** A jolt large enough to be worth recording whatever caused it. */
        const val SUDDEN_G = 1.2f

        /** Speed change over one reporting interval that counts as harsh. */
        const val HARSH_DELTA_KPH = 12.0
    }
}
