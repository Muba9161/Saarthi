package com.saarthi.terminal

import com.saarthi.terminal.domain.VoiceClassifier
import com.saarthi.terminal.domain.VoiceIntent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The on-device voice classifier.
 *
 * This is a *duplicate* of `classifyVoiceUtterance` in
 * `packages/shared/src/domain/terminal.ts`, and the duplication is deliberate:
 * an emergency must be recognised without a network round trip. Duplication is
 * also exactly where two implementations quietly drift apart, so this file
 * mirrors the TypeScript test case for case. If one of these ever passes while
 * the other fails, that divergence is the bug.
 *
 * The stakes are asymmetric and the tests are written accordingly. A missed
 * emergency is somebody not getting help. A false one costs a responder a
 * journey and teaches a fleet to distrust the alarm. Both matter; the first
 * matters more, which is why the recognised phrase list is generous and the
 * matching is whole-word.
 */
class VoiceClassifierTest {

    @Test
    fun `recognises an emergency in English and Hindi`() {
        val emergencies = listOf(
            "hey saarthi sos",
            "SOS",
            "hey saarthi emergency",
            "accident",
            "bachao",
            "madad",
            "help me",
            "Hey Saarthi, I need help me now",
        )

        for (phrase in emergencies) {
            assertEquals(
                "\"$phrase\" should be an emergency",
                VoiceIntent.SOS,
                VoiceClassifier.classify(phrase),
            )
        }
    }

    @Test
    fun `does not mistake an ordinary word for an emergency`() {
        // Whole-word matching. A substring test fires on "sostenuto" and gains
        // nothing, so it trades false alarms for no benefit at all.
        val ordinary = listOf(
            "hey saarthi find the nearest sostenuto",
            "hey saarthi what is my fuel level",
            "how far is my destination",
            "when is my next service",
            "is my fitness certificate valid",
        )

        for (phrase in ordinary) {
            assertEquals(
                "\"$phrase\" should be an ordinary question",
                VoiceIntent.ASK,
                VoiceClassifier.classify(phrase),
            )
        }
    }

    @Test
    fun `treats silence and cancellation as a dismissal`() {
        for (phrase in listOf("", "   ", "hey saarthi", "cancel", "stop", "never mind")) {
            assertEquals(VoiceIntent.CANCEL, VoiceClassifier.classify(phrase))
        }
    }

    @Test
    fun `strips the wake phrase without eating the question`() {
        assertEquals(
            "find truck parking near me",
            VoiceClassifier.stripWakePhrase("Hey Saarthi, find truck parking near me"),
        )
        assertEquals(
            "what is my fuel level",
            VoiceClassifier.stripWakePhrase("hey saarthi what is my fuel level"),
        )
        // No wake phrase — the text comes back whole, because the tap-the-blob
        // path produces utterances that never had one.
        assertEquals(
            "what is my fuel level",
            VoiceClassifier.stripWakePhrase("what is my fuel level"),
        )
    }

    @Test
    fun `detects the wake phrase anywhere in a recognised string`() {
        // The recogniser prepends and appends noise constantly. Anchoring the
        // match to the start of the string would mean the wake word only works
        // in a quiet cab, which is not where this ships.
        assertTrue(VoiceClassifier.containsWakePhrase("okay hey saarthi find fuel"))
        assertTrue(VoiceClassifier.containsWakePhrase("HEY SAARTHI"))
        assertFalse(VoiceClassifier.containsWakePhrase("hey sarathi"))
        assertFalse(VoiceClassifier.containsWakePhrase("saarthi"))
    }
}
