package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * How a person likes a list laid out, kept on the server per screen ("surface")
 * so the choice follows them between the web and this app. The same store the
 * web's table/card toggle writes to.
 */
class PreferencesApi(private val api: OwnerApi) {

    @Serializable
    data class ViewPreference(val surface: String, val viewMode: String = TABLE)

    /** The saved layout for [surface], or null when the person never chose one. */
    suspend fun viewMode(surface: String): String? =
        api.get("/me/view-preferences", ListSerializer(ViewPreference.serializer()))
            ?.firstOrNull { it.surface == surface }
            ?.viewMode

    suspend fun setViewMode(surface: String, mode: String) {
        api.put("/me/view-preferences/$surface", buildJsonObject { put("viewMode", mode) }.toString(), ViewPreference.serializer())
    }

    companion object {
        /** A compact row per item: the web's table. */
        const val TABLE = "TABLE"
        const val CARDS = "CARDS"

        const val VEHICLES = "fleet.vehicles"
    }
}
