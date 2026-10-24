package com.saarthi.owner.ui.map

import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
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
import org.maplibre.android.maps.ImageStretches
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
    /** The vehicle's status (`ON_TRIP`, `AVAILABLE`…), which colours its disc as the web's map does. */
    val status: String? = null,
)

enum class MarkerState { MOVING, IDLE, OFFLINE, ALERT }

/** A fixed place marked on the map: where a trip picks up, and where it drops. */
@Immutable
data class MapPin(val id: String, val latitude: Double, val longitude: Double, val kind: PinKind)

/** Drawn as the route markers beside an address are: a ringed start, a solid end. */
enum class PinKind { PICKUP, DROP }

/**
 * How a stretch of driven road stood against the plan: the route state the
 * server stores on each fix, drawn in the colours the web app's trail uses.
 */
enum class TrailTone { ON_ROUTE, OFF_ROUTE, ALTERNATE, NO_TRIP }

/** One unbroken stretch of driven road, all of one tone. */
@Immutable
data class TrailRun(val points: List<Pair<Double, Double>>, val tone: TrailTone)

/**
 * The overlay colours as ARGB, shared by the map and by any key that names
 * them, so the two never drift apart — each the web map's own
 * (`map-config.ts` and `fleet-map.tsx`), so a dispatcher reads the phone's map
 * exactly as they read the web's.
 */
internal object OverlayInk {
    /** The planned road still ahead, on its navy casing. */
    val ROUTE: Int = 0xFF2563EB.toInt()
    val ROUTE_CASING: Int = 0xFF0B2A63.toInt()

    /** The planned road already behind the vehicle, dimmed back on its own casing. */
    val ROUTE_DRIVEN: Int = 0xFF7C8BA1.toInt()
    val ROUTE_DRIVEN_CASING: Int = 0xFF4A556B.toInt()

    val TRAIL_CASING: Int = 0xFF0F172A.toInt()

    /** Where a trip starts and where it ends. */
    val ORIGIN: Int = 0xFF15803D.toInt()
    val DESTINATION: Int = 0xFFB91C1C.toInt()

    fun tone(tone: TrailTone): Int = when (tone) {
        TrailTone.ON_ROUTE -> 0xFF16A34A.toInt()
        TrailTone.OFF_ROUTE -> 0xFFDC2626.toInt()
        TrailTone.ALTERNATE -> 0xFFD97706.toInt()
        TrailTone.NO_TRIP -> 0xFF2563EB.toInt()
    }

    /** A vehicle's disc: by its status, as the web colours it, and grey once it stops reporting. */
    fun vehicle(state: MarkerState, status: String?): Int = when {
        state == MarkerState.ALERT -> STATUS.getValue("EMERGENCY")
        state == MarkerState.OFFLINE -> STATUS.getValue("OFFLINE")
        status != null -> STATUS[status] ?: OTHER_STATUS
        state == MarkerState.MOVING -> STATUS.getValue("ON_TRIP")
        else -> STATUS.getValue("IDLE")
    }

    private val STATUS: Map<String, Int> = mapOf(
        "ON_TRIP" to 0xFF1D4ED8.toInt(),
        "LOADING" to 0xFF0284C7.toInt(),
        "UNLOADING" to 0xFF0284C7.toInt(),
        "AVAILABLE" to 0xFF15803D.toInt(),
        "ASSIGNED" to 0xFF0369A1.toInt(),
        "IDLE" to 0xFF64748B.toInt(),
        "OFFLINE" to 0xFF94A3B8.toInt(),
        "MAINTENANCE" to 0xFFB45309.toInt(),
        "EMERGENCY" to 0xFFB91C1C.toInt(),
        "SUSPENDED" to 0xFFB91C1C.toInt(),
    )
    private val OTHER_STATUS: Int = 0xFF334155.toInt()
}

/**
 * The fleet on one map — the driver app's MapLibre map against the same
 * OpenFreeMap styles the web app draws, for a whole fleet rather than one cab.
 *
 * Each vehicle is a ringed disc coloured by what it is doing; the picked one
 * is larger, haloed and labelled with its plate. A tap on a disc picks it, a
 * tap anywhere else lets go. Under them a planned [route] can be drawn, the
 * road already driven over it as a [trail], and [pins] at its ends. The
 * basemap follows the app's light or dark theme. The camera moves only when
 * asked — by [frameAllRequest] or [focusRequest] — never on a refresh, so a
 * person reading the map is not yanked about every time the positions arrive.
 */
