package com.saarthi.core.ui

import android.content.Context
import android.graphics.Canvas
import androidx.annotation.DrawableRes
import androidx.appcompat.content.res.AppCompatResources
import androidx.core.graphics.createBitmap
import com.saarthi.core.domain.RouteState
import com.saarthi.core.domain.TrailPoint
import com.saarthi.core.telemetry.Position
import com.saarthi.core.util.DebugLog
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonOptions
import org.maplibre.android.style.sources.GeoJsonSource
import java.util.WeakHashMap

/*
 * What the app draws over the basemap: the covered-path trail, the route, its
 * destination and the vehicle — in that order, bottom to top, because each
 * layer is created the first time it is drawn and `TerminalMap` draws them in
 * this order.
 */

/**
 * Put the right vehicle silhouette into the style.
 *
 * Registered once per style and per type. `getImage` is checked first because
 * this runs on every recomposition — a speed change, a battery tick — and
 * decoding a vector to a bitmap sixty times a minute on a low-end tablet is a
 * cost with nothing to show for it.
 */
internal fun registerVehicleIcon(context: Context, style: Style, @DrawableRes marker: Int) {
    val id = vehicleIconId(marker)
    if (style.getImage(id) != null) return

    val drawable = AppCompatResources.getDrawable(context, marker) ?: return
    val bitmap = createBitmap(drawable.intrinsicWidth, drawable.intrinsicHeight)
    val canvas = Canvas(bitmap)
    drawable.setBounds(0, 0, canvas.width, canvas.height)
    drawable.draw(canvas)
    style.addImage(id, bitmap)
}

/** The style's name for a marker image — one per drawable, whichever look drew it. */
private fun vehicleIconId(@DrawableRes marker: Int) = "$VEHICLE_ICON-$marker"

/**
 * Where the vehicle is, and which way it is pointing.
 *
 * The marker is the vehicle itself — a lorry for a lorry, a car for a car —
 * drawn plan-view and rotated to the heading. A generic dot told the driver
 * where they were; this also tells anyone glancing at the screen *what* is
 * there, which matters on a dispatcher's map and matters again in a yard where
 * several Saarthi vehicles are parked together.
 *
 * A soft halo sits under it, because a silhouette alone can vanish against a
 * built-up basemap in a way a haloed one cannot.
 *
 * `iconRotationAlignment` is pinned to the map rather than the viewport, so the
 * vehicle keeps pointing at the road it is on when the camera rotates into the
 * driving view. With no heading reported the icon simply renders unrotated
 * rather than snapping to north and pointing somewhere wrong.
 */
internal fun drawVehicle(
    style: Style,
    position: Position?,
    headingDegrees: Double?,
    @DrawableRes marker: Int,
    look: MapLook,
) {
    val point = position?.let { it.latitude to it.longitude }
    setGeoJson(style, VEHICLE_SOURCE, pointFeature(point, headingDegrees), fullZoomRange()) {
        style.addLayer(
            CircleLayer(VEHICLE_HALO_LAYER, VEHICLE_SOURCE).withProperties(
                PropertyFactory.circleRadius(look.haloRadius),
                PropertyFactory.circleColor(look.haloColor),
                PropertyFactory.circleOpacity(look.haloOpacity),
            ),
        )
        style.addLayer(
            SymbolLayer(VEHICLE_LAYER, VEHICLE_SOURCE).withProperties(
                PropertyFactory.iconImage(vehicleIconId(marker)),
                PropertyFactory.iconRotate(Expression.get(HEADING_PROPERTY)),
                PropertyFactory.iconRotationAlignment(Property.ICON_ROTATION_ALIGNMENT_MAP),
                PropertyFactory.iconAllowOverlap(true),
                PropertyFactory.iconIgnorePlacement(true),
                PropertyFactory.iconSize(look.markerScale),
            ),
        )
    }

    // The layer is created once; a vehicle whose type arrives later — or a
    // driver signing on to a different vehicle — must still get its own shape.
    val icon = vehicleIconId(marker)
    (style.getLayer(VEHICLE_LAYER) as? SymbolLayer)?.let { layer ->
        if (layer.iconImage.value != icon) layer.setProperties(PropertyFactory.iconImage(icon))
    }
}

/**
 * Draw or clear the route line.
 *
 * A GeoJSON source updated in place rather than layers added and removed. The
 * update path runs on every recomposition — a speed change, a battery tick — and
 * adding a layer that already exists throws, while removing and re-adding one
 * makes the line flicker on a screen a driver is looking at.
 *
 * The line is drawn twice: a wide dark casing beneath a bright core. That is
 * what keeps a route legible over both a pale motorway and a dark park, and it
 * is cheaper and far more reliable on low-end hardware than any blur or glow.
 *
 * **The geometry is only re-serialised when it changes.** A route is thousands
 * of coordinates; building that string and handing it to MapLibre to reparse on
 * every recomposition was tens of milliseconds of main-thread work several times
 * a second, for a line that changes about once a journey. The signature stored
 * on the source is what makes the common case free.
 */
