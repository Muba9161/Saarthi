package com.saarthi.owner.ui.rides

import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.LiveRidesApi
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.map.TrailTone
import com.saarthi.owner.ui.tracking.Fix
import com.saarthi.owner.ui.tracking.FollowRead
import com.saarthi.owner.ui.tracking.FollowSource

/*
 * A live ride followed the way a vehicle is: the road it has covered drawn in
 * the trail's colours, read whole once and then only what is new, and opened
 * full screen on the same screen a followed vehicle uses.
 */

/** The road covered in this read, as the fixes a followed vehicle's road is built from. */
fun LiveRidesApi.LiveRide.fixes(): List<Fix> = trail.map { Fix(it.latitude, it.longitude, it.routeState, it.recordedAt) }

/** A ride has no trip, so its road is named for what it is in the map's key. */
val RIDE_TRAIL_LABELS: Map<TrailTone, String>
    get() = mapOf(TrailTone.NO_TRIP to Words.get(R.string.rides_live_trail))

/** A live ride for the full-screen map, read as a followed vehicle is. */
fun liveRideFollowSource(app: OwnerApp, token: String): FollowSource = FollowSource { since ->
    val ride = app.liveRides.get(token, since) ?: error("The live ride could not be read.")
    FollowRead(
        marker = ride.mapMarker(),
        plate = ride.registrationNumber.orEmpty(),
        seenAt = ride.position?.recordedAt,
        tripId = null,
        trip = null,
        fixes = ride.fixes(),
        readings = null,
    )
}
