package com.saarthi.terminal.domain

import kotlin.math.max
import kotlin.math.roundToInt

/**
 * What the terminal says out loud, and when.
 *
 * The navigation built up to this point is correct and almost useless: it tells
 * a driver where to turn on a screen they must not be looking at. Section 23's
 * rule that the interface must not encourage complex interaction while driving
 * cuts both ways — removing the interactions is half of it, and the other half
 * is making the one interaction that remains something a person can do with
 * their eyes on the road. That is this file.
 *
 * It is deliberately pure. No Android, no text-to-speech, no clock of its own —
 * it takes the state of the journey and returns a sentence or nothing. Every
 * rule below is therefore something that can be tested rather than something
 * that has to be driven around a car park to check:
 *
 *  * **Each manoeuvre is announced at most once per band**, and the bands only
 *    ever move forward. A driver is told about a turn as it approaches, not
 *    repeatedly, and never about one they have passed.
 *
 *  * **The bands are measured in seconds, not metres.** "Turn left in 200
 *    metres" is nine seconds' warning at 80 km/h and seventy at 10 km/h. The
 *    thresholds scale with speed and have floors for a stationary vehicle, so
 *    the driver always gets roughly the same amount of *time* to act.
 *
 *  * **Nothing is announced twice in quick succession**, except the instruction
 *    that matters. Opening a route, then immediately being told about the first
 *    turn, then being told again, is what makes people mute a navigator.
 *
 * The one thing this class must never do is speak *after* the moment it is
 * useful. A cue that could not be delivered — because the driver was talking to
 * the assistant — is dropped and re-evaluated on the next fix, so what gets
 * spoken is always the manoeuvre the vehicle is actually approaching.
 */
class NavigationAnnouncer {

    /**
     * Everything the decision needs, assembled by the caller.
     *
     * [journeyKey] identifies *where the driver is going* and [routeKey] the
     * particular line they are following. The distinction is what tells a new
     * journey from a re-route: the same destination on a different polyline is
     * not worth an opening announcement, and a driver who has just been sent
     * round a diversion does not need to be told the destination again.
     */
    data class Input(
        val journeyKey: String?,
        val routeKey: String?,
        val destinationName: String = "",
        /** Whole-route figures, for the opening line. */
        val routeDistanceKm: Double = 0.0,
        val routeDurationMinutes: Int = 0,
        val instruction: String? = null,
        val maneuver: String? = null,
        val modifier: String? = null,
        val roadName: String? = null,
        /** Metres to the manoeuvre, measured along the road. */
        val stepMetres: Int = 0,
        val speedKph: Double = 0.0,
        val rerouting: Boolean = false,
        val rerouteFailed: Boolean = false,
        val arrived: Boolean = false,
        val nowMs: Long = 0L,
    )

    /** How close the vehicle is to the manoeuvre, in bands rather than metres. */
    private enum class Band { NONE, FAR, APPROACH, IMMINENT }

    private var journeyKey: String? = null
    private var routeKey: String? = null
    private var openingSpoken = false
    private var arrivalSpoken = false
    private var rerouteSpoken = false
    private var failureSpoken = false

    private var currentStepKey: String? = null
    private var currentStepBand = Band.NONE
    private var lastSpokenAtMs = 0L

    /**
     * The next thing to say, or null.
     *
     * Called on every fix. Returning null is by far the commonest outcome and is
     * not a failure — most of a journey is silence, which is the point.
     */
    fun next(input: Input): String? {
        if (input.journeyKey == null || input.routeKey == null) {
            reset()
            return null
        }

        if (input.journeyKey != journeyKey) {
            // Somewhere new. Everything about the last journey is irrelevant,
            // including whether its arrival was announced.
            reset()
            journeyKey = input.journeyKey
            routeKey = input.routeKey
        } else if (input.routeKey != routeKey) {
            /*
             * The same destination, a different line — a re-route.
             *
             * The step state has to go, because the manoeuvres are new ones. The
             * opening line does not get repeated: the driver knows where they
             * are going, they have just taken a wrong turn, and being told the
             * destination and total distance again would be the app rubbing it
             * in.
             */
            routeKey = input.routeKey
            currentStepKey = null
            currentStepBand = Band.NONE
            rerouteSpoken = false
            failureSpoken = false
        }

        if (input.arrived) {
            if (arrivalSpoken) return null
            arrivalSpoken = true
            return spoken(input.nowMs, arrivalPhrase(input.destinationName))
        }

        if (input.rerouteFailed) {
            if (failureSpoken) return null
            failureSpoken = true
            return spoken(
                input.nowMs,
                "Saarthi cannot find a route from here. Carry on and it will pick the route up.",
            )
        }

        if (input.rerouting) {
            if (rerouteSpoken) return null
            rerouteSpoken = true
            return spoken(input.nowMs, "Off route. Finding a new way.")
        }

        if (!openingSpoken) {
            openingSpoken = true
            return spoken(input.nowMs, openingPhrase(input))
        }

        return turnCue(input)
    }

