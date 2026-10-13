package com.saarthi.driver.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.net.URLEncoder

/**
 * The full RC, for an owner who drives their own vehicle.
 *
 * The Papers tab's RC arrives over the vehicle's device link and is always
 * masked: a terminal is not a person, and whoever is signed on to it is
 * usually not the registered owner. An owner signed in to this app is a
 * person, and the web already shows them the full record once they enter their
 * Secure PIN — so this asks the same two endpoints the web does, with the
 * owner's own sign-in. The server decides everything: ownership of this
 * vehicle, the PIN, and how long the unlock lasts.
 *
 * Nothing here is written to the phone. The full record lives in memory for as
 * long as it is on screen.
 */
class OwnerRcApi(private val api: DriverApi) {

    @Serializable
    data class RcOwner(
        val name: String? = null,
        val fatherName: String? = null,
        val mobileNumber: String? = null,
        val presentAddress: String? = null,
        val permanentAddress: String? = null,
    )

    /** The fields the masked RC hides, which are the only ones this adds. */
    @Serializable
    data class RcRecord(
        val owner: RcOwner? = null,
        val chassisNumber: String? = null,
        val engineNumber: String? = null,
        val insurancePolicyNumber: String? = null,
    )

    /** `vehicle-rc.ts` `VehicleLookupResult`, as far as this needs it. */
    @Serializable
    data class Lookup(val access: String = "", val vehicle: RcRecord? = null)

    @Serializable
    private data class UnlockRequest(val pin: String)

    @Serializable
    data class Unlocked(val unlockedUntil: String)

    /** The stored RC for this plate, full or masked as the server decides. Never a paid lookup. */
    suspend fun latest(registrationNumber: String): Lookup? =
        api.get(
            "/api/v1/vehicles/lookups/latest?registrationNumber=" + URLEncoder.encode(registrationNumber, "UTF-8"),
            Lookup.serializer(),
        )

    /** Enter the Secure PIN: the web's own unlock, for this sign-in only. */
    suspend fun unlock(pin: String): Unlocked =
        api.post(
            "/api/v1/security/unlock/pin",
            Bodies.encodeToString(UnlockRequest.serializer(), UnlockRequest(pin)),
            Unlocked.serializer(),
        )

    companion object {
        /** The record is shown whole only to an owner who has entered the PIN. */
        const val FULL = "FULL"
        const val LOCKED = "LOCKED"

        /** Ownership of this vehicle is not confirmed yet — done on the web, against the RC. */
        const val OWNERSHIP_REQUIRED = "OWNERSHIP_REQUIRED"

        private val Bodies = Json
    }
}