internal fun drawRoute(
    style: Style,
    geometry: List<Pair<Double, Double>>,
    destination: Pair<Double, Double>?,
    look: MapLook,
) {
    val signature = routeSignature(geometry)
    if (routeSignatures[style] != signature || style.getSourceAs<GeoJsonSource>(ROUTE_SOURCE) == null) {
        setGeoJson(style, ROUTE_SOURCE, lineFeature(geometry)) {
            style.addLayer(
                LineLayer(ROUTE_CASING_LAYER, ROUTE_SOURCE).withProperties(
                    PropertyFactory.lineColor(look.casingColor),
                    PropertyFactory.lineWidth(look.casingWidth),
                    PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
                    PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
                    PropertyFactory.lineOpacity(look.casingOpacity),
                ),
            )
            style.addLayer(
                LineLayer(ROUTE_LAYER, ROUTE_SOURCE).withProperties(
                    PropertyFactory.lineColor(look.routeColor),
                    PropertyFactory.lineWidth(look.routeWidth),
                    PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
                    PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
                ),
            )
        }
        routeSignatures[style] = signature
    }

    setGeoJson(style, DESTINATION_SOURCE, pointFeature(destination)) {
        style.addLayer(
            CircleLayer(DESTINATION_LAYER, DESTINATION_SOURCE).withProperties(
                PropertyFactory.circleRadius(look.destinationRadius),
                PropertyFactory.circleColor(look.destinationColor),
                PropertyFactory.circleStrokeWidth(look.destinationRingWidth),
                PropertyFactory.circleStrokeColor(look.destinationRing),
            ),
        )
    }
}

/**
 * A cheap identity for a route.
 *
 * Size and both ends. Two different routes to the same destination with the same
 * number of points would collide — which is why a re-route rebuilds the map's
 * source through the style-missing branch above as well, and why this is only
 * ever used to *skip* work rather than to decide correctness.
 */
private fun routeSignature(geometry: List<Pair<Double, Double>>): String {
    if (geometry.isEmpty()) return "empty"
    val first = geometry.first()
    val last = geometry.last()
    val middle = geometry[geometry.size / 2]
    return "${geometry.size}:${first.first},${first.second}:" +
        "${middle.first},${middle.second}:${last.first},${last.second}"
}

/**
 * The route each map last drew, by that map's style.
 *
 * Per map, not one for the app. The driver app has several — the Map tab, the
 * services sheet, the trip planner — and with a single shared value the sheet
 * drawing "no route" as it closed told the Map tab its line was already gone,
 * so a cancelled route stayed drawn. A style is one map's, and a new style
 * (a theme change, a reload) starts with no entry, so it always draws. Weak, so
 * a map that has gone takes its entry with it; drawing is on the main thread
 * only, so the map needs no lock.
 */
private val routeSignatures = WeakHashMap<Style, String>()

/**
 * Set a source's data, creating it and its layers on first use.
 *
 * The create-once/update-forever split is the whole point: clearing a route
 * assigns an empty FeatureCollection rather than tearing down layers, so there
 * is no window in which a redraw can race a removal.
 */
internal fun setGeoJson(
    style: Style,
    sourceId: String,
    json: String,
    options: GeoJsonOptions? = null,
    addLayers: () -> Unit,
) {
    val existing = style.getSourceAs<GeoJsonSource>(sourceId)
    if (existing != null) {
        existing.setGeoJson(json)
        return
    }
    runCatching {
        style.addSource(
            if (options == null) GeoJsonSource(sourceId, json) else GeoJsonSource(sourceId, json, options),
        )
        addLayers()
    }.onFailure { error ->
        // A style still loading, or already torn down. The map is still usable
        // without the overlay, and the next update adds it.
        DebugLog.debug("map", "Could not add $sourceId: ${error.message}")
    }
}

/** An empty collection draws nothing, which is how a route is cleared. */
internal const val EMPTY_GEOJSON = "{\"type\":\"FeatureCollection\",\"features\":[]}"

private fun lineFeature(geometry: List<Pair<Double, Double>>): String {
    if (geometry.isEmpty()) return EMPTY_GEOJSON
    // GeoJSON is [longitude, latitude], the opposite order to everything else
    // in this app.
    val coordinates = geometry.joinToString(",") { (lat, lng) -> "[$lng,$lat]" }
    return "{\"type\":\"Feature\",\"properties\":{},\"geometry\":" +
        "{\"type\":\"LineString\",\"coordinates\":[$coordinates]}}"
}

private fun pointFeature(point: Pair<Double, Double>?, headingDegrees: Double? = null): String {
    if (point == null) return EMPTY_GEOJSON
    // The heading rides on the feature rather than on the layer, so the icon
    // rotates with the data instead of needing the layer rebuilt on every fix.
    val properties = if (headingDegrees == null) "{}" else "{\"$HEADING_PROPERTY\":$headingDegrees}"
    return "{\"type\":\"Feature\",\"properties\":$properties,\"geometry\":" +
        "{\"type\":\"Point\",\"coordinates\":[${point.second},${point.first}]}}"
}