@Composable
fun VehicleMap(
    vehicles: List<MapVehicle>,
    selectedId: String?,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
    /** A route to draw, as (latitude, longitude) pairs. */
    route: List<Pair<Double, Double>> = emptyList(),
    /** Where the vehicle stands on [route]: the road behind it is dimmed, as on the web. */
    routeCoveredTo: Pair<Double, Double>? = null,
    /** Road already driven, drawn over [route] stretch by stretch in its tone. */
    trail: List<TrailRun> = emptyList(),
    /** Places to mark under the vehicles, such as a pickup and a drop. */
    pins: List<MapPin> = emptyList(),
    /** Bumped to fit everything drawn in view once: vehicles, route, trail and pins. */
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
    val currentTrail by rememberUpdatedState(trail)
    val currentPins by rememberUpdatedState(pins)
    val select by rememberUpdatedState(onSelect)
    val vehiclesJson = remember(vehicles, selectedId) { vehiclesJson(vehicles, selectedId) }
    // Behind and ahead of the vehicle; all of it ahead until it is on the road.
    val split = remember(route, routeCoveredTo) {
        routeCoveredTo?.let { (lat, lng) -> splitRoute(route, lat, lng) }?.let { it.behind to it.ahead } ?: (emptyList<Pair<Double, Double>>() to route)
    }
    val currentSplit by rememberUpdatedState(split)
    val routeJson = remember(split) { routeJson(split.second) }
    val drivenJson = remember(split) { routeJson(split.first) }
    val trailJson = remember(trail) { trailJson(trail) }
    val pinsJson = remember(pins) { pinsJson(pins) }

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
    LaunchedEffect(map, routeJson, drivenJson) {
        map?.style?.takeIf { it.isFullyLoaded }?.let {
            setSource(it, ROUTE_SOURCE, routeJson)
            setSource(it, ROUTE_DRIVEN_SOURCE, drivenJson)
        }
    }
    LaunchedEffect(map, trailJson) {
        map?.style?.takeIf { it.isFullyLoaded }?.let { setSource(it, TRAIL_SOURCE, trailJson) }
    }
    LaunchedEffect(map, pinsJson) {
        map?.style?.takeIf { it.isFullyLoaded }?.let { setSource(it, PINS_SOURCE, pinsJson) }
    }

    // The theme changed: restyle in place and draw everything onto it again.
    LaunchedEffect(map, styleUrl) {
        val current = map ?: return@LaunchedEffect
        if (loadedStyle[0] == null || loadedStyle[0] == styleUrl) return@LaunchedEffect
        loadedStyle[0] = styleUrl
        current.setStyle(styleUrl) { style ->
            drawAll(style, currentVehicles, currentSelected, currentSplit, currentTrail, currentPins)
        }
    }

    LaunchedEffect(map, frameAllRequest) {
        val current = map ?: return@LaunchedEffect
        if (frameAllRequest == 0) return@LaunchedEffect
        val points = currentVehicles.map { LatLng(it.latitude, it.longitude) } +
            (currentRoute + currentTrail.flatMap { it.points }).map { (lat, lng) -> LatLng(lat, lng) } +
            currentPins.map { LatLng(it.latitude, it.longitude) }
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
                    ready.setStyle(styleUrl) { style ->
                        drawAll(style, currentVehicles, currentSelected, currentSplit, currentTrail, currentPins)
                    }
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

private fun drawAll(
    style: Style,
    vehicles: List<MapVehicle>,
    selectedId: String?,
    /** The planned road behind the vehicle, and ahead of it. */
    route: Pair<List<Pair<Double, Double>>, List<Pair<Double, Double>>>,
    trail: List<TrailRun>,
    pins: List<MapPin>,
) {
    setSource(style, ROUTE_DRIVEN_SOURCE, routeJson(route.first)) {
        addRouteLayers(style, ROUTE_DRIVEN_CASING_LAYER, ROUTE_DRIVEN_LAYER, ROUTE_DRIVEN_SOURCE, OverlayInk.ROUTE_DRIVEN_CASING, OverlayInk.ROUTE_DRIVEN)
    }
    setSource(style, ROUTE_SOURCE, routeJson(route.second)) {
        addRouteLayers(style, ROUTE_CASING_LAYER, ROUTE_LAYER, ROUTE_SOURCE, OverlayInk.ROUTE_CASING, OverlayInk.ROUTE)
    }
    // Over the route and under everything else: the road already driven, on
    // one shared dark casing so each tone stays distinct from the basemap's
    // own coloured roads, parks and water.
    setSource(style, TRAIL_SOURCE, trailJson(trail)) {
        style.addLayer(
            LineLayer(TRAIL_CASING_LAYER, TRAIL_SOURCE).withProperties(
                PropertyFactory.lineColor(OverlayInk.TRAIL_CASING),
                PropertyFactory.lineOpacity(0.7f),
                PropertyFactory.lineWidth(8f),
                PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
                PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
            ),
        )
        style.addLayer(
            LineLayer(TRAIL_LAYER, TRAIL_SOURCE).withProperties(
                PropertyFactory.lineColor(byTone()),
                PropertyFactory.lineWidth(4.5f),
                PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
                PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
            ),
        )
    }
    // The ends of the route in the web's colours: green where it starts, red where it ends.
    setSource(style, PINS_SOURCE, pinsJson(pins)) {
        style.addLayer(
            CircleLayer(PIN_LAYER, PINS_SOURCE).withProperties(
                PropertyFactory.circleRadius(7f),
                PropertyFactory.circleColor(
                    Expression.match(
                        Expression.get(KIND),
                        Expression.color(OverlayInk.ORIGIN),
                        Expression.stop(PinKind.DROP.name, Expression.color(OverlayInk.DESTINATION)),
                    ),
                ),
                PropertyFactory.circleStrokeWidth(3f),
                PropertyFactory.circleStrokeColor(Color.WHITE),
            ),
        )
    }
    setSource(style, VEHICLES_SOURCE, vehiclesJson(vehicles, selectedId)) {
        style.addLayer(
            CircleLayer(HALO_LAYER, VEHICLES_SOURCE).withProperties(
                PropertyFactory.circleRadius(Expression.match(Expression.get(PICKED), Expression.literal(16f), Expression.stop(true, 26f))),
                PropertyFactory.circleColor(Expression.toColor(Expression.get(INK))),
                PropertyFactory.circleOpacity(0.28f),
            ),
        )
        style.addLayer(
            CircleLayer(DISC_LAYER, VEHICLES_SOURCE).withProperties(
                PropertyFactory.circleRadius(Expression.match(Expression.get(PICKED), Expression.literal(8f), Expression.stop(true, 11f))),
                PropertyFactory.circleColor(Expression.toColor(Expression.get(INK))),
                PropertyFactory.circleStrokeWidth(3f),
                PropertyFactory.circleStrokeColor(Color.WHITE),
            ),
        )
        addPlateImage(style)
        style.addLayer(
            SymbolLayer(LABEL_LAYER, VEHICLES_SOURCE)
                .withFilter(Expression.eq(Expression.get(PICKED), Expression.literal(true)))
                .withProperties(
                    PropertyFactory.textField(Expression.get(LABEL)),
                    PropertyFactory.textFont(arrayOf(LABEL_FONT)),
                    PropertyFactory.textSize(12f),
                    PropertyFactory.textOffset(arrayOf(0f, 2.2f)),
                    PropertyFactory.textColor(Color.parseColor("#18181B")),
                    PropertyFactory.textAllowOverlap(true),
                    PropertyFactory.textIgnorePlacement(true),
                    // The plate behind the words, stretched to fit them. A text halo cannot be it: MapLibre
                    // clips a halo this wide to each glyph, which drew broken blocks with gaps at the spaces.
                    PropertyFactory.iconImage(PLATE_IMAGE),
                    PropertyFactory.iconTextFit(Property.ICON_TEXT_FIT_BOTH),
                    PropertyFactory.iconTextFitPadding(arrayOf(3f, 8f, 3f, 8f)),
                    PropertyFactory.iconAllowOverlap(true),
                    PropertyFactory.iconIgnorePlacement(true),
                ),
        )
    }
}

/**
 * The yellow number plate the picked vehicle's label sits on, as [PlateChip][com.saarthi.owner.ui.common.PlateChip]
 * draws it in the app: rounded corners that keep their shape, and a middle that stretches to the words.
 */
private fun addPlateImage(mapStyle: Style) {
    if (mapStyle.getImage(PLATE_IMAGE) != null) return
    val metrics = Resources.getSystem().displayMetrics
    val radius = PLATE_RADIUS_DP * metrics.density
    val border = metrics.density
    val side = (radius * 2 + 2).toInt()
    val bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888).apply { density = metrics.densityDpi }
    val canvas = Canvas(bitmap)
    val inset = border / 2
    val shape = RectF(inset, inset, side - inset, side - inset)
    canvas.drawRoundRect(shape, radius, radius, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#FACC15") })
    canvas.drawRoundRect(
        shape,
        radius,
        radius,
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = border
            color = Color.parseColor("#33000000")
        },
    )
    // No content box: the label's iconTextFitPadding alone sets the room around the words, as PlateChip's padding does.
    val middle = listOf(ImageStretches(radius, side - radius))
    mapStyle.addImage(PLATE_IMAGE, bitmap, middle, middle, null)
}

/** A planned road: the line on its darker casing, which holds it apart from the basemap's own roads. */
private fun addRouteLayers(style: Style, casingLayer: String, lineLayer: String, source: String, casing: Int, line: Int) {
    style.addLayer(
        LineLayer(casingLayer, source).withProperties(
            PropertyFactory.lineColor(casing),
            PropertyFactory.lineWidth(8f),
            PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
            PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
        ),
    )
    style.addLayer(
        LineLayer(lineLayer, source).withProperties(
            PropertyFactory.lineColor(line),
            PropertyFactory.lineWidth(4.5f),
            PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
            PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
        ),
    )
}

/** An ARGB colour as the `#rrggbb` a map expression reads. */
private fun hex(argb: Int): String = "#%06X".format(argb and 0xFFFFFF)

/** The web app's trail colours, by tone. */
private fun byTone(): Expression = Expression.match(
    Expression.get(TONE),
    Expression.color(OverlayInk.tone(TrailTone.ON_ROUTE)),
    Expression.stop(TrailTone.OFF_ROUTE.name, Expression.color(OverlayInk.tone(TrailTone.OFF_ROUTE))),
    Expression.stop(TrailTone.ALTERNATE.name, Expression.color(OverlayInk.tone(TrailTone.ALTERNATE))),
    Expression.stop(TrailTone.NO_TRIP.name, Expression.color(OverlayInk.tone(TrailTone.NO_TRIP))),
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
                        .put(INK, hex(OverlayInk.vehicle(vehicle.state, vehicle.status)))
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

/** The trail as a FeatureCollection of lines, one per run, each carrying its tone. */
private fun trailJson(trail: List<TrailRun>): String {
    val features = JSONArray()
    trail.filter { it.points.size >= 2 }.forEach { run ->
        val coordinates = JSONArray()
        run.points.forEach { (lat, lng) -> coordinates.put(JSONArray().put(lng).put(lat)) }
        features.put(
            JSONObject()
                .put("type", "Feature")
                .put("properties", JSONObject().put(TONE, run.tone.name))
                .put("geometry", JSONObject().put("type", "LineString").put("coordinates", coordinates)),
        )
    }
    return JSONObject().put("type", "FeatureCollection").put("features", features).toString()
}

/** The pins as a FeatureCollection of points, each carrying its kind. */
private fun pinsJson(pins: List<MapPin>): String {
    val features = JSONArray()
    pins.forEach { pin ->
        features.put(
            JSONObject()
                .put("type", "Feature")
                .put("properties", JSONObject().put(ID, pin.id).put(KIND, pin.kind.name))
                .put(
                    "geometry",
                    JSONObject()
                        .put("type", "Point")
                        .put("coordinates", JSONArray().put(pin.longitude).put(pin.latitude)),
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
private const val ROUTE_DRIVEN_SOURCE = "owner-route-driven"
private const val ROUTE_DRIVEN_CASING_LAYER = "owner-route-driven-casing"
private const val ROUTE_DRIVEN_LAYER = "owner-route-driven-line"
private const val TRAIL_SOURCE = "owner-trail"
private const val PINS_SOURCE = "owner-pins"
private const val HALO_LAYER = "owner-vehicles-halo"
private const val DISC_LAYER = "owner-vehicles-disc"
private const val LABEL_LAYER = "owner-vehicles-label"
private const val PLATE_IMAGE = "owner-vehicles-plate"
private const val ROUTE_CASING_LAYER = "owner-route-casing"
private const val ROUTE_LAYER = "owner-route-line"
private const val TRAIL_CASING_LAYER = "owner-trail-casing"
private const val TRAIL_LAYER = "owner-trail-line"
private const val PIN_LAYER = "owner-pins-disc"
private const val ID = "id"
private const val INK = "ink"
private const val LABEL = "label"
private const val PICKED = "picked"
private const val KIND = "kind"
private const val TONE = "tone"

/** A bold face the OpenFreeMap styles ship glyphs for. */
private const val LABEL_FONT = "Noto Sans Bold"
private const val PLATE_RADIUS_DP = 6f
private const val FOCUS_ZOOM = 13.5
private const val PADDING_PX = 90
private const val CAMERA_MS = 900
