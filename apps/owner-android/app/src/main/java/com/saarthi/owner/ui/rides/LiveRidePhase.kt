package com.saarthi.owner.ui.rides

import com.saarthi.owner.network.LiveRidesApi
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.map.MapVehicle
import com.saarthi.owner.ui.tracking.markerStateOf
import java.time.Instant

/*
 * Where a ride shared with family stands, and how its map names it. Plain
 * logic with no Android in it, so it is tested on the JVM.
 */

/** What the live view shows: waiting for a first fix, the rider on the map, or the end. */
enum class LivePhase { WAITING, LIVE, ENDED }

/**
 * An ended ride shows nobody's whereabouts, even if a position came with it;
 * a ride still sharing waits until its first fix arrives.
 */
fun LiveRidesApi.LiveRide.phase(): LivePhase = when {
    status == LiveRidesApi.ENDED || endedAt != null -> LivePhase.ENDED
    position == null -> LivePhase.WAITING
    else -> LivePhase.LIVE
}

/** "Neha · UP 32 AB 1234" — the rider by first name, then the vehicle's number if one was typed. */
fun liveRideLabel(riderName: String, registration: String?): String =
    listOfNotNull(
        firstNameOf(riderName).ifEmpty { null },
        registration?.trim()?.ifEmpty { null }?.let(::formatPlate),
    ).joinToString(" · ")

private val Spaces = Regex("\\s+")

/** "Neha" from "Neha Verma"; nothing from a blank name. */
private fun firstNameOf(name: String): String = name.trim().split(Spaces).first()

/** The rider as a disc on the map, judged by the owner's rule for a vehicle; null until the first fix. */
fun LiveRidesApi.LiveRide.mapMarker(now: Instant = Instant.now()): MapVehicle? {
    val here = position?.takeIf { phase() == LivePhase.LIVE } ?: return null
    return MapVehicle(
        id = "live-ride",
        latitude = here.latitude,
        longitude = here.longitude,
        state = markerStateOf(here.recordedAt, here.speedKph, now),
        label = liveRideLabel(riderName, registrationNumber),
    )
}
