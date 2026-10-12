package com.saarthi.core.ui

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.saarthi.core.CoreConfig
import com.saarthi.core.domain.TrailPoint
import com.saarthi.core.domain.bearingDelta
import com.saarthi.core.telemetry.Position
import com.saarthi.core.util.DebugLog
import kotlinx.coroutines.delay
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.gestures.MoveGestureDetector
import org.maplibre.android.gestures.StandardScaleGestureDetector
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import kotlin.math.abs

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
 * ## Why the camera is driven the way it is
 *
 * The camera used to be moved from `AndroidView`'s `update` block, which sounds
 * reasonable and is the source of the bug everybody hit: **the map stopped
 * following the vehicle while the marker kept moving.**
 *
 * `update` runs on *recomposition*, not on movement. The cockpit recomposes for
 * the clock, for the battery, for the assistant's state, and — while the wake
 * word is enabled — about ten times a second as the recogniser reports its
 * amplitude. Each of those calls restarted a 900 ms camera animation from
 * wherever it had got to, so the camera perpetually re-aimed and crawled, while
 * the marker, drawn straight into a GeoJSON source, snapped to each new fix
 * immediately. The result on screen is exactly what was reported: a vehicle
 * sliding off the side of a stationary map.
 *
 * So the camera now moves from a [LaunchedEffect] keyed on the *position*, and
 * on nothing else. It runs when the vehicle moves, once per fix, and unrelated
 * recomposition cannot touch it.
 *
 * ## The navigation camera
 *
 * While a route is being followed the view is not "centred on the vehicle" — it
 * is the view every in-car navigator uses: tilted, turned to face the direction
 * of travel, and with the vehicle pushed down towards the bottom of the panel so
 * that most of the screen shows the road *ahead* rather than the road already
 * driven. That is what [CameraPosition.Builder.padding] does here.
 *
 * ## Panning
 *
 * A drag or a pinch hands control to the driver, and following resumes on its
 * own after a quiet interval — the behaviour of every navigator, and the fix for
 * the second half of the complaint. Previously any stray touch ended tracking
 * permanently until somebody found the recentre button, which on a tablet
 * mounted next to a gear lever is a thing that happens by accident several times
 * an hour.
 *
 * Note the listener: `addOnMoveListener` and `addOnScaleListener`, not
 * `addOnCameraMoveStartedListener`. The latter fires for camera changes the app
 * itself started, so distinguishing "the driver dragged" from "we animated"
 * meant testing a reason code — and it also fires for a double-tap zoom nobody
 * meant. These two fire only for a real drag and a real pinch.
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
     * Empty when the driver is not navigating. Re-serialised only when the list
     * identity changes — see [drawRoute] for why that matters.
     */
    routeGeometry: List<Pair<Double, Double>> = emptyList(),
    /** Where the route ends. Marked, so the driver can see what they picked. */
    destination: Pair<Double, Double>? = null,
    /**
     * Whether the camera should track the vehicle.
     *
     * False after the driver pans away, until they ask to be recentred or the
     * inactivity timer hands control back.
     */
    followVehicle: Boolean = true,
    /** Raised when a drag or a pinch moves the camera, so following can stop. */
    onUserPannedMap: () -> Unit = {},
    /**
     * True when a route is being followed.
     *
     * Selects the navigation camera — tilted, turned to the heading, and with
     * the vehicle low on the screen so the road ahead fills it.
     */
    navigating: Boolean = false,
    /**
     * A route is drawn but the driver has not started it.
     *
     * The camera holds the whole journey in view instead of chasing the vehicle:
     * somebody deciding whether to go wants to see where the route goes, and a
     * view that snapped back to a 17-zoom of the bonnet two seconds later would
     * answer a question they did not ask.
     */
    previewingRoute: Boolean = false,
    /**
     * Bumped to ask the camera to frame the whole route once.
     *
     * A counter rather than a boolean, so asking twice for the same route works.
     * The driver has just chosen a destination and the first thing they want is
     * to see where it is — the previous version left the camera exactly where it
     * was, which is why "it shows me the route but the map does not move" was
     * both true and infuriating.
     */
    frameRouteRequest: Int = 0,
    /**
     * What the vehicle is, so the marker looks like it.
     *
     * A `VehicleType` name from the server. Anything unrecognised — including
     * null, and including a type added to the API after this build shipped —
     * falls back to the lorry, because this is a freight product and a wrong
     * silhouette is a smaller failure than no marker at all.
     */
    vehicleType: String? = null,
    /** The marker, glow and route colours. The tablet's own unless given. */
    look: MapLook = MapLook.Terminal,
    /** Numbered places to mark — a services list beside the map. None by default. */
    pins: List<MapPin> = emptyList(),
    /** A pin was tapped: its index in [pins]. */
    onPinTapped: (Int) -> Unit = {},
    /** Bumped to fit the vehicle and every pin in view once. */
    framePinsRequest: Int = 0,
    /** Pixels kept clear at the top when framing pins, for a bar over the map. */
    framePinsTopPx: Int = 0,
    /** Pixels kept clear at the foot when framing pins, for a sheet over the map. */
    framePinsBottomPx: Int = 0,
    /** The covered path, coloured by trip state. Empty draws nothing. */
    trail: List<TrailPoint> = emptyList(),
    /**
     * The basemap. Changing it restyles the live map in place — how the phone
     * follows a switch between the light and the dark theme.
     */
    styleUrl: String = CoreConfig.mapStyleUrl,
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val reducedMotion = LocalReducedMotion.current

    val mapView = remember { mutableMapReference() }

    /**
     * The map itself, once MapLibre has produced it.
     *
     * Held in state so the camera effects can act on it directly rather than
     * queueing work through `getMapAsync` on every recomposition.
     */
    val mapState = remember { androidx.compose.runtime.mutableStateOf<MapLibreMap?>(null) }
    val map by mapState

    // Read inside listeners that are registered once, so the map's callbacks
    // always reach the current lambda rather than the one from first composition.
    val onPanned by rememberUpdatedState(onUserPannedMap)

    // Read at the *end* of the route preview rather than captured at its start,
    // so a driver who drags the map while looking at the whole journey is not
    // yanked back to the vehicle three seconds later.
    val following by rememberUpdatedState(followVehicle)

    val tappedPin by rememberUpdatedState(onPinTapped)
    val currentPins by rememberUpdatedState(pins)
    val currentPosition by rememberUpdatedState(position)
    val pinsJson = remember(pins) { pinsJson(pins) }
    val drawnPins = remember { DrawnPins() }

    /*
     * Everything a freshly loaded style must be given.
     *
     * Read at the moment the style finishes loading, not captured when the load
     * began: a style takes a second or two to arrive, and the position, the
     * vehicle and the route captured at the start were what the old map drew a
     * parked vehicle from — a marker missing, or the wrong shape, until the
     * vehicle next moved.
     */
    val overlays by rememberUpdatedState(
        Overlays(position, headingDegrees, routeGeometry, destination, vehicleType, look, trail),
    )
    val loadedStyle = remember { LoadedStyle() }

    /*
     * The zoom the driver pinched to, kept while following.
     *
     * A pinch used to count as a pan: following stopped, the zoom happened
     * around the fingers rather than the vehicle, and on the navigation view —
     * the vehicle sitting low on purpose — two or three levels in were enough
     * to push it under the panels or off the screen entirely. Now a pinch zooms
     * on the vehicle and the vehicle stays followed; only a drag hands the map
     * over. Cleared when the view changes kind, so starting a route still gets
     * the navigation zoom.
     */
    val pinchedZoom = remember { PinchedZoom() }
    LaunchedEffect(navigating, driving) { pinchedZoom.zoom = null }

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
            mapState.value = null
        }
    }

    /*
     * The camera, driven by the vehicle.
     *
     * Keyed on the fix and on the things that change the *shape* of the view —
     * never on anything that merely redraws the screen. This is the whole fix
     * for "the map does not move with the marker": the previous version keyed
     * this work on recomposition, so a chatty unrelated state flow could restart
     * the animation faster than it could ever complete.
     */
    LaunchedEffect(
        map,
        position?.latitude,
        position?.longitude,
        headingDegrees,
        driving,
        navigating,
        previewingRoute,
        followVehicle,
        reducedMotion,
    ) {
        val current = map ?: return@LaunchedEffect
        if (!followVehicle || previewingRoute) return@LaunchedEffect
        applyCamera(current, position, headingDegrees, driving, navigating, reducedMotion, pinchedZoom.zoom)
    }

    // A new basemap — the theme changed. Restyle in place and draw everything
    // onto it again; the old style's sources and images went with it.
    LaunchedEffect(map, styleUrl) {
        val current = map ?: return@LaunchedEffect
        if (loadedStyle.url == null || loadedStyle.url == styleUrl) return@LaunchedEffect
        val context = mapView.value?.context ?: return@LaunchedEffect
        loadedStyle.url = styleUrl
        current.setStyle(styleUrl) { style ->
            drawnPins.json = null
            drawOverlays(context, style, overlays, currentPins, drawnPins)
        }
    }

    /*
     * Frame the whole route, once, when the driver picks a destination.
     *
     * Then hand the view back to the vehicle. Both halves matter: seeing where
     * you are going is the point of choosing a destination, and staying zoomed
     * out to the whole journey is useless the moment you set off.
     */
    LaunchedEffect(map, frameRouteRequest) {
        val current = map ?: return@LaunchedEffect
        if (frameRouteRequest == 0 || routeGeometry.isEmpty()) return@LaunchedEffect

        frameRoute(current, routeGeometry, position, reducedMotion)

        /*
         * Hold it while the driver is deciding.
         *
         * A previewed route stays framed until they press Start — the camera has
         * nothing more useful to do, and taking the overview away from somebody
         * mid-decision is the app hurrying them. Once navigating, the frame is a
         * three-second orientation and then the vehicle gets the camera back.
         */
        if (previewingRoute) return@LaunchedEffect

        delay(if (reducedMotion) ROUTE_PREVIEW_MS_REDUCED else ROUTE_PREVIEW_MS)
        if (following) {
            applyCamera(current, position, headingDegrees, driving, navigating, reducedMotion, pinchedZoom.zoom)
        }
    }

    LaunchedEffect(map, framePinsRequest) {
        val current = map ?: return@LaunchedEffect
        if (framePinsRequest == 0) return@LaunchedEffect
        framePins(current, currentPins, currentPosition, framePinsTopPx, framePinsBottomPx, reducedMotion)
    }

    AndroidView(
        modifier = modifier,
        factory = { context ->
            /*
             * Texture mode, not the default surface mode.
             *
             * MapLibre renders to a `SurfaceView` by default, which the system
             * composites on its own layer — nothing in the app can read those
             * pixels, so the frosted panels floating over the map had no
             * backdrop to blur and fell back to being flat translucent boxes.
             * A `TextureView` draws into the view hierarchy where they can
             * sample it.
             *
             * It costs a little: texture mode goes through an extra copy and is
             * measurably slower than a surface. Worth it here, because the map
             * is the backdrop for every panel on the cockpit and the alternative
             * is glass that cannot exist.
             */
            val options = MapLibreMapOptions.createFromAttributes(context).textureMode(true)
            MapView(context, options).also { view ->
                mapView.value = view
                view.onCreate(null)
                view.getMapAsync { ready ->
                    loadedStyle.url = styleUrl
                    ready.setStyle(styleUrl) { style ->
                        DebugLog.info("map", "Basemap loaded")
                        drawOverlays(context, style, overlays, currentPins, drawnPins)
                    }

                    // Only pins drawn by this map can be tapped; the listener is
                    // a no-op for a map that never shows any.
                    ready.addOnMapClickListener { point ->
                        val index = pinAt(ready, point) ?: return@addOnMapClickListener false
                        tappedPin(index)
                        true
                    }

                    /*
                     * A drag means the driver wants to look somewhere else.
                     * Reported so the caller can stop recentring and offer the
                     * way back — without this the camera snapped to the vehicle
                     * on the next fix and the map ahead could never be read.
                     *
                     * A *tap* deliberately does not count. Under the old
                     * camera-move listener, a double-tap zoom and every stray
                     * knock that nudged the map ended tracking for good.
                     */
                    ready.addOnMoveListener(object : MapLibreMap.OnMoveListener {
                        override fun onMoveBegin(detector: MoveGestureDetector) = onPanned()
                        override fun onMove(detector: MoveGestureDetector) = Unit
                        override fun onMoveEnd(detector: MoveGestureDetector) = Unit
                    })

                    /*
                     * A pinch while following zooms on the vehicle, not on the
                     * fingers, and keeps following — see [PinchedZoom]. Not
                     * following, it is an ordinary zoom on the map being read.
                     */
                    ready.addOnScaleListener(object : MapLibreMap.OnScaleListener {
                        override fun onScaleBegin(detector: StandardScaleGestureDetector) {
                            val vehicle = currentPosition ?: return
                            if (!following) return
                            ready.uiSettings.focalPoint = ready.projection.toScreenLocation(
                                LatLng(vehicle.latitude, vehicle.longitude),
                            )
                        }

                        override fun onScale(detector: StandardScaleGestureDetector) = Unit

                        override fun onScaleEnd(detector: StandardScaleGestureDetector) {
                            ready.uiSettings.focalPoint = null
                            if (following) pinchedZoom.zoom = ready.cameraPosition.zoom
                        }
                    })

                    ready.uiSettings.apply {
                        // A driver does not pinch-rotate a map at 60 km/h, and a
                        // map that has been accidentally rotated is a map that is
                        // now wrong. Panning and zooming stay, so a stationary
                        // driver can look ahead.
                        isRotateGesturesEnabled = false
                        isTiltGesturesEnabled = false
                        isCompassEnabled = false
                        // Attribution stays. OpenStreetMap's licence requires it,
                        // and removing it would be both a legal and a bad-faith
                        // choice — a look that turns MapLibre's off prints the
                        // credits itself.
                        isAttributionEnabled = look.nativeAttribution
                        isLogoEnabled = look.nativeAttribution
                    }

                    mapState.value = ready
                }
            }
        },
        update = { view ->
            /*
             * Overlays only. The camera is not touched here — see the note at
             * the top of the file. This block runs on every recomposition, and
             * anything expensive or stateful in it is paid for by the clock
             * ticking.
             */
            view.getMapAsync { ready ->
                // A style still loading is skipped; its own callback draws.
                val style = ready.style?.takeIf { it.isFullyLoaded } ?: return@getMapAsync
                drawOverlays(
                    view.context,
                    style,
                    Overlays(position, headingDegrees, routeGeometry, destination, vehicleType, look, trail),
                    pins,
                    drawnPins,
                    pinsJson,
                )
            }
        },
    )
}

