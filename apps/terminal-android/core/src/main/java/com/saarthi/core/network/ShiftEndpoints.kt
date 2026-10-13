package com.saarthi.core.network

import kotlinx.serialization.builtins.ListSerializer

/*
 * The device-gateway endpoints behind the driver's shift screens — slips,
 * trips the driver adds, the covered path and the papers wallet.
 *
 * Kept beside [SaarthiApi] rather than inside it so the client's transport and
 * session handling stay one readable file; these are plain calls through it.
 */

private const val TERMINAL = "/api/v1/device-gateway/terminal"

/** A fuel slip: litres and the total, with the photograph as the evidence. */
suspend fun SaarthiApi.uploadFuelSlip(
    jpeg: ByteArray,
    litres: Double,
    totalCost: Double,
    odometerKm: Double?,
    stationName: String?,
    latitude: Double?,
    longitude: Double?,
): String = uploadWithPhoto(
    path = "$TERMINAL/fuel",
    jpeg = jpeg,
    fields = mapOf(
        "litres" to litres.toString(),
        "totalCost" to totalCost.toString(),
        "odometerKm" to odometerKm?.toString(),
        "stationName" to stationName,
        "latitude" to latitude?.toString(),
        "longitude" to longitude?.toString(),
    ),
    refusedCode = "FUEL_REFUSED",
    refusedMessage = "Saarthi could not save that slip.",
)

/** Any other road expense — toll, parking, repair, food, loading, challan. */
suspend fun SaarthiApi.uploadExpenseSlip(
    jpeg: ByteArray,
    category: String,
    amount: Double,
    vendorName: String?,
    notes: String?,
    latitude: Double?,
    longitude: Double?,
): String = uploadWithPhoto(
    path = "$TERMINAL/expense",
    jpeg = jpeg,
    fields = mapOf(
        "category" to category,
        "amount" to amount.toString(),
        "vendorName" to vendorName,
        "notes" to notes,
        "latitude" to latitude?.toString(),
        "longitude" to longitude?.toString(),
    ),
    refusedCode = "EXPENSE_REFUSED",
    refusedMessage = "Saarthi could not save that slip.",
)

/** The path this vehicle has covered since its trip or the driver's shift began. */
suspend fun SaarthiApi.trail(): List<TrailPointDto> =
    get("$TERMINAL/trail", ListSerializer(TrailPointDto.serializer()))

/** Add a trip for this vehicle and driver; queued behind a fleet trip if one is open. */
suspend fun SaarthiApi.createTrip(request: CreateTripRequest): CreatedTripDto =
    post("$TERMINAL/trips", request, CreateTripRequest.serializer(), CreatedTripDto.serializer())

/**
 * The driver handed the dispatched trip to Google Maps (`GOOGLE_MAPS`), or came
 * back to Saarthi's own navigation (`null`). Null when there is no dispatch.
 */
suspend fun SaarthiApi.navigationHandoff(app: String?): TerminalTripDto? =
    postNullable(
        "$TERMINAL/navigation/handoff",
        NavigationHandoffRequest(app),
        NavigationHandoffRequest.serializer(),
        TerminalTripDto.serializer(),
    )

/** The driver confirmed arrival. The GPS arrival time is what Saarthi records. */
suspend fun SaarthiApi.arriveTrip(request: TripEventRequest): TerminalTripDto? =
    postNullable("$TERMINAL/trip/arrive", request, TripEventRequest.serializer(), TerminalTripDto.serializer())

/** The driver's own trips that have not started, in order, with a shorter order when there is one. */
suspend fun SaarthiApi.tripQueue(latitude: Double?, longitude: Double?): TripQueueDto =
    get(
        "$TERMINAL/trips/queue" +
            if (latitude != null && longitude != null) "?latitude=$latitude&longitude=$longitude" else "",
        TripQueueDto.serializer(),
    )

/** Run the driver's trips in this order. Answers with the queue as it now stands. */
suspend fun SaarthiApi.orderTrips(request: TripQueueOrderRequest): TripQueueDto =
    post("$TERMINAL/trips/queue", request, TripQueueOrderRequest.serializer(), TripQueueDto.serializer())

/** Take one of the driver's own trips off their queue. Answers with the queue as it now stands. */
suspend fun SaarthiApi.removeTrip(tripId: String): TripQueueDto =
    post("$TERMINAL/trips/$tripId/remove", TripEventRequest(), TripEventRequest.serializer(), TripQueueDto.serializer())

/** Every folder, paper, register record and photo for the Papers tab, in one call. */
suspend fun SaarthiApi.papersWallet(): PapersWalletDto =
    get("$TERMINAL/papers/wallet", PapersWalletDto.serializer())

/** Where a vehicle photograph's bytes are, for [SaarthiApi.downloadTo]. */
fun vehiclePhotoPath(photoId: String, thumbnail: Boolean): String =
    "$TERMINAL/papers/photos/$photoId?variant=${if (thumbnail) "thumb" else "original"}"