    /** Forget the journey. Called when navigation stops, so the next one is clean. */
    fun reset() {
        journeyKey = null
        routeKey = null
        openingSpoken = false
        arrivalSpoken = false
        rerouteSpoken = false
        failureSpoken = false
        currentStepKey = null
        currentStepBand = Band.NONE
        lastSpokenAtMs = 0L
    }

    // -----------------------------------------------------------------------
    // Turns
    // -----------------------------------------------------------------------

    private fun turnCue(input: Input): String? {
        val stepKey = stepKeyOf(input) ?: return null

        if (stepKey != currentStepKey) {
            currentStepKey = stepKey
            currentStepBand = Band.NONE
        }

        val band = bandFor(input.stepMetres, input.speedKph)
        if (band == Band.NONE || band <= currentStepBand) return null

        /*
         * Do not crowd the previous sentence.
         *
         * Two cues three seconds apart is how a navigator earns being muted. The
         * imminent one is exempt: it is the instruction the driver is about to
         * act on, and holding it back to be polite would be holding back the
         * only cue that matters.
         *
         * A suppressed cue is *not* recorded as spoken, so it is re-evaluated on
         * the next fix — by which point the vehicle is closer and the band may
         * have deepened, which is exactly the sentence that should be said.
         */
        if (band != Band.IMMINENT && input.nowMs - lastSpokenAtMs < MIN_GAP_MS) return null

        currentStepBand = band

        val instruction = instructionPhrase(input) ?: return null
        val text = if (band == Band.IMMINENT) {
            capitalise(instruction)
        } else {
            "In ${spokenDistance(input.stepMetres)}, ${lowerFirst(instruction)}"
        }

        return spoken(input.nowMs, text)
    }

    /**
     * Which band a distance falls into, given how fast the vehicle is going.
     *
     * Time, with a floor. A fixed 200 m is nine seconds at motorway speed and
     * over a minute in traffic — the same number describing two completely
     * different amounts of warning. Scaling by speed gives a driver the same
     * chance to change lane whatever they are doing, and the floors stop the
     * bands collapsing to nothing when the vehicle is stopped at a light.
     */
    private fun bandFor(metres: Int, speedKph: Double): Band {
        val mps = max(0.0, speedKph) / 3.6
        val imminent = max(IMMINENT_FLOOR_M, mps * IMMINENT_SECONDS)
        val approach = max(APPROACH_FLOOR_M, mps * APPROACH_SECONDS)
        val far = max(FAR_FLOOR_M, mps * FAR_SECONDS)

        return when {
            metres <= imminent -> Band.IMMINENT
            metres <= approach -> Band.APPROACH
            metres <= far -> Band.FAR
            else -> Band.NONE
        }
    }

    private fun stepKeyOf(input: Input): String? {
        val instruction = input.instruction?.takeIf { it.isNotBlank() }
        val maneuver = input.maneuver?.takeIf { it.isNotBlank() }
        if (instruction == null && maneuver == null) return null
        return "${instruction.orEmpty()}|${maneuver.orEmpty()}|${input.modifier.orEmpty()}"
    }

    private fun spoken(nowMs: Long, text: String): String {
        lastSpokenAtMs = nowMs
        return text
    }

    // -----------------------------------------------------------------------
    // Phrasing
    // -----------------------------------------------------------------------

    private fun openingPhrase(input: Input): String {
        val where = input.destinationName.takeIf { it.isNotBlank() }
        val distance = spokenDistance((input.routeDistanceKm * 1_000).roundToInt())
        val minutes = input.routeDurationMinutes

        return buildString {
            append(if (where != null) "Heading to $where." else "Starting navigation.")
            append(" $distance")
            if (minutes > 0) append(", about ${spokenMinutes(minutes)}")
            append(".")
        }
    }

