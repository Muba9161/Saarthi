package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * What the Account screen shows beyond the session: the profile as the web's
 * profile page holds it, where verification stands, and the plan.
 *
 * Read from the endpoints the web's own settings pages read, so the app can
 * never show a different phone number, verification state or renewal date.
 * Read-only: changes are made on the web.
 */
class AccountApi(private val api: OwnerApi) {

    /** `profile.service.ts` `ProfileBuilderView`, as far as a read-only view needs it. */
    @Serializable
    data class Profile(
        val sections: List<Section> = emptyList(),
        /** Keyed `sectionKey.fieldKey`; strings, numbers, lists or small objects. */
        val values: JsonObject = JsonObject(emptyMap()),
        val completion: Completion = Completion(),
    )

    @Serializable
    data class Section(val key: String, val title: String = "", val fields: List<Field> = emptyList())

    @Serializable
    data class Field(
        val key: String,
        val label: String = "",
        /** `TEXT`, `PHONE`, `ADDRESS`, `SELECT`, `GEO`, `IMAGE`… */
        val kind: String = "TEXT",
        val options: List<Option> = emptyList(),
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

    suspend fun plan(): Plan? = api.get("/subscriptions/plan", Plan.serializer())

    suspend fun verification(): Verification? = api.get("/verification-center", Verification.serializer())

    companion object {
        /** The permissions the web checks before showing the same panels. */
        const val SUBSCRIPTION_READ = "subscription.read"
        const val VERIFICATION_READ = "verification.read"
    }
}
