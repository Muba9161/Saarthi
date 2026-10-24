package com.saarthi.driver.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Riding along: sharing a ride with family.
 *
 * A person travelling in a vehicle they are not driving — a cab, an auto, a
 * friend's car — names the vehicle and the family who should see them, and
 * their phone shares where it is until they stop. Nobody approves anything:
 * family named by number are told if they use Saarthi, and a link to a live
 * page reaches everybody else.
 *
 * A person asking, so this speaks through [DriverApi] with the signed-in
 * account, like [OwnerRcApi] — and never through the terminal pairing. The
 * fixes are the exception: they carry the share's own reporting key, so they
 * keep flowing after the sign-in lapses in a pocket.
 */
class RideSharesApi(private val api: DriverApi) {

    /**
     * Whether this account may ride along — the server decides who may — and
     * whether the same login also holds an owner account, on whose owner app
     * the rider can show their own ride.
     */
    @Serializable
    data class Access(val rideAlong: Boolean = false, val hasOwnerAccount: Boolean = false)

    /** Where the phone last was, as family see it. */
    @Serializable
    data class LastLocation(
        val latitude: Double,
        val longitude: Double,
        val speedKph: Double? = null,
        val heading: Double? = null,
        val recordedAt: String? = null,
    )

    /** `RideShareView` on the server — the rider's own view of their share. */
    @Serializable
    data class ShareView(
        val id: String,
        /** `SHARING` or `ENDED`. */
        val status: String,
        /** The vehicle's number, as the rider typed it. */
        val registrationNumber: String? = null,
        val startedAt: String? = null,
        /** When the server ends it by itself — twelve hours after it started. */
        val expiresAt: String? = null,
        val endedAt: String? = null,
        /** The live page to send to family, in full. */
        val link: String = "",
        /**
         * The named numbers that belong to Saarthi users. Never shown: listing
         * them would tell the rider which of their family have an account.
         */
        val contacts: List<String> = emptyList(),
        /** While sharing, the key this phone reports with — good for this share only. */
        val reportingToken: String? = null,
        val lastLocation: LastLocation? = null,
        /** Also shown live on the rider's own owner account — the owner app, same login. */
        val sharedWithSelf: Boolean = false,
    )

    /** One fix from the rider's phone. */
    @Serializable
    data class Point(
        val latitude: Double,
        val longitude: Double,
        val speedKph: Double? = null,
        val heading: Double? = null,
        val accuracy: Double? = null,
        /** ISO-8601, when the phone took the fix. */
        val recordedAt: String,
    )

    /** How many fixes an upload landed. */
    @Serializable
    data class Reported(val accepted: Int = 0)

    @Serializable
    private data class StartRequest(
        val registrationNumber: String,
        val contacts: List<String> = emptyList(),
        val shareWithSelf: Boolean = false,
    )

    @Serializable
    private data class ContactRequest(val contact: String)

    @Serializable
    private data class Points(val points: List<Point>)

    /** Whether riding along is offered to this account. Asked once a session. */
    suspend fun access(): Access? = api.get("/api/v1/ride-shares/access", Access.serializer())

    /**
     * Start sharing the ride in this vehicle, telling these numbers — and,
     * with [shareWithSelf], showing it on the rider's own owner app too.
     *
     * Asking while a share is already on returns that same share with these
     * numbers added, so a retry after a dropped connection is harmless.
     */
    suspend fun start(registrationNumber: String, contacts: List<String>, shareWithSelf: Boolean): ShareView =
        api.post(
            "/api/v1/ride-shares",
            Bodies.encodeToString(
                StartRequest.serializer(),
                StartRequest(registrationNumber, contacts, shareWithSelf),
            ),
            ShareView.serializer(),
        )

    /** The share on now, if any. Null once it has ended — stopped, or out of time. */
    suspend fun mine(): ShareView? = api.get("/api/v1/ride-shares/mine", ShareView.serializer())

    /** Tell one more person, by mobile number or email address. */
    suspend fun addContact(shareId: String, contact: String): ShareView =
        api.post(
            "/api/v1/ride-shares/$shareId/contacts",
            Bodies.encodeToString(ContactRequest.serializer(), ContactRequest(contact)),
            ShareView.serializer(),
        )

    /**
     * Show the share on the rider's own owner app as well. Saying it twice is
     * fine; refused with 422 when the login holds no owner account, and 409
     * once the share has ended.
     */
    suspend fun showToSelf(shareId: String): ShareView =
        api.post("/api/v1/ride-shares/$shareId/self", "{}", ShareView.serializer())

    /** Stop sharing. Saying it twice is fine. */
    suspend fun end(shareId: String): ShareView =
        api.post("/api/v1/ride-shares/$shareId/end", "{}", ShareView.serializer())

    /**
     * Send the phone's latest fixes, with the share's reporting key and no
     * sign-in. Refused with 401 for a wrong key and 409 once the share is over.
     */
    suspend fun report(shareId: String, reportingKey: String, points: List<Point>): Reported =
        api.postWith(
            RIDE_KEY_HEADER to reportingKey,
            "/api/v1/ride-shares/$shareId/report",
            Bodies.encodeToString(Points.serializer(), Points(points)),
            Reported.serializer(),
        )

    private companion object {
        const val RIDE_KEY_HEADER = "X-Ride-Token"

        /**
         * An absent reading is left out rather than sent as null: the server's
         * schema takes a missing position or speed, and refuses a null one.
         */
        val Bodies = Json { explicitNulls = false }
    }
}
