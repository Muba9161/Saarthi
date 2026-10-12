package com.saarthi.core.data

import android.annotation.SuppressLint
import android.content.Context
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.saarthi.core.network.CreateTripRequest
import com.saarthi.core.network.CreatedTripDto
import com.saarthi.core.network.NearbyResponse
import com.saarthi.core.network.PapersWalletDto
import com.saarthi.core.network.RouteDto
import com.saarthi.core.network.RouteRequest
import com.saarthi.core.network.TerminalTripDto
import com.saarthi.core.network.TripEventRequest
import com.saarthi.core.network.TrailPointDto
import com.saarthi.core.network.TripPlaceDto
import com.saarthi.core.network.arriveTrip
import com.saarthi.core.network.createTrip
import com.saarthi.core.network.navigationHandoff
import com.saarthi.core.network.papersWallet
import com.saarthi.core.network.trail
import com.saarthi.core.network.uploadExpenseSlip
import com.saarthi.core.network.uploadFuelSlip
import com.saarthi.core.telemetry.MetricSource
import com.saarthi.core.telemetry.Position
import com.saarthi.core.util.DeviceEnvironment
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The driver's shift features, over the terminal's own connection.
 *
 * Kept beside [TerminalRepository] rather than inside it: that class owns the
 * terminal's lifecycle — pairing, sessions, telemetry, the outbox — and these
 * are plain requests the shift screens make. Every call still goes through the
 * repository's [TerminalRepository.runCatchingApi], so the connection badge and
 * the error banner hear about them exactly as they hear about everything else.
 */
class ShiftRepository(
    private val context: Context,
    private val repository: TerminalRepository,
) {

    private val api get() = repository.api
    private val telemetry get() = repository.telemetry

    /** A fuel slip and its photograph, in one request. */
    suspend fun saveFuelSlip(
        jpeg: ByteArray,
        litres: Double,
        totalCost: Double,
        odometerKm: Double?,
        stationName: String?,
    ): Result<String> = repository.runCatchingApi {
        val position = telemetry.snapshot.value.position
        api.uploadFuelSlip(
            jpeg = jpeg,
            litres = litres,
            totalCost = totalCost,
            odometerKm = odometerKm,
            stationName = stationName,
            // Where the pump was, so the office can see it without asking.
            latitude = position?.latitude,
            longitude = position?.longitude,
        )
    }

    /** Any other road expense slip and its photograph, in one request. */
    suspend fun saveExpenseSlip(
        jpeg: ByteArray,
        category: String,
        amount: Double,
        vendorName: String?,
        notes: String?,
    ): Result<String> = repository.runCatchingApi {
        val position = telemetry.snapshot.value.position
        api.uploadExpenseSlip(
            jpeg = jpeg,
            category = category,
            amount = amount,
            vendorName = vendorName,
            notes = notes,
            latitude = position?.latitude,
            longitude = position?.longitude,
        )
    }

    suspend fun trail(): Result<List<TrailPointDto>> = repository.runCatchingApi { api.trail() }

    suspend fun papersWallet(): Result<PapersWalletDto> =
        repository.runCatchingApi { api.papersWallet() }

    /** The road between two places, for a trip the driver is planning. */
    suspend fun routeBetween(from: TripPlaceDto, to: TripPlaceDto): Result<RouteDto> =
        repository.runCatchingApi {
            api.route(
                RouteRequest(
                    fromLatitude = from.latitude,
                    fromLongitude = from.longitude,
                    toLatitude = to.latitude,
                    toLongitude = to.longitude,
                    destinationName = to.name,
                ),
            )
        }

    suspend fun createTrip(request: CreateTripRequest): Result<CreatedTripDto> =
        repository.runCatchingApi { api.createTrip(request) }

    /** Tell the fleet's trip the driver is following it in Google Maps, or is back. */
    suspend fun navigationHandoff(app: String?): Result<TerminalTripDto?> =
        repository.runCatchingApi { api.navigationHandoff(app) }

    /** The driver confirms arrival, from where the vehicle is now. */
    suspend fun arriveTrip(): Result<TerminalTripDto?> = repository.runCatchingApi {
        val position = telemetry.snapshot.value.position
        api.arriveTrip(TripEventRequest(latitude = position?.latitude, longitude = position?.longitude))
    }

    /**
     * Services near a fresh, accurate fix.
     *
     * The telemetry position is held still while the vehicle is parked — the
     * right thing for the odometer — so on a stationary vehicle it can be the
     * coarse first fix of the shift. A driver asking for the nearest mechanic is
     * nearly always parked, so this asks the platform for one sharp fix first
     * and falls back to the held position only if none comes quickly.
     */
    suspend fun nearbyHere(service: String?): Result<Pair<Position?, NearbyResponse>> {
        val here = sharpFix() ?: telemetry.snapshot.value.position
            ?: return repository.nearby(service).map { null to it }
        return repository.nearby(service, here.latitude, here.longitude).map { here to it }
    }

    @SuppressLint("MissingPermission") // Checked first; a revoked grant falls back.
    private suspend fun sharpFix(): Position? {
        if (!DeviceEnvironment.hasLocationPermission(context)) return null
        val request = CurrentLocationRequest.Builder()
            .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
            .setMaxUpdateAgeMillis(SHARP_FIX_MAX_AGE_MS)
            .build()
        val fix = runCatching {
            withTimeoutOrNull(SHARP_FIX_TIMEOUT_MS) {
                LocationServices.getFusedLocationProviderClient(context)
                    .getCurrentLocation(request, null)
                    .await()
            }
        }.getOrNull() ?: return null
        return Position(
            latitude = fix.latitude,
            longitude = fix.longitude,
            accuracyMetres = if (fix.hasAccuracy()) fix.accuracy.toDouble() else null,
            source = MetricSource.PHONE,
            at = fix.time,
        )
    }

    private companion object {
        /** Long enough for a first satellite fix in the open, short enough not to keep a driver waiting. */
        const val SHARP_FIX_TIMEOUT_MS = 4_000L

        /** A fix this recent is as good as a new one. */
        const val SHARP_FIX_MAX_AGE_MS = 20_000L
    }
}