private const val ROUTE_SOURCE = "saarthi-route"
internal const val ROUTE_CASING_LAYER = "saarthi-route-casing"
private const val ROUTE_LAYER = "saarthi-route-line"
private const val DESTINATION_SOURCE = "saarthi-destination"
private const val DESTINATION_LAYER = "saarthi-destination-point"
private const val VEHICLE_SOURCE = "saarthi-vehicle"
private const val VEHICLE_HALO_LAYER = "saarthi-vehicle-halo"
private const val VEHICLE_LAYER = "saarthi-vehicle-icon"
private const val VEHICLE_ICON = "saarthi-vehicle-image"
private const val HEADING_PROPERTY = "heading"

/**
 * Where the vehicle has been, coloured by how it got there.
 *
 * One LineString per run of one state, each run starting where the last one
 * ended so the line has no gap at a colour change. Drawn under the route, so
 * the road still to come stays the brightest thing on the map, with a dark
 * casing that keeps the colours readable on a pale or a dark basemap alike.
 *
 * Re-serialised only when the trail has changed — like the route, it can be
 * thousands of points, and this runs on every recomposition.
 */
internal fun drawTrail(style: Style, trail: List<TrailPoint>, look: MapLook) {
    val signature = trailSignature(trail)
    if (trailSignatures[style] == signature && style.getSource(TRAIL_SOURCE) != null) return

    setGeoJson(style, TRAIL_SOURCE, trailFeatures(trail), fullZoomRange()) {
        style.addLayer(
            LineLayer(TRAIL_CASING_LAYER, TRAIL_SOURCE).withProperties(
                PropertyFactory.lineColor(look.trailCasingColor),
                PropertyFactory.lineWidth(look.trailWidth + TRAIL_CASING_EXTRA),
                PropertyFactory.lineOpacity(look.trailCasingOpacity),
                PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
                PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
            ),
        )
        style.addLayer(
            LineLayer(TRAIL_LAYER, TRAIL_SOURCE).withProperties(
                PropertyFactory.lineColor(
                    Expression.match(
                        Expression.get(STATE_PROPERTY),
                        Expression.literal(look.trailNoTripColor),
                        Expression.stop(RouteState.ON_ROUTE.name, look.trailOnRouteColor),
                        Expression.stop(RouteState.OFF_ROUTE.name, look.trailOffRouteColor),
                        Expression.stop(RouteState.ALTERNATE.name, look.trailAlternateColor),
                    ),
                ),
                PropertyFactory.lineWidth(look.trailWidth),
                PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
                PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
            ),
        )
    }
    trailSignatures[style] = signature
}

private fun trailFeatures(trail: List<TrailPoint>): String {
    if (trail.size < 2) return EMPTY_GEOJSON
    val features = mutableListOf<String>()
    var run = StringBuilder()
    var runState = trail.first().state
    var runPoints = 0
    var previous: TrailPoint? = null

    fun close() {
        if (runPoints >= 2) {
            features += "{\"type\":\"Feature\",\"properties\":{\"$STATE_PROPERTY\":\"${runState.name}\"}," +
                "\"geometry\":{\"type\":\"LineString\",\"coordinates\":[$run]}}"
        }
    }

    for (point in trail) {
        if (point.state != runState) {
            close()
            run = StringBuilder()
            runState = point.state
            runPoints = 0
            // Start the new run where the old one ended, so the colours meet.
            previous?.let {
                run.append("[${it.longitude},${it.latitude}]")
                runPoints = 1
            }
        }
        if (runPoints > 0) run.append(',')
        run.append("[${point.longitude},${point.latitude}]")
        runPoints += 1
        previous = point
    }
    close()

    return "{\"type\":\"FeatureCollection\",\"features\":[${features.joinToString(",")}]}"
}

private fun trailSignature(trail: List<TrailPoint>): String {
    if (trail.isEmpty()) return "empty"
    val first = trail.first()
    val last = trail.last()
    return "${trail.size}:${first.latitude},${first.longitude}:${last.latitude},${last.longitude}:${last.state}"
}

/** The trail each map last drew — see [routeSignatures] for why per map. */
private val trailSignatures = WeakHashMap<Style, String>()

/**
 * A source tiled down to street level and beyond.
 *
 * MapLibre tiles a GeoJSON source to z18 by default and stretches that tile
 * past it. For a single moving point, and a trail drawn under it, building the
 * tiles all the way down keeps both crisp and present however far the driver
 * zooms in.
 */
private fun fullZoomRange(): GeoJsonOptions = GeoJsonOptions().withMaxZoom(OVERLAY_MAX_ZOOM)

private const val TRAIL_SOURCE = "saarthi-trail"
private const val TRAIL_CASING_LAYER = "saarthi-trail-casing"
private const val TRAIL_LAYER = "saarthi-trail-line"
private const val STATE_PROPERTY = "state"
private const val TRAIL_CASING_EXTRA = 3f
private const val OVERLAY_MAX_ZOOM = 22
