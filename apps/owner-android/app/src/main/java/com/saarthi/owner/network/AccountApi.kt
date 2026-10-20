package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * What the Account screen shows beyond the session: the profile as the web's
 * profile page holds it, where verification stands, and the plan.
 *
 * Read from the endpoints the web's own settings pages read, so the app can
 * never show a different phone number, verification state or renewal date.
 * The profile and the password are changed here the way the web changes
 * them; plans and verification stay on the web.
 */
class AccountApi(private val api: OwnerApi) {

    /** `profile.service.ts` `ProfileBuilderView`. */
    @Serializable
    data class Profile(
        val sections: List<Section> = emptyList(),
        /** Keyed `sectionKey.fieldKey`; strings, numbers, lists or small objects. A photo is its media id. */
        val values: JsonObject = JsonObject(emptyMap()),
        val completion: Completion = Completion(),
        /** Whether this person may change the business's own fields, such as its GSTIN. */
        val canEditOrganization: Boolean = false,
        val organizationId: String? = null,
    ) {
        fun valueOf(section: Section, field: Field): JsonElement? = values["${section.key}.${field.key}"]
    }

    @Serializable
    data class Section(val key: String, val title: String = "", val fields: List<Field> = emptyList())

    @Serializable
    data class Field(
        val key: String,
        val label: String = "",
        /** `TEXT`, `PHONE`, `ADDRESS`, `SELECT`, `GEO`, `IMAGE`… */
        val kind: String = "TEXT",
        val options: List<Option> = emptyList(),
        val required: Boolean = false,
        val help: String? = null,
        val placeholder: String? = null,
        val maxLength: Int? = null,
        val min: Double? = null,
        val max: Double? = null,
        /** The business's field, not the person's: only an owner or admin changes it. */
        val organizationScoped: Boolean = false,
        /** For a photo: what it is in the media library — `AVATAR`, `LOGO`, `COVER`. */
        val mediaPurpose: String? = null,
    )

    @Serializable
    data class Option(val value: String, val label: String = "")

    @Serializable
    data class Completion(val percent: Int = 0)

    /** `plan.service.ts` `PlanSummary`. */
    @Serializable
    data class Plan(
        val name: String = "",
        val status: String = "",
        val billingPeriod: String = "",
        val endsAt: String? = null,
        val usage: Usage = Usage(),
    )

    @Serializable
    data class Usage(val vehicles: Int = 0, val members: Int = 0, val drivers: Int = 0)

    /** `verification-center.ts` `VerificationCenterView`. */
    @Serializable
    data class Verification(val overall: String = "", val steps: List<Step> = emptyList())

    @Serializable
    data class Step(
        val id: String,
        val title: String = "",
        val state: String = "",
        /** The masked number or reference of what was verified. */
        val reference: String? = null,
        val verifiedAt: String? = null,
    )

    suspend fun profile(): Profile? = api.get("/profile/builder", Profile.serializer())

    /** Save one section: only the fields given are changed; a null clears one. */
    suspend fun saveSection(sectionKey: String, values: Map<String, JsonElement>) {
        val body = buildJsonObject { put("values", JsonObject(values)) }
        api.patch("/profile/builder/$sectionKey", body.toString(), JsonObject.serializer())
    }

    /**
     * A profile photo or business logo, through the media library as the web
     * sends it. One of each is kept: a new one replaces the last.
     */
    /** Returns the new photo's media id. */
    suspend fun uploadImage(ownerType: String, ownerId: String, purpose: String, file: OwnerApi.Upload): String? {
        val fields = mapOf("ownerType" to ownerType, "ownerId" to ownerId, "purpose" to purpose)
        return api.upload("/media", fields, "file", file, Uploaded.serializer())?.id
    }

    @Serializable
    private data class Uploaded(val id: String = "")

    suspend fun image(mediaId: String, thumbnail: Boolean = true): ByteArray? =
        api.image("/api/v1/media/$mediaId/file?variant=${if (thumbnail) "thumb" else "original"}")

    /**
     * Change the password. Every other signed-in device is signed out by the
     * server; this one stays signed in.
     */
    suspend fun changePassword(current: String, new: String) {
        val body = buildJsonObject {
            put("currentPassword", current)
            put("newPassword", new)
        }
        api.post("/auth/change-password", body.toString(), JsonObject.serializer())
    }

    suspend fun plan(): Plan? = api.get("/subscriptions/plan", Plan.serializer())

    suspend fun verification(): Verification? = api.get("/verification-center", Verification.serializer())

    companion object {
        /** The permissions the web checks before showing the same panels. */
        const val SUBSCRIPTION_READ = "subscription.read"
        const val VERIFICATION_READ = "verification.read"
    }
}
