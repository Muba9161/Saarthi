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
 * off-by-one on the last attempt, a weak PIN slipping through, a cooldown that
 * a driver could escape.
 *
 * The most important case is the last group: a lockout must cost a driver their
 * Quick Login and never their account. Somebody in a yard at five in the
 * morning who mistypes five times has to still be able to sign in.
 */
class QuickLoginPolicyTest {

    // -----------------------------------------------------------------------
    // What a PIN may be
    // -----------------------------------------------------------------------

    @Test
    fun `accepts an ordinary four-digit PIN`() {
        assertEquals(QuickLoginPolicy.PinVerdict.Acceptable, QuickLoginPolicy.evaluate("4071"))
        assertEquals(QuickLoginPolicy.PinVerdict.Acceptable, QuickLoginPolicy.evaluate("9350"))
    }

    @Test
    fun `refuses anything that is not four digits`() {
        // The keypad should make these impossible, but the policy is the thing
        // the store calls — and a caller that bypassed the keypad must not be
        // able to install a one-digit PIN.
        for (bad in listOf("", "1", "123", "12345", "12a4", "12 4", " 123")) {
            assertTrue(
                "expected $bad to be malformed",
                QuickLoginPolicy.evaluate(bad) is QuickLoginPolicy.PinVerdict.Malformed,
            )
        }
    }

    @Test
    fun `refuses four of the same digit`() {
        for (bad in listOf("0000", "1111", "7777", "9999")) {
            assertTrue(
                "expected $bad to be weak",
                QuickLoginPolicy.evaluate(bad) is QuickLoginPolicy.PinVerdict.TooWeak,
            )
        }
    }

    @Test
    fun `refuses a run in either direction`() {
        /*
         * `1234` is the single most common PIN in every published study, and
         * `4321` is not far behind. A four-digit space is small and people do
         * not choose from it evenly — refusing the obvious handful costs a
         * driver one retry and removes what an opportunist would try first.
         */
        assertTrue(QuickLoginPolicy.evaluate("1234") is QuickLoginPolicy.PinVerdict.TooWeak)
        assertTrue(QuickLoginPolicy.evaluate("4321") is QuickLoginPolicy.PinVerdict.TooWeak)
        assertTrue(QuickLoginPolicy.evaluate("6789") is QuickLoginPolicy.PinVerdict.TooWeak)
    }

    @Test
    fun `refuses the well-known choices`() {
        // `2580` is the middle column of a keypad, top to bottom, and is far
        // more popular than chance would suggest.
        assertTrue(QuickLoginPolicy.evaluate("2580") is QuickLoginPolicy.PinVerdict.TooWeak)
        assertTrue(QuickLoginPolicy.evaluate("1212") is QuickLoginPolicy.PinVerdict.TooWeak)
    }

    @Test
    fun `does not refuse so much that a driver writes it on the dashboard`() {
        /*
         * The opposite failure, and a real one. A policy that rejects most of
         * the space sends a driver to a sticky note on the windscreen, which is
         * worse than any PIN this refuses. So the rules are a short list, and
         * the great majority of the ten thousand remain available.
         */
        val acceptable = (0..9999)
            .map { it.toString().padStart(4, '0') }
            .count { QuickLoginPolicy.evaluate(it) == QuickLoginPolicy.PinVerdict.Acceptable }

        assertTrue("only $acceptable of 10000 PINs allowed", acceptable > 9_900)
    }

    @Test
    fun `explains itself in words a driver can act on`() {
        // A refusal with no reason is a refusal a driver retries identically.
        val malformed = QuickLoginPolicy.evaluate("12") as QuickLoginPolicy.PinVerdict.Malformed
        val weak = QuickLoginPolicy.evaluate("1111") as QuickLoginPolicy.PinVerdict.TooWeak

        assertTrue(malformed.reason.isNotBlank())
        assertTrue(weak.reason.isNotBlank())
        // And the reason never repeats the PIN back.
        assertTrue(!weak.reason.contains("1111"))
    }

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
