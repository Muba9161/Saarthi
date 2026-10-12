package com.saarthi.core.telemetry

/**
 * Whether the vehicle is moving, judged one fix at a time — with hysteresis,
 * and with indoor noise kept out.
 *
 * Two thresholds rather than one, so a vehicle edging forward in a queue does
 * not flicker between 0 and 6 km/h: it must reach [START_MOVING_MPS] to count
 * as moving and drop below [STOP_MOVING_MPS] to count as stopped. A speed
 * smaller than its own reported error is no speed at all.
 *
 * And a parked phone indoors still produces the odd fix claiming two or three
 * metres a second, from satellites seen through a roof — believed, it moved
 * the parked position around the room, drew a star of lines on the trail and
 * showed 9 km/h on a stationary vehicle. So setting off needs [START_FIXES]
 * fixes in a row that say so, each placed within [START_ACCURACY_METRES]:
 * a vehicle really pulling away outdoors passes in a few seconds; a spike
 * through a ceiling does not. Once moving, a looser [MOVING_ACCURACY_METRES]
 * keeps a flyover or a street of tall buildings from stopping it.
 */
class MotionGate {

    var moving = false
        private set

    private var startStreak = 0

    /** Judge one fix. Null speed or accuracy means the fix did not carry one. */
    fun update(speedMps: Float?, speedAccuracyMps: Float?, accuracyMetres: Float?): Boolean {
        // No speed on the fix says nothing either way: hold what we had.
        if (speedMps == null) return moving

        val speedBelievable = speedAccuracyMps == null || speedAccuracyMps < speedMps
        if (moving) {
            moving = speedBelievable &&
                speedMps >= STOP_MOVING_MPS &&
                (accuracyMetres == null || accuracyMetres <= MOVING_ACCURACY_METRES)
            startStreak = 0
            return moving
        }

        val looksLikeSettingOff = speedBelievable &&
            speedMps >= START_MOVING_MPS &&
            accuracyMetres != null && accuracyMetres <= START_ACCURACY_METRES
        startStreak = if (looksLikeSettingOff) startStreak + 1 else 0
        moving = startStreak >= START_FIXES
        return moving
    }

    fun reset() {
        moving = false
        startStreak = 0
    }

    companion object {
        /** Speed to reach before a parked vehicle counts as moving — about 7 km/h. */
        const val START_MOVING_MPS = 2.0f

        /** Speed to drop below before a moving vehicle counts as stopped — under 4 km/h. */
        const val STOP_MOVING_MPS = 1.0f

        /** Fixes in a row that must say "moving" before a parked vehicle sets off. */
        const val START_FIXES = 2

        /** How precisely a fix must be placed to start a parked vehicle moving. */
        const val START_ACCURACY_METRES = 30f

        /** How precisely a fix must be placed to keep a moving vehicle moving. */
        const val MOVING_ACCURACY_METRES = 60f
    }
}
