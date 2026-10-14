package com.saarthi.owner.ui.map

import android.graphics.Color
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.saarthi.owner.BuildConfig
import com.saarthi.owner.ui.design.Saarthi
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdate
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource

/** How a vehicle is drawn: where it is, and what it is doing. */
@Immutable
data class MapVehicle(
    val id: String,
    val latitude: Double,
    val longitude: Double,
    val state: MarkerState,
    /** Shown beside the picked vehicle — its plate. */
    val label: String,
)

enum class MarkerState { MOVING, IDLE, OFFLINE, ALERT }

/**
 * The fleet on one map — the driver app's MapLibre map against the same
 * OpenFreeMap styles the web app draws, for a whole fleet rather than one cab.
 *
 * Each vehicle is a ringed disc coloured by what it is doing; the picked one
 * is larger, haloed and labelled with its plate. A tap on a disc picks it, a
 * tap anywhere else lets go. The basemap follows the app's light or dark
 * theme. The camera moves only when asked — by [frameAllRequest] or
 * [focusRequest] — never on a refresh, so a person reading the map is not
 * yanked about every time the positions arrive.
 */
@Composable
fun VehicleMap(
    vehicles: List<MapVehicle>,
    selectedId: String?,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
    /** A route to draw, as (latitude, longitude) pairs. */
    route: List<Pair<Double, Double>> = emptyList(),
    /** Bumped to fit every vehicle in view once. */
    frameAllRequest: Int = 0,
    /** Bumped to fly to the picked vehicle once. */
    focusRequest: Int = 0,
    /** Pixels kept clear at the top and foot when framing, for what floats over the map. */
    topPaddingPx: Int = 0,
    bottomPaddingPx: Int = 0,
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val reduced = Saarthi.reducedMotion
    val dark = Saarthi.colors.dark
    val styleUrl = if (dark) BuildConfig.MAP_STYLE_URL else BuildConfig.MAP_STYLE_URL_LIGHT

    val viewHolder = remember { mutableStateOf<MapView?>(null) }
    val mapState = remember { mutableStateOf<MapLibreMap?>(null) }
    val map by mapState
    val loadedStyle = remember { arrayOfNulls<String>(1) }

    val currentVehicles by rememberUpdatedState(vehicles)
    val currentSelected by rememberUpdatedState(selectedId)
    val currentRoute by rememberUpdatedState(route)
    val select by rememberUpdatedState(onSelect)
    val vehiclesJson = remember(vehicles, selectedId) { vehiclesJson(vehicles, selectedId) }
    val routeJson = remember(route) { routeJson(route) }

    // MapView has its own lifecycle that must be driven by hand; missing any of
    // these leaks the GL surface.
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            val view = viewHolder.value ?: return@LifecycleEventObserver
            when (event) {
                Lifecycle.Event.ON_START -> view.onStart()
                Lifecycle.Event.ON_RESUME -> view.onResume()
                Lifecycle.Event.ON_PAUSE -> view.onPause()
                Lifecycle.Event.ON_STOP -> view.onStop()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            viewHolder.value?.let { view ->
                view.onPause()
                view.onStop()
                view.onDestroy()
            }
            viewHolder.value = null
            mapState.value = null
        }
    }

    // New positions or a new pick: redraw the discs in place.
    LaunchedEffect(map, vehiclesJson) {
        map?.style?.takeIf { it.isFullyLoaded }?.let { setSource(it, VEHICLES_SOURCE, vehiclesJson) }
    }
    LaunchedEffect(map, routeJson) {
        map?.style?.takeIf { it.isFullyLoaded }?.let { setSource(it, ROUTE_SOURCE, routeJson) }
    }

    // The theme changed: restyle in place and draw everything onto it again.
    LaunchedEffect(map, styleUrl) {
        val current = map ?: return@LaunchedEffect
        if (loadedStyle[0] == null || loadedStyle[0] == styleUrl) return@LaunchedEffect
        loadedStyle[0] = styleUrl
        current.setStyle(styleUrl) { style -> drawAll(style, currentVehicles, currentSelected, currentRoute) }
    }

    LaunchedEffect(map, frameAllRequest) {
        val current = map ?: return@LaunchedEffect
        if (frameAllRequest == 0) return@LaunchedEffect
        val points = currentVehicles.map { LatLng(it.latitude, it.longitude) } +
            currentRoute.map { (lat, lng) -> LatLng(lat, lng) }
        frame(current, points, topPaddingPx, bottomPaddingPx, reduced)
    }

    LaunchedEffect(map, focusRequest) {
        val current = map ?: return@LaunchedEffect
        if (focusRequest == 0) return@LaunchedEffect
        val picked = currentVehicles.firstOrNull { it.id == currentSelected } ?: return@LaunchedEffect
        val update = centreOn(LatLng(picked.latitude, picked.longitude), topPaddingPx, bottomPaddingPx)
        runCatching { if (reduced) current.moveCamera(update) else current.animateCamera(update, CAMERA_MS) }
    }

    AndroidView(
        modifier = modifier,
        factory = { context ->
            MapView(context).also { view ->
                viewHolder.value = view
                // Started and resumed by the lifecycle observer above, which
                // replays the activity's current state as soon as it is added.
                view.onCreate(null)
                view.getMapAsync { ready ->
                    // Saarthi runs in India: before anything is framed, the map opens on it, not on the world.
                    ready.cameraPosition = CameraPosition.Builder().target(LatLng(INDIA_LAT, INDIA_LNG)).zoom(INDIA_ZOOM).build()
                    loadedStyle[0] = styleUrl
                    ready.setStyle(styleUrl) { style -> drawAll(style, currentVehicles, currentSelected, currentRoute) }
                    ready.uiSettings.apply {
                        isRotateGesturesEnabled = false
                        isTiltGesturesEnabled = false
                        isCompassEnabled = false
                        // OpenStreetMap's licence requires the credits; they stay.
                        isAttributionEnabled = true
                        isLogoEnabled = false
                    }
                    ready.addOnMapClickListener { point ->
                        val screen = ready.projection.toScreenLocation(point)
                        val id = ready.queryRenderedFeatures(screen, DISC_LAYER, HALO_LAYER)
                            .firstNotNullOfOrNull { it.getStringProperty(ID) }
                        select(id)
                        true
                    }
                    mapState.value = ready
                }
            }
        },
    )
}

