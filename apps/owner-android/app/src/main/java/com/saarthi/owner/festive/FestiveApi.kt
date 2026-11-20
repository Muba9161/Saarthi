package com.saarthi.owner.festive

import com.saarthi.owner.network.OwnerApi
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.net.URLEncoder

/** The two calls the festive layer makes: the calendar, and the account's Festive looks switch. */
class FestiveApi(private val api: OwnerApi) {

    /**
     * `GET /festive?locale=…`: the festivals ahead with their wishes in [locale].
     * Public, so the sign-in and loading screens can dress before anybody signs in.
     */
    suspend fun calendar(locale: String): FestiveCalendar? =
        api.publicGet("/festive?locale=${URLEncoder.encode(locale, "UTF-8")}", FestiveCalendar.serializer())

    /** Save Festive looks to the account, where the web and the other apps read it too. */
    suspend fun saveLooks(on: Boolean) {
        val body = buildJsonObject { putJsonObject("preferences") { put("festiveLooks", on) } }
        api.patch("/profile/me", body.toString(), JsonObject.serializer())
    }
}
