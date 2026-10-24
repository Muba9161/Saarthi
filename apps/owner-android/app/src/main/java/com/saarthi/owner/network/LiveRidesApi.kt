package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.net.URLEncoder

/**
 * Share my ride, from the family's side.
 *
 * Somebody travelling in a vehicle that is not on Saarthi shares where they
 * are with family by mobile number or email; a family member who uses Saarthi is told,
 * with a live link. The link's token is the only key — the server needs no
 * sign-in for it — and it shows a first name, the vehicle's number if one was
 * typed, and where they are and the road they have covered while sharing. Once the rider stops, or the share
 * runs out, it says so and shows nobody's whereabouts.
 */
class LiveRidesApi(private val api: OwnerApi) {

    /** Where the rider's phone last was. */
    @Serializable
    data class Position(
        val latitude: Double,
        val longitude: Double,
        val speedKph: Double? = null,
        val heading: Double? = null,
        val recordedAt: String = "",
    )

    /** A point on the road covered — `RideTrailPoint`, coloured as a vehicle with no trip. */
    @Serializable
    data class TrailPoint(
        val latitude: Double,
        val longitude: Double,
        val recordedAt: String = "",
        val routeState: String? = null,
    )

    /** `PublicLiveRide`: what the live link shows. */
    @Serializable
    data class LiveRide(
        /** The rider's first name. */
        val riderName: String = "",
        /** As stored, "UP32AB1234"; null when the rider typed none. */
        val registrationNumber: String? = null,
        /** [SHARING] or [ENDED]. */
        val status: String = "",
        val startedAt: String = "",
        val endedAt: String? = null,
        /** Null before the first fix, and always once the ride has ended. */
        val position: Position? = null,
        /** The road covered — after [get]'s `from` when one was given. Empty once ended. */
        val trail: List<TrailPoint> = emptyList(),
    )

    /**
     * The ride behind a live link; [from], the last point already held, asks
     * for only the road covered since. A link that does not exist is refused
     * with a 404.
     */
    suspend fun get(token: String, from: String? = null): LiveRide? =
        api.get(
            "/public/live/${URLEncoder.encode(token, "UTF-8")}" + (from?.let { "?from=${URLEncoder.encode(it, "UTF-8")}" } ?: ""),
            LiveRide.serializer(),
        )

    /** `RideSharedWithMe`: a ride somebody is sharing with this person right now. */
    @Serializable
    data class RideSharedWithMe(
        val id: String,
        /** The live link's token: [get] reads the same ride with it. */
        val token: String = "",
        /** The rider's full name. */
        val riderName: String = "",
        val registrationNumber: String? = null,
        val startedAt: String = "",
        val expiresAt: String = "",
        /** Null until the rider's phone sends its first fix. */
        val position: Position? = null,
        /** The viewer's own ride, shared from Humsafar with "Show on my owner app". */
        val mine: Boolean = false,
    )

    /**
     * Rides being shared with this person — they were named by mobile number —
     * newest first, with their own rides from Humsafar. The server decides
     * which: their own on any plan, other people's on a Personal plan. Ended
     * rides drop out.
     */
    suspend fun sharedWithMe(): List<RideSharedWithMe> =
        api.get("/ride-shares/shared-with-me", ListSerializer(RideSharedWithMe.serializer())).orEmpty()
            .filter { it.token.isNotBlank() }

    companion object {
        const val SHARING = "SHARING"
        const val ENDED = "ENDED"
    }
}