    private fun arrivalPhrase(destinationName: String): String =
        if (destinationName.isBlank()) {
            "You have arrived."
        } else {
            "You have arrived at $destinationName."
        }

    /**
     * The manoeuvre, in words.
     *
     * The router's own instruction is preferred — it is written to be read by a
     * person and handles the cases a glyph cannot, like a named exit or a fork
     * with three ways out. The fallback exists because a router occasionally
     * emits a step with no instruction at all, and "turn left" assembled from
     * the manoeuvre fields is far better than silence at a junction.
     */
    private fun instructionPhrase(input: Input): String? {
        input.instruction?.trim()?.takeIf { it.isNotBlank() }?.let { return it }

        val direction = when (input.modifier?.lowercase()) {
            "left" -> "turn left"
            "right" -> "turn right"
            "sharp left" -> "turn sharply left"
            "sharp right" -> "turn sharply right"
            "slight left" -> "bear left"
            "slight right" -> "bear right"
            "uturn" -> "make a U-turn"
            "straight" -> "continue straight ahead"
            else -> when (input.maneuver?.lowercase()) {
                "roundabout", "rotary" -> "take the roundabout"
                "merge" -> "merge"
                "fork" -> "keep to the fork"
                "arrive" -> "arrive at your destination"
                "continue" -> "continue"
                else -> null
            }
        } ?: return null

        val road = input.roadName?.trim()?.takeIf { it.isNotBlank() && it != "Unnamed road" }
        return if (road == null) direction else "$direction onto $road"
    }

    /**
     * A distance a person can hear.
     *
     * Rounded hard, because speech has no time for precision: "four hundred and
     * twelve metres" is longer to say than the driver has to act on it, and
     * carries no more information than "four hundred metres".
     */
    private fun spokenDistance(metres: Int): String = when {
        metres < 1_000 -> "${(metres / 50).coerceAtLeast(1) * 50} metres"
        metres < 10_000 -> {
            val km = (metres / 100) / 10.0
            if (km % 1.0 == 0.0) {
                "${km.toInt()} kilometre${if (km.toInt() == 1) "" else "s"}"
            } else {
                "$km kilometres"
            }
        }
        else -> "${(metres / 1_000)} kilometres"
    }

    private fun spokenMinutes(minutes: Int): String = when {
        minutes < 60 -> "$minutes minute${if (minutes == 1) "" else "s"}"
        minutes % 60 == 0 -> "${minutes / 60} hour${if (minutes / 60 == 1) "" else "s"}"
        else -> "${minutes / 60} hour${if (minutes / 60 == 1) "" else "s"} " +
            "${minutes % 60} minute${if (minutes % 60 == 1) "" else "s"}"
    }

    /**
     * Lower-case the first letter, unless doing so would damage the word.
     *
     * "Turn left onto NH 48" becomes "turn left onto NH 48" so it can follow "In
     * 500 metres, ". "NH 48 continues" must not become "nH 48 continues", so the
     * second character decides: a lower-case one means the first is ordinary
     * capitalisation, an upper-case one means an acronym.
     */
    private fun lowerFirst(text: String): String {
        if (text.length < 2) return text
        return if (text[1].isLowerCase()) {
            text.replaceFirstChar { it.lowercaseChar() }
        } else {
            text
        }
    }

    private fun capitalise(text: String): String =
        text.replaceFirstChar { if (it.isLowerCase()) it.uppercaseChar() else it }

    private companion object {
        /**
         * How much warning each band gives, in seconds of travel.
         *
         * Roughly what an in-car system gives: a heads-up while there is still
         * time to change lane, a confirmation as the junction comes into view,
         * and the instruction itself at the moment of acting.
         */
        const val FAR_SECONDS = 90.0
        const val APPROACH_SECONDS = 30.0
        const val IMMINENT_SECONDS = 9.0

        /** Floors, so a stationary vehicle still gets sensible distances. */
        const val FAR_FLOOR_M = 900.0
        const val APPROACH_FLOOR_M = 280.0
        const val IMMINENT_FLOOR_M = 70.0

        /** The shortest gap between two non-urgent sentences. */
        const val MIN_GAP_MS = 4_000L
    }
}
