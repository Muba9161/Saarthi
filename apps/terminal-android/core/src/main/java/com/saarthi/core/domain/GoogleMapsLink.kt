package com.saarthi.core.domain

import java.util.Locale

/**
 * The link that opens Google Maps navigating to a place.
 *
 * Google's Maps URLs — free, no key, no billing — opened in the Google Maps app.
 * Turn-by-turn starts straight away from wherever the phone is. Saarthi keeps
 * recording the journey in the background the whole time; this only hands over
 * the guiding.
 *
 * The destination alone, never stops on the way. Points taken from the fleet's
 * planned route used to go with it, to hold Google to that road, and drivers
 * were shown a journey broken into stops that were not places at all. Google
 * now picks its own road; a stretch off the planned one is recorded as an
 * alternate road, not held against the driver.
 */
object GoogleMapsLink {

    /** The Google Maps app, which the link is aimed at so no other app answers it. */
    const val PACKAGE = "com.google.android.apps.maps"

    fun navigate(latitude: Double, longitude: Double): String =
        "https://www.google.com/maps/dir/?api=1" +
            "&destination=" + coordinate(latitude, longitude) +
            "&travelmode=driving&dir_action=navigate"

    /** Always "26.846700,80.946200": never a comma for a decimal point, nor another script's digits. */
    private fun coordinate(latitude: Double, longitude: Double): String =
        String.format(Locale.US, "%.6f,%.6f", latitude, longitude)
}
