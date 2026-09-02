package com.saarthi.terminal.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.saarthi.terminal.BuildConfig
import com.saarthi.terminal.telemetry.Position
import com.saarthi.terminal.util.DebugLog
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.sources.GeoJsonSource

/**
 * The cockpit map.
 *
 * MapLibre against the same OpenFreeMap vector styles the web app renders — see
 * `apps/web/src/features/maps/map-config.ts`. That is not a coincidence, and it
 * is worth being explicit about why:
 *
 *  * **The same basemap means the same map.** A driver describing a junction to
 *    a dispatcher is describing something the dispatcher can see, drawn the same
 *    way. Two different renderers on two different tile sets would eventually
 *    disagree about a road, and the disagreement would surface during an
 *    incident.
 *  * **No key, no account, no per-request cost.** OpenFreeMap permits commercial
 *    use with no registration, so a fleet fitting a hundred terminals does not
 *    acquire a hundred devices' worth of map billing, and no API key ships
 *    inside the APK.
 *
 * The camera follows the vehicle and rotates with its heading, because a driver
 * reads a map that points where they are going. Under reduced motion it stops
 * rotating and stops easing — the position still updates, it simply does not
 * animate.
 *
 * Two things the first version got wrong, both about the driver's own position:
 *
 *  * **The vehicle was never drawn.** The map centred on it and showed nothing
 *    there. A route line and a destination pin over an unmarked map leave the
 *    driver to infer that the middle of the screen is them — the inference that
 *    fails the moment they pan, and the one they most need to be sure of.
 *  * **Panning fought the camera.** Every fix snapped the view back, so looking
 *    ahead down the route was impossible. A drag now hands control to the driver,
 *    and [followVehicle] says whether the camera is still tracking, so the
 *    cockpit can offer the way back.
 */
@Composable
fun TerminalMap(
    position: Position?,
    headingDegrees: Double?,
    modifier: Modifier = Modifier,
    /** True while the vehicle is moving. Tilts the camera into a driving view. */
    driving: Boolean = false,
    /**
     * The route to draw, as (latitude, longitude) pairs.
     *
     * Empty when the driver is not navigating. A route is fetched once, when a
     * destination is chosen, so this changes rarely.
     */
    routeGeometry: List<Pair<Double, Double>> = emptyList(),
    /** Where the route ends. Marked, so the driver can see what they picked. */
    destination: Pair<Double, Double>? = null,
    /**
     * Whether the camera should track the vehicle.
     *
     * False after the driver pans away, until they ask to be recentred.
     */
    followVehicle: Boolean = true,
    /** Raised when a drag or a pinch moves the camera, so following can stop. */
    onUserPannedMap: () -> Unit = {},
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val reducedMotion = LocalReducedMotion.current

    val mapView = remember { mutableMapReference() }

    // MapLibre's MapView is an Android View with its own lifecycle that must be
    // driven by hand. Missing any of these leaks the GL surface, which on a
    // terminal running for a twelve-hour shift is not a theoretical problem.
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            val view = mapView.value ?: return@LifecycleEventObserver
            when (event) {
                Lifecycle.Event.ON_START -> view.onStart()
                Lifecycle.Event.ON_RESUME -> view.onResume()
                Lifecycle.Event.ON_PAUSE -> view.onPause()
                Lifecycle.Event.ON_STOP -> view.onStop()
                Lifecycle.Event.ON_DESTROY -> view.onDestroy()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            mapView.value?.onDestroy()
            mapView.value = null
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { context ->
            MapView(context).also { view ->
                mapView.value = view
                view.onCreate(null)
                view.getMapAsync { map ->
                    map.setStyle(BuildConfig.MAP_STYLE_URL) { style ->
                        DebugLog.info("map", "Basemap loaded")
                        drawRoute(style, routeGeometry, destination)
                        drawVehicle(style, position, headingDegrees)
                    }
                    /*
                     * A gesture means the driver wants to look somewhere else.
                     * Reported so the caller can stop recentring and offer the
                     * way back — without this the camera snapped to the vehicle
                     * on the next fix and the map ahead could never be read.
                     */
                    map.addOnCameraMoveStartedListener { reason ->
                        if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) {
                            onUserPannedMap()
                        }
                    }
                    map.uiSettings.apply {
                        // A driver does not pinch-rotate a map at 60 km/h, and a
                        // map that has been accidentally rotated is a map that is
                        // now wrong. Panning and zooming stay, so a stationary
                        // driver can look ahead.
                        isRotateGesturesEnabled = false
                        isTiltGesturesEnabled = false
                        isCompassEnabled = false
                        // Attribution stays. OpenStreetMap's licence requires it,
                        // and removing it would be both a legal and a bad-faith
                        // choice.
                        isAttributionEnabled = true
                        isLogoEnabled = true
                    }
                    applyCamera(map, position, headingDegrees, driving, reducedMotion)
                }
            }
        },
        update = { view ->
            view.getMapAsync { map ->
                map.style?.let { style ->
                    drawRoute(style, routeGeometry, destination)
                    drawVehicle(style, position, headingDegrees)
                }
                // The marker keeps updating either way. Only the camera stops
                // when the driver has taken it somewhere.
                if (followVehicle) {
                    applyCamera(map, position, headingDegrees, driving, reducedMotion)
                }
            }
        },
    )
}

