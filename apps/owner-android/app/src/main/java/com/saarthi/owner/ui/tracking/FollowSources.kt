package com.saarthi.owner.ui.tracking

import com.saarthi.owner.OwnerApp
import com.saarthi.owner.network.SharingApi
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.map.MapVehicle
import com.saarthi.owner.ui.map.MarkerState
import com.saarthi.owner.ui.trips.dropPoint
import com.saarthi.owner.ui.trips.pickupPoint
import com.saarthi.owner.ui.trips.routePoints
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** With no trip, the road reaches back at least this far — the web live map's window. */
private val NO_TRIP_WINDOW: Duration = Duration.ofHours(12)

/**
 * Where a road with no trip starts: local midnight, or twelve hours back when
 * that is earlier — so just after midnight it is still a road, not a stub.
 */
internal fun dayStart(now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
    val midnight = LocalDate.ofInstant(now, zone).atStartOfDay(zone).toInstant()
    return minOf(midnight, now.minus(NO_TRIP_WINDOW)).toString()
}

/** The owner's vehicle as its map disc, coloured by its status; null until it has reported. */
internal fun VehiclesApi.Vehicle.mapMarker(): MapVehicle? {
    val here = lastLocation ?: return null
    val latitude = here.latitude ?: return null
    val longitude = here.longitude ?: return null
    return MapVehicle(
        id = id,
        latitude = latitude,
        longitude = longitude,
        state = when (motion()) {
            VehiclesApi.Motion.MOVING -> MarkerState.MOVING
            VehiclesApi.Motion.IDLE, VehiclesApi.Motion.SERVICE -> MarkerState.IDLE
            VehiclesApi.Motion.OFFLINE -> MarkerState.OFFLINE
        },
        label = formatPlate(registrationNumber),
        status = status.ifBlank { null },
    )
}

/**
 * The owner following their own vehicle: its record, the trip it is on, the
 * road stored since the trip started (or since the day began), and the latest
 * reading — each optional, since a plan may not carry history or telemetry.
 */
fun ownerFollowSource(app: OwnerApp, vehicleId: String): FollowSource = FollowSource { since ->
    val vehicle = app.vehicles.get(vehicleId) ?: error("The vehicle could not be read.")
    val trip = vehicle.currentTripId?.let { id -> attempt { app.trips.get(id) } }
    val from = since ?: trip?.actualStartAt ?: dayStart()
    val fixes = attempt { app.trips.travelledSince(vehicleId, from).points }.orEmpty()
    val reading = attempt { app.vehicles.reading(vehicleId) }
    FollowRead(
        marker = vehicle.mapMarker(),
        plate = vehicle.registrationNumber,
        seenAt = vehicle.lastLocation?.recordedAt,
        tripId = trip?.id,
        trip = trip?.followed(),
        fixes = fixes.map { Fix(it.latitude, it.longitude, it.routeState, it.recordedAt) },
        readings = reading?.readings(),
    )
}

/** The owner's reading cut to what the vehicle measured; simulated figures are dropped. */
fun VehiclesApi.Reading.readings(): Readings = Readings(
    recordedAt = recordedAt,
    speedKph = measured("SPEED", speedKph),
    rpm = measured("RPM", rpm),
    engineLoad = measured("ENGINE_LOAD", engineLoad),
    coolantTemperature = measured("COOLANT_TEMPERATURE", coolantTemperature),
    fuelLevel = measured("FUEL_LEVEL", fuelLevel),
    batteryVoltage = measured("BATTERY_VOLTAGE", batteryVoltage),
)

private fun TripsApi.Trip.followed() = FollowedTrip(
    reference = reference,
    origin = originAddress,
    destination = destinationAddress,
    pickup = pickupPoint,
    drop = dropPoint,
    route = routePoints,
)

/**
 * The person a vehicle is shared with, following it through the share: what
 * the owner would see on the owner's own plan, never more.
 */
fun sharedFollowSource(app: OwnerApp, shareId: String): FollowSource = FollowSource { since ->
    val vehicle = app.sharing.vehicle(shareId) ?: error("The shared vehicle could not be read.")
    val live = app.sharing.live(shareId, since)
    FollowRead(
        marker = vehicle.mapMarker(),
        plate = vehicle.registrationNumber,
        seenAt = vehicle.lastLocation?.recordedAt,
        tripId = live.trip?.id,
        trip = live.trip?.let { trip ->
            FollowedTrip(
                reference = trip.reference,
                origin = trip.origin,
                destination = trip.destination,
                pickup = trip.originLatitude?.let { lat -> trip.originLongitude?.let { lng -> lat to lng } },
                drop = trip.destinationLatitude?.let { lat -> trip.destinationLongitude?.let { lng -> lat to lng } },
                route = trip.plannedRoute.map { it.latitude to it.longitude },
            )
        },
        fixes = live.trail.map { Fix(it.latitude, it.longitude, it.routeState, it.recordedAt) },
        readings = live.reading?.let { r ->
            Readings(r.recordedAt, r.speedKph, r.rpm, r.engineLoad, r.coolantTemperature, r.fuelLevel, r.batteryVoltage)
        },
    )
}

/** A shared vehicle as its map disc: coloured by its status, grey once it stops reporting. */
internal fun SharingApi.SharedVehicle.mapMarker(): MapVehicle? {
    val here = lastLocation ?: return null
    return MapVehicle(
        id = vehicleId,
        latitude = here.latitude,
        longitude = here.longitude,
        state = markerStateOf(here.recordedAt, here.speedKph),
        label = formatPlate(registrationNumber),
        status = status.ifBlank { null },
    )
}

/**
 * How a reported position is drawn: grey once it is too old to trust, moving
 * above a walking pace, otherwise stopped — the owner's own rule for a vehicle.
 */
internal fun markerStateOf(recordedAt: String?, speedKph: Double?, now: Instant = Instant.now()): MarkerState {
    val minutes = recordedAt?.let { runCatching { Duration.between(Instant.parse(it), now).toMinutes() }.getOrNull() }
    return when {
        minutes == null || minutes > VehiclesApi.OFFLINE_AFTER_MINUTES -> MarkerState.OFFLINE
        (speedKph ?: 0.0) > VehiclesApi.MOVING_KPH -> MarkerState.MOVING
        else -> MarkerState.IDLE
    }
}