private fun drawAll(style: Style, vehicles: List<MapVehicle>, selectedId: String?, route: List<Pair<Double, Double>>) {
    setSource(style, ROUTE_SOURCE, routeJson(route)) {
        style.addLayer(
            LineLayer(ROUTE_CASING_LAYER, ROUTE_SOURCE).withProperties(
                PropertyFactory.lineColor(Color.parseColor("#33727FF3")),
                PropertyFactory.lineWidth(12f),
                PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
                PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
            ),
        )
        style.addLayer(
            LineLayer(ROUTE_LAYER, ROUTE_SOURCE).withProperties(
                PropertyFactory.lineColor(Color.parseColor("#727FF3")),
                PropertyFactory.lineWidth(4.5f),
                PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
                PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
            ),
        )
    }
    setSource(style, VEHICLES_SOURCE, vehiclesJson(vehicles, selectedId)) {
        style.addLayer(
            CircleLayer(HALO_LAYER, VEHICLES_SOURCE).withProperties(
                PropertyFactory.circleRadius(Expression.match(Expression.get(PICKED), Expression.literal(16f), Expression.stop(true, 26f))),
                PropertyFactory.circleColor(byState()),
                PropertyFactory.circleOpacity(0.22f),
            ),
        )
        style.addLayer(
            CircleLayer(DISC_LAYER, VEHICLES_SOURCE).withProperties(
                PropertyFactory.circleRadius(Expression.match(Expression.get(PICKED), Expression.literal(8f), Expression.stop(true, 11f))),
                PropertyFactory.circleColor(byState()),
                PropertyFactory.circleStrokeWidth(3f),
                PropertyFactory.circleStrokeColor(Color.WHITE),
            ),
        )
        style.addLayer(
            SymbolLayer(LABEL_LAYER, VEHICLES_SOURCE)
                .withFilter(Expression.eq(Expression.get(PICKED), Expression.literal(true)))
                .withProperties(
                    PropertyFactory.textField(Expression.get(LABEL)),
                    PropertyFactory.textFont(arrayOf(LABEL_FONT)),
                    PropertyFactory.textSize(12f),
                    PropertyFactory.textOffset(arrayOf(0f, 2.2f)),
                    PropertyFactory.textColor(Color.parseColor("#0F0F24")),
                    PropertyFactory.textHaloColor(Color.parseColor("#FACC15")),
                    PropertyFactory.textHaloWidth(4f),
                    PropertyFactory.textAllowOverlap(true),
                    PropertyFactory.textIgnorePlacement(true),
                ),
        )
    }
}