private fun applyCamera(
    map: MapLibreMap,
    position: Position?,
    headingDegrees: Double?,
    driving: Boolean,
    reducedMotion: Boolean,
) {
    if (position == null) return

    val camera = CameraPosition.Builder()
        .target(LatLng(position.latitude, position.longitude))
        // Closer while moving: a driver needs the next two hundred metres, not
        // the next five kilometres. Stationary, the wider view is more useful
        // for finding a gate or a bay.
        .zoom(if (driving) 16.5 else 14.5)
        .tilt(if (driving && !reducedMotion) 50.0 else 0.0)
        .bearing(if (driving && !reducedMotion) (headingDegrees ?: 0.0) else 0.0)
        .build()

    if (reducedMotion) {
        map.moveCamera(CameraUpdateFactory.newCameraPosition(camera))
    } else {
        // Just under the telemetry interval, so one animation finishes before
        // the next fix arrives and the camera never fights itself.
        map.animateCamera(CameraUpdateFactory.newCameraPosition(camera), 900)
    }
}

/**
 * Where the vehicle is, and which way it is pointing.
 *
 * Stacked circles rather than a bitmap icon: a soft halo, a white ring and a
 * solid core. It costs no drawable, stays crisp at every zoom, and reads over
 * both a pale motorway and a dark park — the same reasoning as drawing the
 * route as a casing under a core.
 *
 * The heading is a short line from the marker rather than a rotated icon, so a
 * stationary driver can tell which way the cab faces without waiting for the
 * camera to rotate — and it simply disappears when no heading is reported,
 * rather than defaulting to north and pointing somewhere wrong.
 */
private fun drawVehicle(
    style: Style,
    position: Position?,
    headingDegrees: Double?,
) {
    setGeoJson(style, VEHICLE_SOURCE, pointFeature(position?.let { it.latitude to it.longitude })) {
        style.addLayer(
            CircleLayer(VEHICLE_HALO_LAYER, VEHICLE_SOURCE).withProperties(
                PropertyFactory.circleRadius(22f),
                PropertyFactory.circleColor("#2B41B8"),
                PropertyFactory.circleOpacity(0.16f),
            ),
        )
        style.addLayer(
            CircleLayer(VEHICLE_LAYER, VEHICLE_SOURCE).withProperties(
                PropertyFactory.circleRadius(9f),
                PropertyFactory.circleColor("#2B41B8"),
                PropertyFactory.circleStrokeWidth(3.5f),
                PropertyFactory.circleStrokeColor("#FFFFFF"),
            ),
        )
    }

    val heading = if (position == null || headingDegrees == null) {
        EMPTY_GEOJSON
    } else {
        lineFeature(headingStub(position, headingDegrees))
    }
    setGeoJson(style, HEADING_SOURCE, heading) {
        style.addLayer(
            LineLayer(HEADING_LAYER, HEADING_SOURCE).withProperties(
                PropertyFactory.lineColor("#2B41B8"),
                PropertyFactory.lineWidth(4f),
                PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
                PropertyFactory.lineOpacity(0.9f),
            ),
        )
    }
}

/**
 * Twenty-five metres ahead of the vehicle, along its heading.
 *
 * Flat-earth arithmetic on purpose. Over twenty-five metres the error is well
 * under a centimetre, and a great-circle projection here would be precision
 * spent on a decoration.
 */
