package com.saarthi.terminal.telemetry

import com.saarthi.terminal.util.DebugLog
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/**
 * One ELM327 conversation, over an already-open serial stream.
 *
 * Separated from the Bluetooth plumbing on purpose. What makes an OBD adapter
 * hard is not the socket — it is that ELM327 clones are approximate, vehicles
 * answer differently, and a reply can be an error string, a "searching" notice,
 * or a perfectly-formed frame for a PID the engine does not actually support.
 * All of that is protocol, and it is testable without a car if it does not also
 * own a radio.
 *
 * Three rules run through it, and each comes from a way this goes wrong:
 *
 * **Ask only what the vehicle said it supports.** `0100`/`0120`/`0140` return a
 * bitmask of which PIDs the ECU answers. Polling outside that mask wastes a
 * round trip per cycle and, on some clones, wedges the adapter until it is
 * power-cycled.
 *
 * **A malformed reply is silence, never a number.** `NO DATA`, `?`, `STOPPED`,
 * a short frame or a wrong echo all mean "not measured". Section 18: a gauge
 * showing nothing beats a gauge showing something invented.
 *
 * **The engine is not the adapter.** An adapter answers happily with the
 * ignition off and the ECU asleep, returning `NO DATA` for everything. That is
 * a connected adapter with no readings, and it is reported as exactly that.
 */