private fun byState(): Expression = Expression.match(
    Expression.get(STATE),
    Expression.color(Color.parseColor("#9F9FA8")),
    Expression.stop(MarkerState.MOVING.name, Expression.color(Color.parseColor("#3DAE79"))),
    Expression.stop(MarkerState.IDLE.name, Expression.color(Color.parseColor("#F2952C"))),
    Expression.stop(MarkerState.ALERT.name, Expression.color(Color.parseColor("#DF494E"))),
)

/** Update a source in place, or add it with its layers the first time. */
private fun setSource(style: Style, id: String, json: String, addLayers: (() -> Unit)? = null) {
    val existing = style.getSourceAs<GeoJsonSource>(id)
    if (existing != null) {
        existing.setGeoJson(json)
        return
    }
    if (addLayers == null) return
    runCatching {
        style.addSource(GeoJsonSource(id, json))
        addLayers()
    }
}

/** The vehicles as a FeatureCollection, the picked one last so it is drawn on top. */
private fun vehiclesJson(vehicles: List<MapVehicle>, selectedId: String?): String {
    val features = JSONArray()
    vehicles.sortedBy { it.id == selectedId }.forEach { vehicle ->
        features.put(
            JSONObject()
                .put("type", "Feature")
                .put(
                    "properties",
                    JSONObject()
                        .put(ID, vehicle.id)
                        .put(STATE, vehicle.state.name)
                        .put(LABEL, vehicle.label)
                        .put(PICKED, vehicle.id == selectedId),
                )
                .put(
                    "geometry",
                    JSONObject()
                        .put("type", "Point")
                        .put("coordinates", JSONArray().put(vehicle.longitude).put(vehicle.latitude)),
                ),
        )
    }
    return JSONObject().put("type", "FeatureCollection").put("features", features).toString()
}

private fun routeJson(route: List<Pair<Double, Double>>): String {
    if (route.size < 2) return JSONObject().put("type", "FeatureCollection").put("features", JSONArray()).toString()
    val coordinates = JSONArray()
    route.forEach { (lat, lng) -> coordinates.put(JSONArray().put(lng).put(lat)) }
    return JSONObject()
        .put("type", "Feature")
        .put("properties", JSONObject())
        .put("geometry", JSONObject().put("type", "LineString").put("coordinates", coordinates))
        .toString()
}

private fun frame(map: MapLibreMap, points: List<LatLng>, topPx: Int, bottomPx: Int, reduced: Boolean) {
    val update = when {
        points.isEmpty() -> return
        points.size == 1 -> centreOn(points.first(), topPx, bottomPx)
        else -> {
            val bounds = runCatching { LatLngBounds.Builder().includes(points).build() }.getOrNull() ?: return
            CameraUpdateFactory.newLatLngBounds(bounds, PADDING_PX, topPx + PADDING_PX, PADDING_PX, bottomPx + PADDING_PX)
        }
    }
    // A map measured at zero size during a layout pass cannot fit bounds; not worth a crash.
    runCatching { if (reduced) map.moveCamera(update) else map.animateCamera(update, CAMERA_MS) }
}

/**
 * One point in the middle of what is left uncovered — between whatever floats
 * at the top and the panel at the foot — not the middle of the whole map,
 * where a bottom sheet would hide it.
 */
private fun centreOn(point: LatLng, topPx: Int, bottomPx: Int): CameraUpdate =
    CameraUpdateFactory.newCameraPosition(
        CameraPosition.Builder()
            .target(point)
            .zoom(FOCUS_ZOOM)
            .padding(0.0, topPx.toDouble(), 0.0, bottomPx.toDouble())
            .build(),
    )

private const val INDIA_LAT = 22.6
private const val INDIA_LNG = 79.0
private const val INDIA_ZOOM = 3.6

private const val VEHICLES_SOURCE = "owner-vehicles"
private const val ROUTE_SOURCE = "owner-route"
private const val HALO_LAYER = "owner-vehicles-halo"
private const val DISC_LAYER = "owner-vehicles-disc"
private const val LABEL_LAYER = "owner-vehicles-label"
private const val ROUTE_CASING_LAYER = "owner-route-casing"
private const val ROUTE_LAYER = "owner-route-line"
private const val ID = "id"
private const val STATE = "state"
private const val LABEL = "label"
private const val PICKED = "picked"

/** A bold face the OpenFreeMap styles ship glyphs for. */
private const val LABEL_FONT = "Noto Sans Bold"
private const val FOCUS_ZOOM = 13.5
private const val PADDING_PX = 90
private const val CAMERA_MS = 900
