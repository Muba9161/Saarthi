package com.saarthi.owner.ui.common

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import com.saarthi.owner.R

/** The vehicle kinds a filter chip groups by. */
enum class VehicleClass(@StringRes private val labelRes: Int) {
    TRUCKS(R.string.ui_vehicle_class_trucks),
    BUSES(R.string.ui_vehicle_class_buses),
    CARS(R.string.ui_vehicle_class_cars),
    AUTOS(R.string.ui_vehicle_class_autos),
    OTHER(R.string.ui_vehicle_class_other),
    ;

    val label: String get() = Words.get(labelRes)
}

/**
 * Which of the project's vehicle photographs stands for a type, and which
 * filter it falls under — the web app's silhouette table, narrowed to the
 * photographs that exist. A type with no photograph of its own takes the
 * nearest one rather than a drawn stand-in.
 */
fun vehicleClassOf(artType: String): VehicleClass = when (artType.uppercase()) {
    "TRUCK", "OPEN_BODY", "CLOSED_CONTAINER", "TIPPER", "TRAILER", "TANKER", "FLATBED",
    "REFRIGERATED", "MINI_TRUCK", "MULTI_AXLE", "PICKUP", "TEMPO", "CARGO_VAN",
    -> VehicleClass.TRUCKS
    "BUS", "MINI_BUS", "STANDARD_BUS", "COACH", "SLEEPER_BUS", "SCHOOL_BUS" -> VehicleClass.BUSES
    "CAR", "TAXI", "SEDAN", "HATCHBACK", "LUXURY", "SUV", "COMPACT_SUV", "MUV", "VAN", "PASSENGER_VAN" ->
        VehicleClass.CARS
    "AUTO_RICKSHAW", "E_RICKSHAW", "CARGO_THREE_WHEELER" -> VehicleClass.AUTOS
    else -> VehicleClass.OTHER
}

@DrawableRes
fun vehiclePhotoOf(artType: String): Int? = when (artType.uppercase()) {
    "TIPPER" -> R.drawable.vehicle_tipper
    "BUS", "MINI_BUS", "STANDARD_BUS", "COACH", "SLEEPER_BUS", "SCHOOL_BUS" -> R.drawable.vehicle_bus
    "SUV", "COMPACT_SUV", "MUV", "VAN", "PASSENGER_VAN" -> R.drawable.vehicle_suv
    "CAR", "TAXI", "SEDAN", "HATCHBACK", "LUXURY" -> R.drawable.vehicle_sedan
    "AUTO_RICKSHAW", "E_RICKSHAW", "CARGO_THREE_WHEELER" -> R.drawable.vehicle_autorickshaw
    else -> if (vehicleClassOf(artType) == VehicleClass.TRUCKS) R.drawable.vehicle_truck else null
}