/** What the overlays are drawn from — read fresh whenever a style finishes loading. */
private data class Overlays(
    val position: Position?,
    val headingDegrees: Double?,
    val routeGeometry: List<Pair<Double, Double>>,
    val destination: Pair<Double, Double>?,
    val vehicleType: String?,
    val look: MapLook,
    val trail: List<TrailPoint>,
)

/** The basemap the map was last asked to load, so a theme change restyles only once. */
private class LoadedStyle {
    var url: String? = null
}

/** The zoom a pinch left the followed view at; null for the view's own zoom. */
private class PinchedZoom {
    var zoom: Double? = null
}

/**
 * Draw everything the app lays over the basemap, bottom to top.
 *
 * One path for all three moments that need it — the first style, a restyle on
 * a theme change, and every recomposition after — so none of them can forget
 * a layer. Each drawing step skips work that has not changed, which is what
 * makes calling this on every recomposition affordable.
 */
private fun drawOverlays(
    context: Context,
    style: Style,
    overlays: Overlays,
    pins: List<MapPin>,
    drawnPins: DrawnPins,
    json: String = pinsJson(pins),
) {
    val marker = overlays.look.markerFor(overlays.vehicleType)
    registerVehicleIcon(context, style, marker)
    drawTrail(style, overlays.trail, overlays.look)
    drawRoute(style, overlays.routeGeometry, overlays.destination, overlays.look)
    drawVehicle(style, overlays.position, overlays.headingDegrees, marker, overlays.look)

    // Re-sent only when the set changes, and never created for a map that has
    // not shown a pin.
    val stale = drawnPins.json != json ||
        (drawnPins.json != null && style.getSource(PINS_SOURCE_ID) == null)
    if (stale && (pins.isNotEmpty() || drawnPins.json != null)) {
        drawPins(style, json, overlays.look.pins)
        drawnPins.json = json
    }
}

