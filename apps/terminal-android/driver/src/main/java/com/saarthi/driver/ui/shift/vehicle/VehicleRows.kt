package com.saarthi.driver.ui.shift.vehicle

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.saarthi.core.network.TerminalDriverDto
import com.saarthi.core.network.TerminalVehicleDto
import com.saarthi.driver.R
import com.saarthi.driver.ui.shift.humanised
import com.saarthi.driver.ui.shift.map.vehicleWord
import java.text.DecimalFormat
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Thousands grouped the Indian way — 1,24,560 — as the design writes them. */
internal val Grouped: NumberFormat = NumberFormat.getIntegerInstance(Locale.forLanguageTag("en-IN"))

/**
 * The vehicle's passport, exactly as the fleet recorded it.
 *
 * Capacity and odometer arrive as zero when the fleet never entered them, and
 * a truck rated for "0 t" is a record gap, not a fact — so those show a dash.
 */
@Composable
internal fun passportRows(vehicle: TerminalVehicleDto?): List<Pair<String, String?>> = listOf(
    stringResource(R.string.vehicle_row_registration) to vehicle?.registrationNumber,
    stringResource(R.string.vehicle_row_type) to vehicle?.let { vehicleWord(it.vehicleType) },
    stringResource(R.string.vehicle_row_make) to
        vehicle?.let { listOfNotNull(it.manufacturer, it.model).joinToString(" ").ifBlank { null } },
    stringResource(R.string.vehicle_row_year) to vehicle?.year?.toString(),
    stringResource(R.string.vehicle_row_fuel) to vehicle?.let { fuelWord(it.fuelType) },
    stringResource(R.string.vehicle_row_capacity) to vehicle?.capacityTons?.takeIf { it > 0.0 }?.let {
        stringResource(R.string.vehicle_capacity_value, DecimalFormat("#.#").format(it))
    },
    stringResource(R.string.instrument_odometer) to vehicle?.odometerKm?.takeIf { it > 0.0 }?.let {
        stringResource(R.string.vehicle_odometer_value, Grouped.format(Math.round(it)))
    },
    stringResource(R.string.vehicle_row_fleet) to vehicle?.organizationName?.ifBlank { null },
)

/**
 * The signed-on driver's own record. Deliberately not the licence number or
 * anything else personal: this is a screen other people in the cab can see.
 */
@Composable
internal fun driverRows(driver: TerminalDriverDto?): List<Pair<String, String?>> = listOf(
    stringResource(R.string.vehicle_row_name) to driver?.name?.ifBlank { null },
    stringResource(R.string.vehicle_row_licence_class) to driver?.licenseClass?.ifBlank { null },
    stringResource(R.string.vehicle_row_licence) to driver?.let { licenceWord(it) },
    stringResource(R.string.vehicle_row_profile) to driver?.let { profileWord(it.verificationStatus) },
    stringResource(R.string.vehicle_row_trips) to driver?.totalTrips?.toString(),
)

@Composable
private fun fuelWord(fuelType: String): String = when (fuelType.uppercase()) {
    "DIESEL" -> stringResource(R.string.fuel_diesel)
    "PETROL" -> stringResource(R.string.fuel_petrol)
    "CNG" -> stringResource(R.string.fuel_cng)
    "ELECTRIC" -> stringResource(R.string.vehicle_fuel_electric)
    "HYBRID" -> stringResource(R.string.vehicle_fuel_hybrid)
    "LNG" -> stringResource(R.string.vehicle_fuel_lng)
    else -> fuelType.humanised()
}

/** The server's licence verdict, with the month it runs to where that matters. */
@Composable
private fun licenceWord(driver: TerminalDriverDto): String {
    val month = driver.licenseExpiresAt?.let(::monthOf)
    return when (driver.licenseValidity) {
        "VALID" -> month?.let { stringResource(R.string.vehicle_licence_valid, it) }
        "EXPIRING_SOON" -> month?.let { stringResource(R.string.vehicle_licence_expiring, it) }
        "EXPIRED" -> month?.let { stringResource(R.string.vehicle_licence_expired, it) }
        "PENDING_VERIFICATION" -> stringResource(R.string.vehicle_licence_pending)
        "NO_EXPIRY" -> stringResource(R.string.vehicle_licence_no_expiry)
        "REJECTED" -> stringResource(R.string.vehicle_licence_rejected)
        else -> null
    } ?: driver.licenseValidity.humanised()
}

@Composable
private fun profileWord(status: String): String = when (status) {
    "PENDING" -> stringResource(R.string.vehicle_profile_pending)
    "SUBMITTED" -> stringResource(R.string.vehicle_profile_submitted)
    "UNDER_REVIEW" -> stringResource(R.string.vehicle_profile_under_review)
    "VERIFIED" -> stringResource(R.string.vehicle_profile_verified)
    "REJECTED" -> stringResource(R.string.vehicle_profile_rejected)
    "EXPIRED" -> stringResource(R.string.vehicle_profile_expired)
    "SUSPENDED" -> stringResource(R.string.vehicle_profile_suspended)
    else -> status.humanised()
}

/**
 * "Mar 2028". Read in UTC because the server sends a calendar date at
 * midnight UTC, and a phone west of Greenwich would otherwise show the day
 * before — which on the first of a month is the wrong month.
 */
private fun monthOf(iso: String): String? = runCatching {
    DateTimeFormatter.ofPattern("MMM yyyy", Locale.getDefault()).withZone(ZoneOffset.UTC).format(Instant.parse(iso))
}.getOrNull()
