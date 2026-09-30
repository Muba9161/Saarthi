package com.saarthi.core.ui

import androidx.annotation.DrawableRes
import com.saarthi.core.R

/**
 * How [TerminalMap] draws what the app lays over the basemap: the vehicle, the
 * glow under it, the route and where the route ends.
 *
 * The tablet and the driver's phone share one map engine but not one look, so
 * the colours and silhouettes live here rather than in the engine. Colours are
 * MapLibre colour strings — `#RRGGBB` or `rgba(r,g,b,a)`.
 */
data class MapLook(
    @DrawableRes val truckMarker: Int,
    @DrawableRes val busMarker: Int,
    @DrawableRes val carMarker: Int,
    @DrawableRes val autoMarker: Int,
    /** Multiplies the marker drawable's own size. */
    val markerScale: Float,
    val haloColor: String,
    val haloOpacity: Float,
    val haloRadius: Float,
    val routeColor: String,
    val routeWidth: Float,
    /** The wider line under the route that keeps it legible on any ground. */
    val casingColor: String,
    val casingOpacity: Float,
    val casingWidth: Float,
    val destinationColor: String,
    val destinationRadius: Float,
    val destinationRing: String,
    val destinationRingWidth: Float,
    /**
     * Whether MapLibre draws its own logo and attribution button.
     *
     * False only for a host that prints the map's credits itself, somewhere its
     * own panels cannot cover them — OpenStreetMap's licence needs them visible,
     * not necessarily drawn by MapLibre.
     */
    val nativeAttribution: Boolean = true,
    /** How numbered place pins are drawn, for screens that show any. */
    val pins: PinLook = PinLook(),
) {
    /**
     * Which silhouette a vehicle gets.
     *
     * Grouped by *shape on a map* rather than by commercial category, because
     * that is all the marker can convey at fifteen pixels: a long rigid body, a
     * car-sized body, or something narrow. A taxi and a private car are the same
     * shape from above, and pretending otherwise would be detail nobody could see.
     */
    @DrawableRes
    fun markerFor(vehicleType: String?): Int = when (vehicleType?.uppercase()) {
        "CAR", "TAXI", "SUV" -> carMarker
        "BUS", "VAN", "TEMPO" -> busMarker
        "AUTO_RICKSHAW" -> autoMarker
        // TRUCK, PICKUP, OTHER, null, and anything this build has never heard of.
        else -> truckMarker
    }

    companion object {
        /** The fitted tablet's cockpit: ember glow, bright-indigo route, amber end. */
        val Terminal = MapLook(
            truckMarker = R.drawable.ic_marker_truck,
            busMarker = R.drawable.ic_marker_bus,
            carMarker = R.drawable.ic_marker_car,
            autoMarker = R.drawable.ic_marker_auto,
            markerScale = 0.85f,
            // Ember, matching the marker it sits under. It was a navy blue left
            // over from the old blue plan-view icons, and against the new one it
            // read as a separate bruise on the map rather than as its own glow.
            haloColor = "#F26522",
            haloOpacity = 0.16f,
            haloRadius = 26f,
            // Saarthi indigo, bright variant — the hue the cockpit uses for
            // anything the driver is meant to follow.
            routeColor = "#7A93FA",
            routeWidth = 6f,
            casingColor = "#0B1020",
            casingOpacity = 0.85f,
            casingWidth = 11f,
            destinationColor = "#FBA834",
            destinationRadius = 9f,
            destinationRing = "#0B1020",
            destinationRingWidth = 3f,
        )
    }
}
