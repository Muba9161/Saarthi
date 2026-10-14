package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Saarthi's goods catalogue: what a typed "20mm aggregate" is, and the details
 * that kind of goods needs.
 *
 * A seller's listing and a customer's material need are matched by the
 * category this puts them in, so both are read through it before they are
 * saved — as the web does.
 */
class CommerceApi(private val api: OwnerApi) {

    @Serializable
    data class Node(val id: String = "", val name: String = "")

    @Serializable
    data class CategoryRef(val id: String, val name: String = "", val isFallback: Boolean = false, val path: List<Node> = emptyList()) {
        val pathWords: String get() = path.joinToString(" › ") { it.name }.ifBlank { name }
    }

    /** One detail a category asks for. [type] is TEXT, NUMBER, SELECT or BOOLEAN. */
    @Serializable
    data class Field(
        val key: String,
        val label: String = "",
        val type: String = "TEXT",
        val required: Boolean = false,
        val unit: String? = null,
        val options: List<String> = emptyList(),
        val sortOrder: Int = 0,
    )

    @Serializable
    data class Interpretation(
        val category: CategoryRef? = null,
        /** HIGH, MEDIUM or LOW. */
        val confidence: String = "LOW",
        val alternatives: List<CategoryRef> = emptyList(),
        val fields: List<Field> = emptyList(),
        val attributes: Map<String, JsonPrimitive> = emptyMap(),
    )

    @Serializable
    data class Category(
        val id: String,
        val parentId: String? = null,
        val name: String = "",
        val status: String = "ACTIVE",
        val isFallback: Boolean = false,
        val sortOrder: Int = 0,
    )

    /**
     * Read [text] as a [scope] — PRODUCT for a seller's listing, REQUIREMENT
     * for a customer's need. What the person already chose is passed back as
     * locked, and the server never overrides it.
     */
    suspend fun interpret(
        text: String,
        scope: String,
        lockedCategoryId: String? = null,
        lockedAttributes: Map<String, JsonPrimitive> = emptyMap(),
    ): Interpretation? {
        val body = buildJsonObject {
            put("text", text.trim().take(500))
            put("scope", scope)
            if (lockedCategoryId != null || lockedAttributes.isNotEmpty()) {
                put(
                    "locked",
                    buildJsonObject {
                        lockedCategoryId?.let { put("categoryId", it) }
                        if (lockedAttributes.isNotEmpty()) put("attributes", JsonObject(lockedAttributes))
                    },
                )
            }
        }
        return api.post("/commerce/interpret", body.toString(), Interpretation.serializer())
    }

    /** Every category, flat, each pointing at its parent. */
    suspend fun categories(): List<Category> =
        api.get("/commerce/categories", ListSerializer(Category.serializer())).orEmpty()

    companion object {
        const val SCOPE_PRODUCT = "PRODUCT"
        const val SCOPE_REQUIREMENT = "REQUIREMENT"
    }
}
