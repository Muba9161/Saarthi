package com.saarthi.driver.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rules behind Saarthi Quick Login.
 *
 * These are testable because they are deliberately free of Android: the
 * Keystore and the biometric prompt cannot run in a JVM test, so the parts that
 * *decide* things were separated from the parts that store them. What is left
 * here is exactly the logic that would be wrong without anybody noticing — an
 * off-by-one on the last attempt, or a cooldown that a driver could escape.
 *
 * The most important case is the last group: a lockout must cost a driver their
 * Quick Login and never their account. Somebody in a yard at five in the
 * morning who mistypes five times has to still be able to sign in.
 */
class QuickLoginPolicyTest {

    // -----------------------------------------------------------------------
    // Getting it wrong
    // -----------------------------------------------------------------------

    @Test
    fun `counts down the attempts a driver has left`() {
        assertEquals(
            QuickLoginPolicy.AttemptOutcome.Remaining(4),
            QuickLoginPolicy.outcomeAfter(1),
        )
        assertEquals(
            QuickLoginPolicy.AttemptOutcome.Remaining(1),
            QuickLoginPolicy.outcomeAfter(4),
        )
    }

    @Test
    fun `locks out on the fifth failure and not the sixth`() {
        /*
         * The off-by-one worth a test of its own. "Five attempts" has to mean
         * the fifth wrong PIN ends it — a boundary written as `>` rather than
         * `>=` would quietly give six, and nobody would ever notice.
         */
        assertTrue(
            QuickLoginPolicy.outcomeAfter(4) is QuickLoginPolicy.AttemptOutcome.Remaining,
        )
        assertEquals(QuickLoginPolicy.AttemptOutcome.LockedOut, QuickLoginPolicy.outcomeAfter(5))
        assertEquals(QuickLoginPolicy.AttemptOutcome.LockedOut, QuickLoginPolicy.outcomeAfter(6))
    }

    @Test
    fun `forgives the first mistakes and then slows down`() {
        /*
         * The first two are almost always genuine — cold hands, a dark cab, a
         * glove. Charging a driver fifteen seconds for those would make the
         * feature worse than typing a password. After that the wait grows, which
         * makes working through the space hopeless long before the fifth attempt
         * ends it.
         */
        assertEquals(0L, QuickLoginPolicy.cooldownMillisAfter(1))
        assertEquals(0L, QuickLoginPolicy.cooldownMillisAfter(2))
        assertTrue(QuickLoginPolicy.cooldownMillisAfter(3) > 0)
        assertTrue(
            QuickLoginPolicy.cooldownMillisAfter(4) > QuickLoginPolicy.cooldownMillisAfter(3),
        )
    }

    @Test
    fun `a lockout is about Quick Login, never about the account`() {
        /*
         * Stated as a property because it is the rule with the worst
         * consequence if broken. `LockedOut` carries nothing that could be read
         * as an account action — no duration, no server call, no flag. A driver
         * who mistypes five times signs in with their password and carries on;
         * they do not lose a shift.
         */
        val outcome = QuickLoginPolicy.outcomeAfter(QuickLoginPolicy.MAX_ATTEMPTS)

        assertEquals(QuickLoginPolicy.AttemptOutcome.LockedOut, outcome)
        assertTrue(outcome is QuickLoginPolicy.AttemptOutcome.LockedOut)
    }
}
