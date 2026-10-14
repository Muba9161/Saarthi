package com.saarthi.owner.network

import kotlinx.serialization.Serializable

/**
 * "Ask Saarthi" — the same assistant the web app runs, answering from the
 * business's own records. Text only here: the app carries no microphone.
 */
class AssistantApi(private val api: OwnerApi) {

    @Serializable
    data class Turn(val role: String, val content: String)

    @Serializable
    private data class ChatRequest(val message: String, val history: List<Turn>, val conversationId: String? = null)

    @Serializable
    data class Reference(val type: String = "", val id: String = "", val label: String = "")

    @Serializable
    data class Reply(
        val conversationId: String? = null,
        val answer: String = "",
        val references: List<Reference> = emptyList(),
    )

    suspend fun ask(message: String, history: List<Turn>, conversationId: String?): Reply? =
        api.post(
            "/ai/chat",
            api.json.encodeToString(ChatRequest.serializer(), ChatRequest(message, history.takeLast(HISTORY), conversationId)),
            Reply.serializer(),
        )

    private companion object {
        /** The server keeps a short memory; sending more is refused. */
        const val HISTORY = 10
    }
}
