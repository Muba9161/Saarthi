package com.saarthi.core.data

import com.saarthi.core.domain.AssistantState
import com.saarthi.core.domain.VoiceClassifier
import com.saarthi.core.domain.VoiceIntent
import com.saarthi.core.network.AskTurn
import com.saarthi.core.network.SaarthiApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** One question to Saarthi and the answer it gave. */
data class AssistantExchange(
    val question: String,
    val answer: String,
    val caveats: List<String> = emptyList(),
    val sources: List<String> = emptyList(),
)

/**
 * What the assistant shows.
 *
 * [transcript] and [answer] are the exchange in hand; [earlier] are the ones
 * before it in this conversation, oldest first. [failed] marks an answer that
 * is an apology rather than Saarthi's reply, so it is never sent back as part
 * of the conversation.
 */
data class AssistantUi(
    val state: AssistantState = AssistantState.IDLE,
    val transcript: String? = null,
    val answer: String? = null,
    val caveats: List<String> = emptyList(),
    val sources: List<String> = emptyList(),
    val failed: Boolean = false,
    val earlier: List<AssistantExchange> = emptyList(),
)

/**
 * A conversation with Saarthi, as the web chat holds one.
 *
 * Two things the single question-and-answer card it replaces could not do:
 *
 *  * **Remember.** Each question goes with the conversation so far, so "and
 *    the one after that?" means something — the same history the web chat
 *    sends, held for as long as the assistant is open.
 *  * **Let go.** A question can be stopped, and closing the assistant stops it.
 *    The card used to keep waiting after it was closed, and the late answer was
 *    then read aloud to a driver who had already moved on.
 *
 * Emergency intent is classified here, on the device, before any network call
 * — see [VoiceClassifier] for why. Everything else goes to Saarthi under the
 * signed-on driver's own permissions.
 */
class AssistantConversation(
    private val scope: CoroutineScope,
    private val repository: TerminalRepository,
    /**
     * Raise an emergency. [fresh] is false when the server confirmed the one the
     * phone already raised, so both arrive as a single event rather than two.
     */
    private val raiseSos: (fresh: Boolean) -> Unit,
) {

    private val _ui = MutableStateFlow(AssistantUi())
    val ui: StateFlow<AssistantUi> = _ui.asStateFlow()

    private var pending: Job? = null

    fun setState(state: AssistantState) {
        _ui.update { it.copy(state = state) }
    }

    fun ask(question: String, spoken: Boolean) {
        when (VoiceClassifier.classify(question)) {
            VoiceIntent.SOS -> {
                pending?.cancel()
                _ui.value = AssistantUi(
                    state = AssistantState.SPEAKING,
                    transcript = question,
                    answer = SOS_ANSWER,
                    earlier = settled(),
                )
                raiseSos(true)
                return
            }
            VoiceIntent.CANCEL -> {
                dismiss()
                return
            }
            else -> Unit
        }

        val cleaned = VoiceClassifier.stripWakePhrase(question)
        val earlier = settled()
        pending?.cancel()
        _ui.value = AssistantUi(state = AssistantState.THINKING, transcript = cleaned, earlier = earlier)

        pending = scope.launch {
            val outcome = repository.ask(cleaned, spoken, historyOf(earlier))
            // Closed or stopped while Saarthi was working on it: the answer is
            // nobody's any more, and must not appear or be spoken.
            ensureActive()
            outcome
                .onSuccess { response ->
                    when (response.action) {
                        // The server also recognised an emergency. Belt and braces:
                        // both sides classify, and either one firing is enough.
                        "TRIGGER_SOS" -> raiseSos(false)
                        "DISMISS" -> {
                            dismiss()
                            return@launch
                        }
                    }
                    _ui.value = AssistantUi(
                        state = AssistantState.SPEAKING,
                        transcript = cleaned,
                        answer = response.answer,
                        caveats = response.caveats,
                        sources = response.sources.map { it.tool },
                        earlier = earlier,
                    )
                }
                .onFailure { error ->
                    _ui.value = AssistantUi(
                        state = AssistantState.ERROR,
                        transcript = cleaned,
                        answer = when (error) {
                            is SaarthiApi.Failure.Offline -> OFFLINE_ANSWER
                            else -> error.message ?: FAILED_ANSWER
                        },
                        failed = true,
                        earlier = earlier,
                    )
                }
        }
    }

    /** Stop waiting for an answer and go quiet, keeping the conversation on screen. */
    fun stop() {
        pending?.cancel()
        pending = null
        _ui.update { it.copy(state = AssistantState.IDLE) }
    }

    /** Stop, and forget the conversation — the assistant was closed. */
    fun dismiss() {
        pending?.cancel()
        pending = null
        _ui.value = AssistantUi()
    }

    /** The conversation so far, with the exchange in hand added once it has a real answer. */
    private fun settled(): List<AssistantExchange> {
        val now = _ui.value
        val question = now.transcript
        val answer = now.answer
        val all = if (question != null && answer != null && !now.failed) {
            now.earlier + AssistantExchange(question, answer, now.caveats, now.sources)
        } else {
            now.earlier
        }
        return all.takeLast(KEPT_EXCHANGES)
    }

    private fun historyOf(exchanges: List<AssistantExchange>): List<AskTurn> =
        exchanges
            .flatMap { listOf(AskTurn(ROLE_USER, it.question), AskTurn(ROLE_ASSISTANT, it.answer)) }
            .filter { it.content.isNotBlank() }
            .map { it.copy(content = it.content.take(MAX_TURN_CHARS)) }
            .takeLast(HISTORY_LIMIT)

    private companion object {
        const val SOS_ANSWER = "Raising an emergency now. Stay where you are and stay safe."
        const val OFFLINE_ANSWER = "I cannot reach Saarthi right now. I will be able to answer once there is signal."
        const val FAILED_ANSWER = "I could not answer that."

        const val ROLE_USER = "user"
        const val ROLE_ASSISTANT = "assistant"

        /** The server's own limits: `AI_HISTORY_LIMIT` messages of at most 4,000 characters. */
        const val HISTORY_LIMIT = 10
        const val MAX_TURN_CHARS = 4_000

        /** Enough to scroll back through a conversation in a cab, not a transcript of the shift. */
        const val KEPT_EXCHANGES = 20
    }
}
