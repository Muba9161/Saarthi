package com.saarthi.owner.ui.fleet

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.ui.tracking.FollowScreen
import com.saarthi.owner.ui.tracking.ownerFollowSource
import com.saarthi.owner.ui.tracking.rememberFollowed

/**
 * One vehicle followed on the map: its trip's planned road and ends, the road
 * it has covered in the trail's colours, and what it measured last — the
 * camera going back to it each time it moves.
 */
@Composable
fun VehicleLiveScreen(app: OwnerApp, vehicleId: String) {
    FollowScreen(rememberFollowed("vehicle-live-$vehicleId", remember(vehicleId) { ownerFollowSource(app, vehicleId) }))
}