/**
 * Put the camera where the driver needs it.
 *
 * Three views, and the difference between them is what the driver is doing:
 *
 *  * **Navigating and moving** — the in-car view. Close in, tilted, turned to
 *    face the way the vehicle is going, and with the vehicle sitting low on the
 *    panel so the screen is mostly road ahead. A north-up map centred on the
 *    vehicle gives half the screen to the road already driven, which is the half
 *    nobody needs.
 *  * **Moving, not navigating** — the same idea, gentler. Enough zoom for the
 *    next few hundred metres, no route to look along.
 *  * **Stationary** — wider and flat, which is what finds a gate, a bay or a
 *    forecourt entrance.
 *
 * Under reduced motion nothing tilts, nothing rotates and nothing eases. The
 * position still updates; it simply arrives rather than travelling.
 */
private fun applyCamera(
    map: MapLibreMap,
    position: Position?,
    headingDegrees: Double?,
    driving: Boolean,
    navigating: Boolean,
    reducedMotion: Boolean,
    pinchedZoom: Double?,
) {
    if (position == null) return

    val target = LatLng(position.latitude, position.longitude)
    val chase = driving && !reducedMotion
    val bearing = if (chase) (headingDegrees ?: map.cameraPosition.bearing) else 0.0

    val builder = CameraPosition.Builder()
        .target(target)
        .zoom(
            pinchedZoom ?: when {
                navigating && driving -> ZOOM_NAVIGATING
                driving -> ZOOM_DRIVING
                else -> ZOOM_PARKED
            },
        )
        .tilt(if (chase && navigating) TILT_NAVIGATING else if (chase) TILT_DRIVING else 0.0)
        .bearing(bearing)

    /*
     * The vehicle, pushed down the screen.
     *
     * Padding shifts where in the viewport the camera's target lands. A large
     * top padding puts the vehicle low and fills the rest with what is coming,
     * which is the single thing that makes a navigation view feel like one.
     * Only while actually navigating and moving: a stationary driver looking for
     * a bay wants themselves in the middle.
     */
    if (chase && navigating) {
        builder.padding(0.0, NAVIGATION_TOP_PADDING_PX, 0.0, 0.0)
    }

    val camera = builder.build()

    if (reducedMotion) {
        map.moveCamera(CameraUpdateFactory.newCameraPosition(camera))
        return
    }

    /*
     * A duration matched to how far the camera has to travel.
     *
     * A fixed 900 ms was wrong at both ends. On a stationary vehicle it animated
     * a metre of GPS wander for the best part of a second, which reads as the
     * map drifting; after a tunnel, or the first fix of a session, it eased
     * gently across a city while the marker was already at the far end.
     *
     * The gate below is the other half: a fix that has not meaningfully moved
     * the camera is skipped entirely rather than animated, so a parked truck's
     * noise does not keep the map in perpetual slow motion.
     */
    val currentCamera = map.cameraPosition
    // Null before the map has settled on a position of its own. Treated as
    // "infinitely far", so the first fix always moves the camera rather than
    // being gated as noise.
    val movedMetres = currentCamera.target
        ?.let { distanceBetween(it, target) }
        ?: Double.MAX_VALUE
    val turned = bearingDelta(currentCamera.bearing, bearing)
    val zoomed = abs(currentCamera.zoom - camera.zoom)

    if (movedMetres < CAMERA_IDLE_METRES && turned < CAMERA_IDLE_DEGREES && zoomed < 0.05) return

    val duration = when {
        movedMetres > CAMERA_JUMP_METRES -> CAMERA_JUMP_MS
        else -> CAMERA_FOLLOW_MS
    }

    map.animateCamera(CameraUpdateFactory.newCameraPosition(camera), duration)
}

