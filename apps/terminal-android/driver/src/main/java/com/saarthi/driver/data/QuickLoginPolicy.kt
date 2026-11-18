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

    // Quick Login is retired (see `QuickLoginStore`): no PIN can be created any
    // more, so only the rules the one last unlock still enforces remain.

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
}
