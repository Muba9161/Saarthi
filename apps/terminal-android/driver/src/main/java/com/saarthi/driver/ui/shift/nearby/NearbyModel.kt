package com.saarthi.driver.ui.shift.nearby

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.saarthi.core.domain.bearing
import com.saarthi.core.network.NearbyPlaceDto
import com.saarthi.core.telemetry.Position
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Lucide

/** The eight kinds of place, keyed as the services endpoint names them. */
internal enum class ServiceKind(val key: String, @StringRes val label: Int, @StringRes val title: Int, val icon: String) {
    FUEL("FUEL", R.string.nearby_cat_fuel, R.string.nearby_title_fuel, Lucide.fuel),
    MECHANIC("MECHANIC", R.string.nearby_cat_mechanic, R.string.nearby_title_mechanic, Lucide.wrench),
    TYRE("TYRE", R.string.nearby_cat_tyre, R.string.nearby_title_tyre, Lucide.tyre),
    PARKING("PARKING", R.string.nearby_cat_parking, R.string.nearby_title_parking, Lucide.parking),
    FOOD("FOOD", R.string.nearby_cat_food, R.string.nearby_title_food, Lucide.food),
    HOSPITAL("HOSPITAL", R.string.nearby_cat_hospital, R.string.nearby_title_hospital, Lucide.hospital),
    POLICE("POLICE", R.string.nearby_cat_police, R.string.nearby_title_police, Lucide.shield),
    WEIGHBRIDGE("WEIGHBRIDGE", R.string.nearby_cat_weighbridge, R.string.nearby_title_weighbridge, Lucide.scale),
    ;

    companion object {
        fun from(key: String?): ServiceKind = entries.firstOrNull { it.key == key } ?: FUEL
    }
}

/** Where a place is relative to the way the vehicle is pointing. */
internal enum class Side(@StringRes val word: Int, val arrow: String) {
    AHEAD(R.string.nearby_ahead, Lucide.arrowUp),
    RIGHT(R.string.nearby_right, Lucide.arrowRight),
    BEHIND(R.string.nearby_behind, Lucide.arrowDown),
    LEFT(R.string.nearby_left, Lucide.arrowLeft),
}

/** A place with its side worked out, ready to draw. */
internal class NearbyRow(val place: NearbyPlaceDto, val side: Side?)

/**
 * The places, nearest first, each placed ahead, left, right or behind.
 *
 * The side needs a heading, and a heading is only trustworthy while moving —
 * a parked phone's compass points wherever it was last put down — so without
 * one the rows fall back to the compass direction the server measured.
 */
internal fun nearbyRows(places: List<NearbyPlaceDto>, position: Position?, heading: Double?): List<NearbyRow> =
    places.sortedBy { it.distance.km.takeIf { km -> km > 0.0 } ?: it.straightLineKm }.map { place ->
        val side = if (position == null || heading == null) {
            null
        } else {
            val toPlace = bearing(position.latitude, position.longitude, place.latitude, place.longitude)
            val delta = ((toPlace - heading + 540.0) % 360.0) - 180.0
            when {
                delta >= -45.0 && delta <= 45.0 -> Side.AHEAD
                delta > 45.0 && delta <= 135.0 -> Side.RIGHT
                delta < -45.0 && delta >= -135.0 -> Side.LEFT
                else -> Side.BEHIND
            }
        }
        NearbyRow(place, side)
    }

/** The place to feature first: the nearest one ahead, or simply the nearest. */
internal fun List<NearbyRow>.bestIndex(): Int = indexOfFirst { it.side == Side.AHEAD }.takeIf { it >= 0 } ?: 0

/** How far, in the unit and precision a driver reads at a glance. */
internal fun NearbyPlaceDto.kmLabel(): String {
    val km = distance.km.takeIf { it > 0.0 } ?: straightLineKm
    return if (km < 10) String.format(java.util.Locale.getDefault(), "%.1f", km) else km.toInt().toString()
}

/** "Ahead of you", "To your left" — or the compass direction when there is no heading. */
@Composable
internal fun NearbyRow.whereWord(): String = side?.let { stringResource(it.word) } ?: stringResource(
    when (place.direction) {
        "NE" -> R.string.nearby_dir_ne
        "E" -> R.string.nearby_dir_e
        "SE" -> R.string.nearby_dir_se
        "S" -> R.string.nearby_dir_s
        "SW" -> R.string.nearby_dir_sw
        "W" -> R.string.nearby_dir_w
        "NW" -> R.string.nearby_dir_nw
        else -> R.string.nearby_dir_n
    },
)

/** The address and hours, as one quiet line. */
@Composable
internal fun NearbyPlaceDto.meta(): String = listOfNotNull(
    address?.takeIf { it.isNotBlank() },
    if (open24Hours) stringResource(R.string.nearby_open_24h) else openingHours?.takeIf { it.isNotBlank() },
).joinToString(" · ")