class ObdSession(
    private val input: InputStream,
    private val output: OutputStream,
) {

    /** PIDs the vehicle confirmed it answers, from the support bitmasks. */
    private var supported: Set<Int> = emptySet()

    /**
     * Bring the adapter to a known state.
     *
     * The order matters and is the conventional one: reset, then silence the
     * things that would otherwise have to be parsed around — command echo,
     * linefeeds, spaces and the header bytes — then let it work out the
     * vehicle's protocol itself. `ATSP0` is deliberate: hard-coding a protocol
     * is how an adapter that works on one truck fails on the next.
     */
    fun initialise(): Boolean {
        val opening = listOf(
            "ATZ" to 1200L,   // Reset. Slow, and the adapter ignores input while it runs.
            "ATE0" to 200L,   // No echo, so a reply is only ever a reply.
            "ATL0" to 200L,   // No linefeeds.
            "ATS0" to 200L,   // No spaces, so frames are a plain hex string.
            "ATH0" to 200L,   // No headers.
            "ATSP0" to 400L,  // Choose the protocol automatically.
        )

        for ((command, settle) in opening) {
            val reply = exchange(command, settle) ?: return false
            // ATZ answers with its banner rather than OK, so only the rest are
            // checked. An adapter that refuses ATE0 is one whose replies cannot
            // be parsed at all.
            if (command != "ATZ" && !reply.contains("OK", ignoreCase = true)) {
                DebugLog.warn("obd", "$command refused: $reply")
                return false
            }
        }

        supported = probeSupportedPids()
        DebugLog.info("obd", "Vehicle answers ${supported.size} PIDs")
        return true
    }

    /**
     * Which PIDs this vehicle answers.
     *
     * Each support PID returns four bytes of bitmask covering the next thirty-two,
     * and its top bit says whether the following range is worth asking about.
     * Stopping when that bit is clear is what keeps a cheap clone from being
     * asked about ranges it will never answer.
     */
    private fun probeSupportedPids(): Set<Int> {
        val found = mutableSetOf<Int>()
        // Up to 0xA0, so the 0xA1-0xC0 block — which carries the odometer at
        // 0xA6 — is discovered on the vehicles new enough to have it.
        var base = 0x00
        while (base <= 0xA0) {
            val frame = readPidRaw(base) ?: break
            if (frame.size < 4) break

            var mask = ((frame[0].toLong() and 0xFF) shl 24) or
                ((frame[1].toLong() and 0xFF) shl 16) or
                ((frame[2].toLong() and 0xFF) shl 8) or
                (frame[3].toLong() and 0xFF)

            for (offset in 1..32) {
                if (mask and 0x8000_0000L != 0L) found += base + offset
                mask = mask shl 1
            }

            // The last bit of each block says "there is another block".
            if (base + 0x20 !in found) break
            base += 0x20
        }
        return found
    }

    /** True once the vehicle has told us it answers at least one PID. */
    val hasVehicle: Boolean get() = supported.isNotEmpty()

    /**
     * The PIDs this vehicle admitted to, as hex.
     *
     * Surfaced for diagnostics because "why is there no fuel reading" is the
     * first question anyone asks of an OBD install, and the answer is almost
     * always that the vehicle does not expose that PID. A list of what it *does*
     * answer settles it in a glance instead of a support call.
     */
    val supportedPids: List<String> get() = supported.sorted().map { "%02X".format(it) }

    /**
     * Read everything supported, once.
     *
     * Returns only what the vehicle actually answered on this pass. A PID in the
     * support mask can still return `NO DATA` — a sensor can be unplugged, and
     * some ECUs advertise more than they answer — so the mask decides what to
     * ask, and the reply decides what is reported.
     */
    fun readAll(at: Long): Map<Metric, MetricValue> = buildMap {
        readPid(PID_RPM) { f -> if (f.size >= 2) (f.u(0) * 256 + f.u(1)) / 4.0 else null }
            ?.let { put(Metric.RPM, MetricValue(it, MetricSource.OBD, at)) }

        readPid(PID_SPEED) { f -> if (f.isNotEmpty()) f.u(0).toDouble() else null }
            ?.let { put(Metric.SPEED, MetricValue(it, MetricSource.OBD, at)) }

        readPid(PID_ENGINE_LOAD) { f -> if (f.isNotEmpty()) f.u(0) * 100.0 / 255.0 else null }
            ?.let { put(Metric.ENGINE_LOAD, MetricValue(it, MetricSource.OBD, at)) }

        // A-40: the ECU reports coolant with a 40-degree offset so it can express
        // temperatures below freezing in one unsigned byte.
        readPid(PID_COOLANT) { f -> if (f.isNotEmpty()) f.u(0) - 40.0 else null }
            ?.let { put(Metric.COOLANT_TEMPERATURE, MetricValue(it, MetricSource.OBD, at)) }

        readPid(PID_FUEL_LEVEL) { f -> if (f.isNotEmpty()) f.u(0) * 100.0 / 255.0 else null }
            ?.let { put(Metric.FUEL_LEVEL, MetricValue(it, MetricSource.OBD, at)) }

        readPid(PID_THROTTLE) { f -> if (f.isNotEmpty()) f.u(0) * 100.0 / 255.0 else null }
            ?.let { put(Metric.THROTTLE_POSITION, MetricValue(it, MetricSource.OBD, at)) }

        // Same 40-degree offset as coolant, for the same reason.
        readPid(PID_INTAKE_TEMP) { f -> if (f.isNotEmpty()) f.u(0) - 40.0 else null }
            ?.let { put(Metric.INTAKE_TEMPERATURE, MetricValue(it, MetricSource.OBD, at)) }

        /*
         * Fuel consumption, litres per hour.
         *
         * `015E` is the direct reading, and most vehicles on the road do not
         * answer it — which is why the air-flow route below exists. An engine
         * burns a near-fixed mass of air per unit of fuel, so mass air flow and
         * consumption are the same measurement in different units, and deriving
         * one from the other is what every trip computer has always done.
         *
         * Both are reported as measured, because both are: the derivation is
         * arithmetic on a sensor reading, not an invention. It is the same
         * standing as speed computed from GPS positions.
         */
        val fuelRate = readPid(PID_FUEL_RATE) { f ->
            if (f.size >= 2) (f.u(0) * 256 + f.u(1)) / 20.0 else null
        } ?: readPid(PID_MAF) { f ->
            if (f.size >= 2) fuelRateFromAirFlow((f.u(0) * 256 + f.u(1)) / 100.0) else null
        }
        fuelRate?.let { put(Metric.FUEL_RATE, MetricValue(it, MetricSource.OBD, at)) }

        /*
         * The odometer, in tenths of a kilometre across four bytes.
         *
         * PID A6 was only added to the standard in the 2015 revision, so most
         * vehicles on the road today answer nothing — which is exactly why it is
         * asked for through the support mask like everything else. When a
         * vehicle does answer, this is the real dash reading rather than the
         * figure somebody typed into Saarthi, and the difference is the whole
         * argument for asking.
         */
        readPid(PID_ODOMETER) { f ->
            if (f.size >= 4) {
                ((f.u(0).toLong() shl 24) or
                    (f.u(1).toLong() shl 16) or
                    (f.u(2).toLong() shl 8) or
                    f.u(3).toLong()) / 10.0
            } else {
                null
            }
        }?.let { put(Metric.ODOMETER, MetricValue(it, MetricSource.OBD, at)) }

        /*
         * Battery voltage comes from the adapter, not the ECU.
         *
         * `ATRV` measures the OBD connector's own supply, which is the battery.
         * It needs no PID support and works with the ignition off — which is
         * exactly when somebody wants to know whether the battery is flat.
         */
        exchange("ATRV", 120L)
            ?.removeSuffix("V")
            ?.trim()
            ?.toDoubleOrNull()
            ?.takeIf { it in 6.0..32.0 }
            ?.let { put(Metric.BATTERY_VOLTAGE, MetricValue(it, MetricSource.OBD, at)) }
    }


    /**
     * Litres of fuel per hour, from grams of air per second.
     *
     * An engine burns air and fuel in a near-fixed mass ratio, so the mass of
     * air going in tells you the mass of fuel going with it. Divide by density
     * and it is a volume.
     *
     *     litres/hour = (grams_air/second × 3600) ÷ (air_fuel_ratio × grams/litre)
     *
     * The constants are diesel's: 14.5:1 by mass, and 835 g/L at 15 °C. Saarthi
     * is a freight product and its vehicles are overwhelmingly diesel; a petrol
     * engine would use 14.7 and 745, which reads about 12% low here.
     *
     * That approximation is the honest limit of this route. It assumes the
     * engine is running at its stoichiometric ratio, which is true at cruise and
     * wrong under hard acceleration where the mixture is deliberately rich. A
     * direct `015E` reading is used in preference wherever the vehicle offers
     * one, and this fills in for the majority that do not.
     */
    private fun fuelRateFromAirFlow(gramsPerSecond: Double): Double? {
        if (gramsPerSecond <= 0.0) return null
        val litresPerHour = gramsPerSecond * 3600.0 / (DIESEL_AIR_FUEL_RATIO * DIESEL_GRAMS_PER_LITRE)
        /*
         * A truck at full load burns perhaps 60 L/h; 150 is generous for the
         * largest engine on any road. Past it the reading is a decode error, and
         * publishing one would poison every average built on the series.
         *
         * The cap matters more than it looks. `FFFF` is the conventional
         * "invalid" marker for a two-byte PID, and it decodes here to about
         * 195 L/h — a number low enough to look like a very thirsty truck and
         * high enough to wreck a fuel report.
         */
        return litresPerHour.takeIf { it < MAX_PLAUSIBLE_FUEL_RATE_LPH }
    }

    /**
     * The vehicle's own VIN, from mode 09.
     *
     * Worth reading once per connection and no more — it cannot change while
     * the adapter is plugged in. A fleet gets something from it no other source
     * offers: proof that the truck this terminal is bolted to is the truck
     * Saarthi thinks it is. A transposed registration in an onboarding
     * spreadsheet is invisible until the VIN disagrees with it.
     *
     * The reply is `49 02 01` followed by seventeen ASCII bytes, usually split
     * across several frames the adapter concatenates for us.
     */
    fun readVin(): String? {
        val reply = exchange("0902", 400L) ?: return null
        if (reply.isBlank() || NON_ANSWERS.any { reply.contains(it, ignoreCase = true) }) {
            return null
        }

        val hex = reply.filter { it.isDigit() || it in 'A'..'F' || it in 'a'..'f' }.uppercase()
        // Strip every `4902xx` frame header; what remains is the VIN's bytes.
        val body = Regex("4902[0-9A-F]{2}").replace(hex, "")
        val text = body.chunked(2)
            .mapNotNull { it.toIntOrNull(16) }
            // Some ECUs left-pad the first frame with nulls.
            .filter { it in 0x20..0x7E }
            .map { it.toChar() }
            .joinToString("")
            .trim()

        // A VIN is seventeen characters. Anything else is a partial read, and a
        // truncated VIN that looks plausible is worse than none.
        return text.takeIf { it.length == 17 }
    }

    /**
     * Stored fault codes (mode 03).
     *
     * Two bytes per code. The top two bits choose the letter — P, C, B or U —
     * and the remaining fourteen are the digits, which is why this is bit
     * arithmetic rather than a hex dump.
     */
    fun readFaultCodes(): List<String> {
        val reply = exchange("03", 300L) ?: return emptyList()
        if (reply.isBlank() || reply.contains("NO DATA")) return emptyList()

        val hex = reply.filter { it.isDigit() || it in 'A'..'F' || it in 'a'..'f' }.uppercase()
        val body = hex.removePrefix("43")
        return body.chunked(4)
            .filter { it.length == 4 && it != "0000" }
            .mapNotNull { chunk ->
                val value = chunk.toIntOrNull(16) ?: return@mapNotNull null
                val letter = when ((value shr 14) and 0x03) {
                    0 -> 'P'
                    1 -> 'C'
                    2 -> 'B'
                    else -> 'U'
                }
                "%c%04X".format(letter, value and 0x3FFF)
            }
    }

    // -----------------------------------------------------------------------
    // Wire
    // -----------------------------------------------------------------------

    private fun <T> readPid(pid: Int, decode: (List<Int>) -> T?): T? {
        if (pid !in supported) return null
        val frame = readPidRaw(pid) ?: return null
        return decode(frame)
    }

    /**
     * One mode-01 request, returned as its data bytes.
     *
     * The reply echoes the mode and PID (`41 0C ...`) before the payload, and
     * anything that does not start with that echo is a reply to something else —
     * a leftover from a previous command, or an adapter still searching. Dropped
     * rather than guessed at.
     */
    private fun readPidRaw(pid: Int): List<Int>? {
        val reply = exchange("01%02X".format(pid), 0L) ?: return null
        if (reply.isBlank() || NON_ANSWERS.any { reply.contains(it, ignoreCase = true) }) {
            return null
        }

        val hex = reply.filter { it.isDigit() || it in 'A'..'F' || it in 'a'..'f' }.uppercase()
        val echo = "41%02X".format(pid)
        val start = hex.indexOf(echo)
        if (start < 0) return null

        val payload = hex.substring(start + echo.length)
        if (payload.length < 2) return null
        return payload.chunked(2).mapNotNull { it.toIntOrNull(16) }
    }

    /**
     * Write a command, read until the adapter's prompt.
     *
     * ELM327 terminates every reply with `>`, which is the only reliable frame
     * boundary it offers — replies are variable length and a fixed read would
     * either truncate a long one or block forever on a short one.
     */
    private fun exchange(command: String, settleMillis: Long): String? = try {
        // Drain anything left from a previous command before asking a new one,
        // or a slow reply gets read as the answer to the wrong question.
        while (input.available() > 0) input.read()

        output.write("$command\r".toByteArray())
        output.flush()
        if (settleMillis > 0) Thread.sleep(settleMillis)

        val buffer = StringBuilder()
        val deadline = System.currentTimeMillis() + REPLY_TIMEOUT_MS
        var prompt = false
        while (System.currentTimeMillis() < deadline && !prompt) {
            if (input.available() <= 0) {
                Thread.sleep(10)
                continue
            }
            when (val byte = input.read()) {
                -1 -> break
                '>'.code -> prompt = true
                '\r'.code, '\n'.code -> buffer.append(' ')
                else -> buffer.append(byte.toChar())
            }
        }

        if (!prompt) {
            DebugLog.warn("obd", "$command timed out")
            null
        } else {
            buffer.toString().trim()
        }
    } catch (error: IOException) {
        DebugLog.warn("obd", "$command failed: ${error.message}")
        null
    } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
        null
    }

    private fun List<Int>.u(index: Int): Int = this[index] and 0xFF

    private companion object {
        const val PID_ENGINE_LOAD = 0x04
        const val PID_COOLANT = 0x05
        const val PID_RPM = 0x0C
        const val PID_SPEED = 0x0D
        const val PID_INTAKE_TEMP = 0x0F
        const val PID_THROTTLE = 0x11
        const val PID_FUEL_LEVEL = 0x2F
        const val PID_MAF = 0x10
        const val PID_FUEL_RATE = 0x5E
        const val PID_ODOMETER = 0xA6

        /** Diesel, by mass. Saarthi's vehicles are overwhelmingly diesel. */
        const val DIESEL_AIR_FUEL_RATIO = 14.5

        /** Diesel density at 15 °C. */
        const val DIESEL_GRAMS_PER_LITRE = 835.0

        /** Beyond any road vehicle. See the note in `fuelRateFromAirFlow`. */
        const val MAX_PLAUSIBLE_FUEL_RATE_LPH = 150.0

        /** Every way an ELM327 says "I have nothing for you". */
        val NON_ANSWERS = listOf(
            "NO DATA",
            "STOPPED",
            "UNABLE TO CONNECT",
            "CAN ERROR",
            "BUS INIT",
            "ERROR",
            "?",
        )

        /**
         * Long enough for a slow protocol negotiation, short enough that a dead
         * adapter does not hold the polling loop for a whole second.
         */
        const val REPLY_TIMEOUT_MS = 900L
    }
}
