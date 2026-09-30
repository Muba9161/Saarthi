package com.saarthi.core.ui

import android.graphics.Color
import com.saarthi.core.telemetry.Position
import com.saarthi.core.util.DebugLog
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer

/**
 * A place marked on the map — a fuel station in the services sheet, say —
 * numbered so the list beside the map can refer to it, with one of them picked.
 */
data class MapPin(
    val latitude: Double,
    val longitude: Double,
    val label: String,
    val selected: Boolean = false,
    /** Bright rather than grey: the places worth the driver's attention first. */
    val emphasised: Boolean = true,
)

/** The pins' colours, as part of a [MapLook]. MapLibre colour strings. */
data class PinLook(
    val fill: String = "#F4F4F5",
    val text: String = "#0F0F24",
    val mutedFill: String = "#3F3F46",
    val mutedText: String = "#F4F4F5",
    val selectedFill: String = "#727FF3",
    val selectedText: String = "#0F0F24",
    /** A ring in the map's ground colour, so a pin never merges with a road. */
    val ring: String = "#0C0D10",
)

/** The last pins drawn into a style, so an unchanged set is not re-sent on every frame. */
internal class DrawnPins {
    var json: String? = null
}

/** The pins as a FeatureCollection, the picked one last so it is drawn on top. */
internal fun pinsJson(pins: List<MapPin>): String {
    val features = JSONArray()
    pins.withIndex()
        .sortedBy { (_, pin) -> pin.selected }
        .forEach { (index, pin) ->
            features.put(
                JSONObject()
                    .put("type", "Feature")
                    .put(
                        "properties",
                        JSONObject()
                            .put(INDEX, index)
                            .put(LABEL, pin.label)
                            .put(STATE, if (pin.selected) SELECTED else if (pin.emphasised) BRIGHT else MUTED),
                    )
                    .put(
                        "geometry",
                        JSONObject()
                            .put("type", "Point")
                            // GeoJSON is [longitude, latitude].
                            .put("coordinates", JSONArray().put(pin.longitude).put(pin.latitude)),
                    ),
            )
        }
    return JSONObject().put("type", "FeatureCollection").put("features", features).toString()
}

/** Draw or update the pins: a ringed disc with the number in it. */
internal fun drawPins(style: Style, json: String, look: PinLook) {
    setGeoJson(style, PINS_SOURCE_ID, json) {
        style.addLayer(
            CircleLayer(PINS_LAYER, PINS_SOURCE_ID).withProperties(
                PropertyFactory.circleRadius(
                    Expression.match(Expression.get(STATE), Expression.literal(16f), Expression.stop(SELECTED, 22f)),
                ),
                PropertyFactory.circleColor(byState(look.fill, look.mutedFill, look.selectedFill)),
                PropertyFactory.circleStrokeWidth(3f),
                PropertyFactory.circleStrokeColor(look.ring),
            ),
        )
        style.addLayer(
            SymbolLayer(PINS_LABEL_LAYER, PINS_SOURCE_ID).withProperties(
                PropertyFactory.textField(Expression.get(LABEL)),
                PropertyFactory.textFont(arrayOf(PIN_FONT)),
                PropertyFactory.textSize(13f),
                PropertyFactory.textColor(byState(look.text, look.mutedText, look.selectedText)),
                PropertyFactory.textAllowOverlap(true),
                PropertyFactory.textIgnorePlacement(true),
            ),
        )
    }
}

private fun byState(bright: String, muted: String, selected: String): Expression = Expression.match(
    Expression.get(STATE),
    Expression.color(Color.parseColor(bright)),
    Expression.stop(MUTED, Expression.color(Color.parseColor(muted))),
    Expression.stop(SELECTED, Expression.color(Color.parseColor(selected))),
)

/** Which pin, if any, is under a tap. */
internal fun pinAt(map: MapLibreMap, point: LatLng): Int? {
    val screen = map.projection.toScreenLocation(point)
    return map.queryRenderedFeatures(screen, PINS_LAYER, PINS_LABEL_LAYER)
        .firstNotNullOfOrNull { feature -> feature.getNumberProperty(INDEX)?.toInt() }
}

/**
 * Fit the vehicle and every pin in view, keeping [topPx] and [bottomPx] clear
 * for whatever floats over the map. With no pins yet, simply go to the vehicle.
 */
internal fun framePins(
    map: MapLibreMap,
    pins: List<MapPin>,
    position: Position?,
    topPx: Int,
    bottomPx: Int,
    reducedMotion: Boolean,
) {
    val points = buildList {
        pins.forEach { add(LatLng(it.latitude, it.longitude)) }
        position?.let { add(LatLng(it.latitude, it.longitude)) }
    }
    val update = when {
        points.isEmpty() -> return
        points.size == 1 -> CameraUpdateFactory.newLatLngZoom(points.first(), PIN_ALONE_ZOOM)
        else -> {
            val bounds = runCatching { LatLngBounds.Builder().includes(points).build() }.getOrNull() ?: return
            CameraUpdateFactory.newLatLngBounds(bounds, PIN_PADDING_PX, topPx + PIN_PADDING_PX, PIN_PADDING_PX, bottomPx + PIN_PADDING_PX)
        }
    }
    runCatching {
        if (reducedMotion) map.moveCamera(update) else map.animateCamera(update, PIN_FRAME_MS)
    }.onFailure { error ->
        DebugLog.debug("map", "Could not frame the pins: ${error.message}")
    }
}

/** The pins' source, so a map can tell whether its style still holds them. */
internal const val PINS_SOURCE_ID = "saarthi-pins"
private const val PINS_LAYER = "saarthi-pins-disc"
private const val PINS_LABEL_LAYER = "saarthi-pins-label"
private const val INDEX = "index"
private const val LABEL = "label"
private const val STATE = "state"
private const val SELECTED = "selected"
private const val BRIGHT = "bright"
private const val MUTED = "muted"

/** A bold face the OpenFreeMap styles ship glyphs for. */
private const val PIN_FONT = "Noto Sans Bold"
private const val PIN_ALONE_ZOOM = 14.0
private const val PIN_PADDING_PX = 90
private const val PIN_FRAME_MS = 900
