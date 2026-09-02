package com.saarthi.terminal.domain

/**
 * What the driver said, before a model sees it.
 *
 * A mirror of `classifyVoiceUtterance` in
 * `packages/shared/src/domain/terminal.ts`, run again here rather than only on
 * the server, and the duplication is deliberate: the whole point is that an
 * emergency does not wait for a network round trip.
 *
 * "Hey Saarthi, SOS" from a driver who has just been hit must reach the
 * emergency workflow in the time it takes to speak the next word. Sending the
 * phrase to a server, waiting for a language model to interpret it and then
 * acting is several seconds on a good connection and never on a bad one — and
 * the connection in an accident is frequently the bad one. So the phrase is
 * recognised on the device, the emergency endpoint is called directly, and the
 * assistant is not involved at all.
 *
 * Everything else falls through to [ASK], goes to Saarthi, and is answered by
 * Gemini through the controlled tool layer.
 */
enum class VoiceIntent {
    /** Emergency. Handled locally and immediately. */
    SOS,

    /** "Cancel", "stop", silence. Dismiss the assistant. */
    CANCEL,

    /** A real question. Goes to Saarthi. */
    ASK,
}

object VoiceClassifier {

    /** The wake phrase, matching `TERMINAL_WAKE_PHRASE` in the shared package. */
    const val WAKE_PHRASE = "hey saarthi"

    /**
     * Phrases that mean an emergency.
     *
     * Hindi alongside English because the drivers this is for speak both, often
     * in the same sentence, and a system that only hears "help" is one that does
     * not hear "bachao".
     */
    private val SOS_PHRASES = listOf(
        listOf("sos"),
        listOf("emergency"),
        listOf("help", "me"),
        listOf("accident"),
        listOf("madad"),
        listOf("bachao"),
    )

    private val CANCEL_PHRASES = setOf("cancel", "stop", "never mind", "nevermind", "chodo")

    /**
     * Classify an utterance.
     *
     * Matched on whole words rather than substrings. "No SOS" and "sostenuto"
     * are not emergencies, and a `contains` check cannot tell them from one —
     * which matters in both directions: a false emergency wastes a responder's
     * time and teaches a fleet to distrust the alarm.
     */
    fun classify(utterance: String): VoiceIntent {
        val text = utterance.trim().lowercase()
        if (text.isEmpty()) return VoiceIntent.CANCEL

        val stripped = if (text.startsWith(WAKE_PHRASE)) {
            text.removePrefix(WAKE_PHRASE).trim()
        } else {
            text
        }
        if (stripped.isEmpty()) return VoiceIntent.CANCEL

        val words = stripped.split(Regex("[^a-z]+")).filter { it.isNotEmpty() }.toSet()

        if (SOS_PHRASES.any { phrase -> phrase.all { it in words } }) return VoiceIntent.SOS
        if (stripped in CANCEL_PHRASES) return VoiceIntent.CANCEL

        return VoiceIntent.ASK
    }

    /** Whether a heard phrase contains the wake word at all. */
    fun containsWakePhrase(utterance: String): Boolean =
        utterance.trim().lowercase().contains(WAKE_PHRASE)

    /** The question with the wake phrase removed, for sending on. */
    fun stripWakePhrase(utterance: String): String {
        val text = utterance.trim()
        val index = text.lowercase().indexOf(WAKE_PHRASE)
        if (index < 0) return text
        return text.substring(index + WAKE_PHRASE.length)
            .trimStart(' ', ',', '.', '!', '?')
            .trim()
    }
}

/** The AI surface's visual state (specification section 34). */
enum class AssistantState {
    IDLE,
    LISTENING,
    THINKING,
    SPEAKING,
    ERROR,
}
