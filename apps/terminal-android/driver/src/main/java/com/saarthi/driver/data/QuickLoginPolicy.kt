package com.saarthi.driver.data

/**
 * The rules Saarthi Quick Login follows, with no Android in them.
 *
 * Separated from the storage and the screens so they can be tested properly. A
 * four-digit PIN and a lockout counter are exactly the kind of logic that looks
 * obviously right and is quietly wrong — off by one on the last attempt, a weak
 * PIN that slips through, a lockout that can be escaped by reopening the app —
 * and none of those failures announce themselves.
 */
object QuickLoginPolicy {

    /** Exactly four digits, because that is what the product asked for. */
    const val PIN_LENGTH = 4

    /**
     * How many wrong PINs before Quick Login gives up.
     *
     * Five is the figure the specification suggests and it is a reasonable one:
     * enough that a driver with cold hands on a dark morning is not punished
     * for fumbling, few enough that guessing all ten thousand combinations is
     * hopeless.
     */
    const val MAX_ATTEMPTS = 5

    /** What a PIN can be wrong about. */
    sealed interface PinVerdict {
        data object Acceptable : PinVerdict

        /** Not four digits, or not digits at all. */
        data class Malformed(val reason: String) : PinVerdict

        /** Well-formed but guessable. */
        data class TooWeak(val reason: String) : PinVerdict
    }

    /**
     * Whether a PIN may be used.
     *
     * The weak-PIN rules exist because a four-digit space is small and people
     * do not choose from it evenly: `1234` and `0000` alone account for a
     * remarkable share of real PINs. Refusing the obvious handful costs a
     * driver one retry and removes the guesses an opportunist would try first.
     *
     * Deliberately a short list rather than a long one. A driver who cannot
     * find an acceptable PIN writes it on the dashboard, which is worse than
     * any of the PINs this rejects.
     */
    fun evaluate(pin: String): PinVerdict {
        if (pin.length != PIN_LENGTH || !pin.all { it.isDigit() }) {
            return PinVerdict.Malformed("Enter exactly four digits.")
        }

        val digits = pin.map { it - '0' }

        if (digits.all { it == digits[0] }) {
            return PinVerdict.TooWeak("Four of the same digit is too easy to guess.")
        }

        val ascending = digits.zipWithNext().all { (a, b) -> b == a + 1 }
        val descending = digits.zipWithNext().all { (a, b) -> b == a - 1 }
        if (ascending || descending) {
            return PinVerdict.TooWeak("Sequences like 1234 are too easy to guess.")
        }

        // The remaining common choices. `2580` is the middle column of a keypad
        // and is far more popular than chance would suggest.
        if (pin in COMMON) {
            return PinVerdict.TooWeak("That is one of the most commonly used PINs.")
        }

        return PinVerdict.Acceptable
    }

    /** What should happen after a wrong PIN. */
    sealed interface AttemptOutcome {
        /** Wrong, but there are tries left. */
        data class Remaining(val attemptsLeft: Int) : AttemptOutcome

        /**
         * Out of tries. Quick Login is discarded and the driver signs in normally.
         *
         * Note what this is *not*: the account is untouched. A local PIN failure
         * must never lock somebody out of Saarthi itself — a driver in a yard at
         * five in the morning would have no way back in, and the fleet would
         * lose a shift to a mistyped PIN.
         */
        data object LockedOut : AttemptOutcome
    }

    /** Where a driver stands after `failures` consecutive wrong PINs. */
    fun outcomeAfter(failures: Int): AttemptOutcome =
        if (failures >= MAX_ATTEMPTS) {
            AttemptOutcome.LockedOut
        } else {
            AttemptOutcome.Remaining(MAX_ATTEMPTS - failures)
        }

    /**
     * How long to wait before the next attempt is accepted.
     *
     * Progressive, and enforced by a stored timestamp rather than a timer in
     * memory: a delay a driver could escape by force-stopping the app would
     * only slow down the honest.
     *
     * The first two mistakes cost nothing, because they are almost always
     * genuine mistakes. After that the wait grows, which makes a machine
     * working through the space hopeless long before the fifth attempt ends it.
     */
    fun cooldownMillisAfter(failures: Int): Long = when (failures) {
        0, 1, 2 -> 0L
        3 -> 15_000L
        else -> 60_000L
    }

    private val COMMON = setOf("1122", "1212", "2580", "1004", "2000", "6969", "1313")
}