private fun headingStub(position: Position, headingDegrees: Double): List<Pair<Double, Double>> {
    val radians = Math.toRadians(headingDegrees)
    val northMetres = 25.0 * Math.cos(radians)
    val eastMetres = 25.0 * Math.sin(radians)
    val latitude = position.latitude + northMetres / 111_320.0
    val metresPerDegreeLongitude =
        111_320.0 * Math.cos(Math.toRadians(position.latitude)).coerceAtLeast(1e-6)
    val longitude = position.longitude + eastMetres / metresPerDegreeLongitude
    return listOf(position.latitude to position.longitude, latitude to longitude)
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
 */
private fun drawRoute(
    style: Style,
    geometry: List<Pair<Double, Double>>,
    destination: Pair<Double, Double>?,
) {
    setGeoJson(style, ROUTE_SOURCE, lineFeature(geometry)) {
        style.addLayer(
            LineLayer(ROUTE_CASING_LAYER, ROUTE_SOURCE).withProperties(
                PropertyFactory.lineColor("#0B1020"),
                PropertyFactory.lineWidth(11f),
                PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
                PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
                PropertyFactory.lineOpacity(0.85f),
            ),
        )
        style.addLayer(
            LineLayer(ROUTE_LAYER, ROUTE_SOURCE).withProperties(
                // Saarthi indigo, bright variant — the hue the cockpit uses for
                // anything the driver is meant to follow.
                PropertyFactory.lineColor("#7A93FA"),
                PropertyFactory.lineWidth(6f),
                PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
                PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
            ),
        )
    }

    setGeoJson(style, DESTINATION_SOURCE, pointFeature(destination)) {
        style.addLayer(
            CircleLayer(DESTINATION_LAYER, DESTINATION_SOURCE).withProperties(
                PropertyFactory.circleRadius(9f),
                PropertyFactory.circleColor("#FBA834"),
                PropertyFactory.circleStrokeWidth(3f),
                PropertyFactory.circleStrokeColor("#0B1020"),
            ),
        )
    }
}

/**
 * Set a source's data, creating it and its layers on first use.
 *
 * The create-once/update-forever split is the whole point: clearing a route
 * assigns an empty FeatureCollection rather than tearing down layers, so there
 * is no window in which a redraw can race a removal.
 */
private fun setGeoJson(
    style: Style,
    sourceId: String,
    json: String,
    addLayers: () -> Unit,
) {
    val existing = style.getSourceAs<GeoJsonSource>(sourceId)
    if (existing != null) {
        existing.setGeoJson(json)
        return
    }
    runCatching {
        style.addSource(GeoJsonSource(sourceId, json))
        addLayers()
    }.onFailure { error ->
        // A style still loading, or already torn down. The map is still usable
        // without the overlay, and the next update adds it.
        DebugLog.debug("map", "Could not add $sourceId: ${error.message}")
    }
}

/** An empty collection draws nothing, which is how a route is cleared. */
private const val EMPTY_GEOJSON = "{\"type\":\"FeatureCollection\",\"features\":[]}"

private fun lineFeature(geometry: List<Pair<Double, Double>>): String {
    if (geometry.isEmpty()) return EMPTY_GEOJSON
    // GeoJSON is [longitude, latitude], the opposite order to everything else
    // in this app.
    val coordinates = geometry.joinToString(",") { (lat, lng) -> "[$lng,$lat]" }
    return "{\"type\":\"Feature\",\"properties\":{},\"geometry\":" +
        "{\"type\":\"LineString\",\"coordinates\":[$coordinates]}}"
}

private fun pointFeature(point: Pair<Double, Double>?): String {
    if (point == null) return EMPTY_GEOJSON
    return "{\"type\":\"Feature\",\"properties\":{},\"geometry\":" +
        "{\"type\":\"Point\",\"coordinates\":[${point.second},${point.first}]}}"
}

private const val ROUTE_SOURCE = "saarthi-route"
private const val ROUTE_CASING_LAYER = "saarthi-route-casing"
private const val ROUTE_LAYER = "saarthi-route-line"
private const val DESTINATION_SOURCE = "saarthi-destination"
private const val DESTINATION_LAYER = "saarthi-destination-point"
private const val VEHICLE_SOURCE = "saarthi-vehicle"
private const val VEHICLE_HALO_LAYER = "saarthi-vehicle-halo"
private const val VEHICLE_LAYER = "saarthi-vehicle-point"
private const val HEADING_SOURCE = "saarthi-heading"
private const val HEADING_LAYER = "saarthi-heading-line"

/** A mutable holder for the MapView, kept out of recomposition. */
private fun mutableMapReference(): androidx.compose.runtime.MutableState<MapView?> =
    androidx.compose.runtime.mutableStateOf(null)