/**
 * Show the whole journey, once.
 *
 * Fitted to the route *and* the vehicle, so a driver whose truck sits a little
 * off the start of the polyline — parked round the back of a yard, say — can
 * still see themselves in the frame. Bounds with fewer than two distinct points
 * are refused by MapLibre, so the single-point case falls back to a plain
 * centre rather than throwing.
 */
private fun frameRoute(
    map: MapLibreMap,
    geometry: List<Pair<Double, Double>>,
    position: Position?,
    reducedMotion: Boolean,
) {
    val points = buildList {
        geometry.forEach { (lat, lng) -> add(LatLng(lat, lng)) }
        position?.let { add(LatLng(it.latitude, it.longitude)) }
    }
    if (points.size < 2) return

    val bounds = runCatching { LatLngBounds.Builder().includes(points).build() }.getOrNull() ?: return

    val update = CameraUpdateFactory.newLatLngBounds(
        bounds,
        ROUTE_FRAME_PADDING_PX,
        ROUTE_FRAME_PADDING_PX,
        ROUTE_FRAME_PADDING_PX,
        ROUTE_FRAME_PADDING_PX,
    )

    runCatching {
        if (reducedMotion) map.moveCamera(update) else map.animateCamera(update, ROUTE_FRAME_MS)
    }.onFailure { error ->
        // A viewport too small to fit the bounds at any zoom — a map panel
        // measured at zero height during a layout pass. Not worth a crash in a
        // cab over a preview animation.
        DebugLog.debug("map", "Could not frame the route: ${error.message}")
    }
}

