package com.saarthi.device.domain

import com.saarthi.device.network.FrameSimulated
import com.saarthi.device.network.SimulatedFault
import kotlin.math.max
import kotlin.math.min
import kotlin.random.Random

/**
 * The engine a phone does not have.
 *
 * A handset can measure where it is, how fast it is going and how hard it was
 * shaken. It cannot measure RPM, coolant temperature, fuel level or a diagnostic
 * trouble code, because it is not connected to anything that knows them. This
 * class invents those values so the parts of Saarthi that consume them — the
 * alert rules, the maintenance recommendations, the driver score, the AI tools —
 * can be exercised end to end before a Freematics is fitted.
 *
 * Everything it produces is stamped as simulated, in the payload, in the stored
 * reading, in the realtime message and on the dashboard. That chain is the whole
 * justification for the class existing: a fabricated coolant temperature that
 * arrived looking like a measurement would send a mechanic looking for a fault
 * that does not exist, and take a working truck off the road to do it.
 *
 * ## Why the values move
 *
 * RPM tracks speed, fuel falls with distance, coolant climbs from cold and then
 * holds. A simulator emitting a constant 1,850 rpm would let a rule pass that
 * breaks on real data the first day hardware arrives — the point is to produce
 * something that behaves like an engine, not something that fills the field.
 */
class TelemetrySimulator {

    enum class Mode {
        OFF,
        NORMAL,
        HIGH_RPM,
        OVERHEATING,
        LOW_FUEL,
        LOW_BATTERY,
        ENGINE_WARNING,
        CUSTOM,
        ;

        val label: String
            get() = when (this) {
                OFF -> "Off"
                NORMAL -> "Normal"
                HIGH_RPM -> "High RPM"
                OVERHEATING -> "Overheating"
                LOW_FUEL -> "Low fuel"
                LOW_BATTERY -> "Low battery"
                ENGINE_WARNING -> "Engine warning"
                CUSTOM -> "Custom"
            }

        val description: String
            get() = when (this) {
                OFF -> "No simulated engine data. Only GPS, motion and device health."
                NORMAL -> "A healthy vehicle at working temperature."
                HIGH_RPM -> "Sustained high engine speed, for idling and load rules."
                OVERHEATING -> "Coolant above the safe range — raises the temperature alert."
                LOW_FUEL -> "Tank near empty, for the fuel-drop path."
                LOW_BATTERY -> "Charging-system fault — raises the low-voltage alert."
                ENGINE_WARNING -> "A stored trouble code, for the diagnostic-fault path."
                CUSTOM -> "Values you set yourself."
            }
    }

    /** Values a tester typed in, used only in CUSTOM mode. */
    data class Custom(
        val rpm: Double = 1_500.0,
        val fuelLevel: Double = 50.0,
        val coolantTemperature: Double = 88.0,
        val batteryVoltage: Double = 27.0,
        val engineLoad: Double = 40.0,
    )

    /**
     * Fuel and coolant carry between frames, because both are cumulative in a
     * real vehicle. Resetting them each tick would produce a fuel level that
     * jitters around a mean, which is not what a tank does.
     */
    private var fuelLevel = 64.0
    private var coolantTemperature = 30.0
    private var odometerKm = 0.0

    /** Start cold, so the warm-up is visible on the first few minutes of a run. */
    fun reset() {
        fuelLevel = 64.0
        coolantTemperature = 30.0
        odometerKm = 0.0
    }

    /**
     * Produce one engine reading.
     *
     * `speedKph` and `distanceKm` come from the real GPS, so the invented
     * figures at least agree with how the vehicle is actually moving — an engine
     * at 2,400 rpm while the truck is stationary is the kind of nonsense that
     * makes a test run useless for validating a rule.
     */
    fun next(mode: Mode, speedKph: Double, distanceKm: Double, custom: Custom = Custom()): FrameSimulated? {
        if (mode == Mode.OFF) return null

        odometerKm += distanceKm
        // Roughly 30 L/100 km on a 300 L tank — a believable burn rate for a
        // loaded truck, which matters because the fuel-drop rule fires on rate.
        fuelLevel = max(0.0, fuelLevel - distanceKm * 0.1)

        val moving = speedKph > 3
        val idleRpm = if (mode == Mode.HIGH_RPM) 900.0 else 750.0
        val cruiseRpm = when (mode) {
            Mode.HIGH_RPM -> 2_900.0
            Mode.LOW_BATTERY -> 1_600.0
            Mode.LOW_FUEL -> 1_700.0
            else -> 1_850.0
        }

        val rpm = when {
            mode == Mode.CUSTOM -> custom.rpm
            !moving -> idleRpm + Random.nextDouble(-40.0, 40.0)
            // Scaled off the real speed, so the two series tell the same story.
            else -> min(cruiseRpm + speedKph * 8, 3_200.0) + Random.nextDouble(-80.0, 80.0)
        }

        // Warms from cold toward its target and then holds, the way a thermostat
        // makes a real engine behave.
        val targetCoolant = when (mode) {
            Mode.OVERHEATING -> 112.0
            Mode.HIGH_RPM -> 94.0
            Mode.CUSTOM -> custom.coolantTemperature
            else -> 87.0
        }
        coolantTemperature += (targetCoolant - coolantTemperature) * 0.08
        coolantTemperature += Random.nextDouble(-0.4, 0.4)

        // A 24 V commercial electrical system, so 27.3 V is healthy and the
        // low-battery figure sits below the alert threshold rather than at an
        // arbitrary number.
        val batteryVoltage = when (mode) {
            Mode.LOW_BATTERY -> 22.4 + Random.nextDouble(-0.2, 0.2)
            Mode.CUSTOM -> custom.batteryVoltage
            else -> 27.3 + Random.nextDouble(-0.2, 0.2)
        }

        val effectiveFuel = when (mode) {
            Mode.LOW_FUEL -> min(fuelLevel, 7.0)
            Mode.CUSTOM -> custom.fuelLevel
            else -> fuelLevel
        }

        val engineLoad = when {
            mode == Mode.CUSTOM -> custom.engineLoad
            !moving -> Random.nextDouble(8.0, 15.0)
            else -> min(95.0, 25.0 + speedKph * 0.6 + Random.nextDouble(-5.0, 5.0))
        }

        val faults = if (mode == Mode.ENGINE_WARNING) {
            listOf(
                SimulatedFault(
                    code = "P0128",
                    description = "Coolant thermostat below regulating temperature.",
                ),
            )
        } else {
            emptyList()
        }

        return FrameSimulated(
            mode = mode.name,
            rpm = rpm.round(0),
            engineLoad = engineLoad.round(1),
            coolantTemperature = coolantTemperature.round(1),
            fuelLevel = effectiveFuel.round(1),
            batteryVoltage = batteryVoltage.round(2),
            throttlePosition = (engineLoad * 0.85).round(1),
            odometerKm = odometerKm.round(2),
            diagnostics = faults,
        )
    }

    private fun Double.round(decimals: Int): Double {
        var factor = 1.0
        repeat(decimals) { factor *= 10 }
        return kotlin.math.round(this * factor) / factor
    }
}
