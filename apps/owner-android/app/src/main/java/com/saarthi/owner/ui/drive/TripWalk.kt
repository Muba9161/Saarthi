package com.saarthi.owner.ui.drive

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * A driver's three buttons — Start, Arrived, Complete — walked through the
 * trip's ten states one real step at a time, as Humsafar's server-side walk
 * does it: each step is the transition the fleet's timeline records, so the
 * start, arrival and delay all come out right. The table is the server's
 * `TRIP_TRANSITIONS`, without the ways off the road (cancelled, suspended,
 * emergency), which are never a button's target.
 */
internal object TripWalk {

    private val NEXT: Map<String, List<String>> = mapOf(
        "DRAFT" to listOf("ASSIGNED"),
        "ASSIGNED" to listOf("STARTED", "LOADING"),
        "LOADING" to listOf("STARTED"),
        "STARTED" to listOf("IN_TRANSIT", "DELAYED"),
        "IN_TRANSIT" to listOf("ARRIVED", "DELAYED"),
        "DELAYED" to listOf("IN_TRANSIT", "ARRIVED"),
        "EMERGENCY" to listOf("IN_TRANSIT", "DELAYED", "ARRIVED"),
        "SUSPENDED" to listOf("IN_TRANSIT", "STARTED"),
        "ARRIVED" to listOf("COMPLETED", "UNLOADING"),
        "UNLOADING" to listOf("COMPLETED"),
    )

    val NOT_STARTED = setOf("DRAFT", "ASSIGNED", "LOADING")
    val MOVING = setOf("STARTED", "IN_TRANSIT", "DELAYED", "EMERGENCY", "SUSPENDED")
    val AT_SITE = setOf("ARRIVED", "UNLOADING")

    /** The steps from [from] to [to], shortest first; empty when already there, null when there is no honest way. */
    fun path(from: String, to: String): List<String>? {
        if (from == to) return emptyList()
        val cameFrom = mutableMapOf(from to "")
        val queue = ArrayDeque(listOf(from))
        while (queue.isNotEmpty()) {
            val here = queue.removeFirst()
            for (next in NEXT[here].orEmpty()) {
                if (next in cameFrom) continue
                cameFrom[next] = here
                if (next == to) {
                    val steps = mutableListOf(to)
                    var back = here
                    while (back != from) {
                        steps.add(0, back)
                        back = cameFrom.getValue(back)
                    }
                    return steps
                }
                queue.addLast(next)
            }
        }
        return null
    }

    /**
     * The quiet note for a trip ended short of where it was going — the same
     * words Humsafar's "End this trip here" leaves on the fleet's timeline — or
     * none when the vehicle is at the destination anyway.
     */
    fun endedEarlyNote(here: Pair<Double, Double>?, destination: Pair<Double, Double>?, destinationName: String): String? {
        if (here == null || destination == null) return null
        val short = metresBetween(here, destination)
        if (short <= ARRIVED_WITHIN_METRES) return null
        return "Ended early by the driver, %.1f km short of %s.".format(short / 1000, destinationName)
    }

    fun metresBetween(a: Pair<Double, Double>, b: Pair<Double, Double>): Double {
        val (lat1, lng1) = a
        val (lat2, lng2) = b
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val h = sin(dLat / 2).pow(2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2).pow(2)
        return 2 * EARTH_METRES * asin(sqrt(h))
    }

    /** The server's `STOP_REACHED_METRES`. */
    private const val ARRIVED_WITHIN_METRES = 200.0
    private const val EARTH_METRES = 6_371_000.0
}