/** Metres between two map points. Enough precision to gate an animation. */
private fun distanceBetween(from: LatLng, to: LatLng): Double =
    com.saarthi.core.domain.haversineMetres(
        from.latitude,
        from.longitude,
        to.latitude,
        to.longitude,
    )


/** Close in on the next few hundred metres, which is all a turn needs. */
private const val ZOOM_NAVIGATING = 17.0
private const val ZOOM_DRIVING = 16.5
/** Wider, for finding a gate or a bay on foot. */
private const val ZOOM_PARKED = 15.0

private const val TILT_NAVIGATING = 55.0
private const val TILT_DRIVING = 45.0

/**
 * How far down the panel the vehicle sits while navigating.
 *
 * Device pixels rather than dp, because MapLibre's camera padding is in pixels.
 * A fixed figure suits the range of screens a terminal ships on — a 7-inch phone
 * to a 12-inch dash display — better than a fraction would: on the small screen
 * a proportional value leaves almost no road ahead, and on the large one it
 * pushes the vehicle off the bottom edge.
 */
private const val NAVIGATION_TOP_PADDING_PX = 320.0

/** Breathing room around a framed route, so the ends are not against the edge. */
private const val ROUTE_FRAME_PADDING_PX = 90

private const val ROUTE_FRAME_MS = 900
/** How long the whole-journey preview holds before the camera returns. */
private const val ROUTE_PREVIEW_MS = 3_200L
private const val ROUTE_PREVIEW_MS_REDUCED = 2_000L

/** A following animation, just under the shortest telemetry interval. */
private const val CAMERA_FOLLOW_MS = 950
/** A long jump — the first fix, or the far side of a tunnel. Get there quickly. */
private const val CAMERA_JUMP_MS = 400
private const val CAMERA_JUMP_METRES = 400.0

/** Below this the fix is GPS noise on a parked vehicle, and the camera holds. */
private const val CAMERA_IDLE_METRES = 4.0
private const val CAMERA_IDLE_DEGREES = 2.0

/** A mutable holder for the MapView, kept out of recomposition. */
private fun mutableMapReference(): androidx.compose.runtime.MutableState<MapView?> =
    mutableStateOf(null)
