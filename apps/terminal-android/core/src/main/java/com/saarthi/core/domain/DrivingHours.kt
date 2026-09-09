package com.saarthi.core.domain

/**
 * How long this driver has been at the wheel, and when they should stop.
 *
 * Nothing on the platform tracked this. The vehicle's speed was recorded, trips
 * were opened and closed, and nobody added up the hours — so the app could tell
 * a fleet a lorry had covered nine hundred kilometres and could not tell the
 * driver they had been driving for eleven hours.
 *
 * **Whose record this is matters more than the arithmetic.** It is the driver's.
 * It is shown to them, on their own screen, so that the person deciding whether
 * to push on to the next town is the person holding the information. A fatigue
 * figure that only a fleet manager can see is a stick; the same figure in the
 * cab is a reason to pull over.
 *
 * The rules encoded here follow the Motor Transport Workers Act's shape — a
 * continuous-driving limit and a daily limit, each with a required break — with
 * a soft warning before each so a driver can reach somewhere sensible to stop
 * rather than being told at the moment they are already over.
 *
 * Pure and unit-tested. It takes a clock reading rather than reading one,
 * because a rule about hours must be testable without waiting hours.
 */
object DrivingHours {

    /**
     * A continuous stint, in milliseconds, before a break is due.
     *
     * Five hours. The Act sets it there and the physiology agrees; it is also
     * roughly the interval Indian highways space their dhabas at, which is what
     * makes it a rule a driver can actually keep.
     */
    const val STINT_LIMIT_MS = 5 * 60 * 60 * 1_000L

    /** Warn half an hour early, so there is time to find somewhere to stop. */
    const val STINT_WARN_MS = STINT_LIMIT_MS - 30 * 60 * 1_000L

    /** The break that resets a stint. */
    const val BREAK_MS = 30 * 60 * 1_000L

    /** Total driving in a day before the shift should end. */
    const val DAILY_LIMIT_MS = 10 * 60 * 60 * 1_000L

    /** Warn an hour early: ending a shift needs somewhere to park a lorry. */
    const val DAILY_WARN_MS = DAILY_LIMIT_MS - 60 * 60 * 1_000L

    /**
     * How long a stop must last before it counts as a break rather than a queue.
     *
     * Ten minutes. Below that it is a signal, a toll plaza or traffic, and
     * resetting a five-hour stint because a lorry waited at a barrier would make
     * the whole measure meaningless.
     */
    const val REST_QUALIFIES_MS = 10 * 60 * 1_000L

    /** Above walking pace, the same threshold the cockpit calls "moving". */
    const val MOVING_KPH = 5.0

    /**
     * What the driver should be told, if anything.
     *
     * Ordered by severity deliberately: a driver over both limits is told about
     * the day, because that is the one that ends with parking rather than a cup
     * of tea.
     */
    enum class Advice {
        /** Nothing to say. */
        NONE,

        /** A break is coming up. Said early, so there is time to choose where. */
        BREAK_SOON,

        /** The continuous limit is reached. */
        BREAK_DUE,

        /** The day's driving is nearly done. */
        SHIFT_SOON,

        /** The day's limit is reached. */
        SHIFT_DUE,
    }

    /**
     * The running tally.
     *
     * @param stintMs continuous driving since the last qualifying break.
     * @param todayMs total driving since the shift began.
     * @param restingSinceMs when the vehicle last stopped, or null while moving.
     */
    data class State(
        val stintMs: Long = 0,
        val todayMs: Long = 0,
        val restingSinceMs: Long? = null,
        /**
         * The clock reading this state was last advanced to, or null before the
         * first one.
         *
         * Nullable rather than zero. Zero is a legitimate instant, and using it
         * as "no reading yet" meant the first real reading was swallowed and
         * every tally ran one interval short — which a test caught and a cab
         * never would have.
         */
        val atMs: Long? = null,
    ) {
        val advice: Advice
            get() = when {
                todayMs >= DAILY_LIMIT_MS -> Advice.SHIFT_DUE
                stintMs >= STINT_LIMIT_MS -> Advice.BREAK_DUE
                todayMs >= DAILY_WARN_MS -> Advice.SHIFT_SOON
                stintMs >= STINT_WARN_MS -> Advice.BREAK_SOON
                else -> Advice.NONE
            }

        /** How long the current break has run, or null while moving. */
        fun restedMs(nowMs: Long): Long? = restingSinceMs?.let { (nowMs - it).coerceAtLeast(0) }
    }

    /**
     * Advance the tally by one telemetry reading.
     *
     * Driven by readings rather than by a timer, which is what makes it correct
     * across the things that actually happen to a phone in a cab: the app being
     * killed, the screen being off, a tunnel, a battery saver. The elapsed time
     * between two readings is counted as driving if the vehicle was moving, and
     * that is true whether the app was awake for it or not.
     *
     * A gap longer than [maxGapMs] is not counted at all. The app being closed
     * for six hours is not six hours of driving, and it is not six hours of rest
     * either — it is unknown, and guessing either way would put a false figure
     * in front of a decision about fatigue.
     */
    fun advance(
        state: State,
        speedKph: Double?,
        nowMs: Long,
        maxGapMs: Long = 15 * 60 * 1_000L,
    ): State {
        val last = state.atMs
        if (last == null) {
            return state.copy(
                atMs = nowMs,
                restingSinceMs = if ((speedKph ?: 0.0) > MOVING_KPH) null else nowMs,
            )
        }

        val elapsed = nowMs - last
        // Time running backwards is a clock correction, not a journey.
        if (elapsed <= 0) return state.copy(atMs = nowMs)
        if (elapsed > maxGapMs) {
            /*
             * An unobserved gap. Neither driving nor rest.
             *
             * The stint is left standing rather than reset: a driver who closed
             * the app four hours into a stint and reopened it later has not had
             * a break, and clearing the tally would be the one error here that
             * could get somebody hurt.
             */
            return state.copy(atMs = nowMs)
        }

        val moving = (speedKph ?: 0.0) > MOVING_KPH

        if (moving) {
            return State(
                stintMs = state.stintMs + elapsed,
                todayMs = state.todayMs + elapsed,
                restingSinceMs = null,
                atMs = nowMs,
            )
        }

        val restingSince = state.restingSinceMs ?: last
        val rested = nowMs - restingSince

        // A long enough stop clears the stint. The day's total stands: a break
        // is not a new day.
        return State(
            stintMs = if (rested >= BREAK_MS) 0 else state.stintMs,
            todayMs = state.todayMs,
            restingSinceMs = restingSince,
            atMs = nowMs,
        )
    }

    /** Start again. Called when a driver signs on, not when a trip ends. */
    fun reset(): State = State()

    /** Hours and minutes, for a screen. */
    fun format(millis: Long): String {
        val totalMinutes = millis / 60_000
        val hours = totalMinutes / 60
        val minutes = totalMinutes % 60
        return if (hours > 0) "${hours}h ${minutes}m" else "${minutes}m"
    }
}
