package com.saarthi.core.domain

import com.saarthi.core.network.RoutePointDto
import java.net.URLEncoder
import java.util.Locale

/**
 * The link that opens Google Maps navigating to a place.
 *
 * Google's Maps URLs — free, no key, no billing — opened in the Google Maps app.
 * Turn-by-turn starts straight away from wherever the phone is. Saarthi keeps
 * recording the journey in the background the whole time; this only hands over
 * the guiding.
 *
 * For a fleet trip, a few points along the fleet's own planned route go with
 * it, so Google keeps to the road the fleet chose — a lorry route, where
 * Google on its own would take the shortest road for a car.
 */
object GoogleMapsLink {

    /** The Google Maps app, which the link is aimed at so no other app answers it. */
    const val PACKAGE = "com.google.android.apps.maps"

    /** Google's ceiling for stops in a link opened on a phone. */
    const val MAX_VIA = 3

    fun navigate(latitude: Double, longitude: Double, via: List<RoutePointDto> = emptyList()): String {
        val link = StringBuilder("https://www.google.com/maps/dir/?api=1")
            .append("&destination=").append(coordinate(latitude, longitude))
            .append("&travelmode=driving&dir_action=navigate")
        if (via.isNotEmpty()) {
            val stops = via.take(MAX_VIA).joinToString("|") { coordinate(it.latitude, it.longitude) }
            link.append("&waypoints=").append(URLEncoder.encode(stops, "UTF-8"))
        }
        return link.toString()
    }

    /**
     * Points spread evenly along a planned route, by distance — a quarter, half
     * and three quarters of the way — for [navigate] to pass through.
     *
     * None for a route with no road shape: a straight line from origin to
     * destination has nothing between its ends worth sending Google through.
     */
    fun viaPoints(route: List<RoutePointDto>, count: Int = MAX_VIA): List<RoutePointDto> {
        if (route.size <= 2 || count <= 0) return emptyList()
        val along = DoubleArray(route.size)
        for (index in 1 until route.size) {
            val (a, b) = route[index - 1] to route[index]
            along[index] = along[index - 1] + haversineMetres(a.latitude, a.longitude, b.latitude, b.longitude)
        }
        val total = along.last()
        if (total <= 0.0) return emptyList()
        return (1..count).map { part ->
            val target = total * part / (count + 1)
            route[along.indexOfFirst { it >= target }.coerceAtLeast(0)]
        }.distinct()
    }

    /** Always "26.846700,80.946200": never a comma for a decimal point, nor another script's digits. */
    private fun coordinate(latitude: Double, longitude: Double): String =
        String.format(Locale.US, "%.6f,%.6f", latitude, longitude)
}
