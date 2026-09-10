package com.saarthi.driver.car

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PointF
import android.graphics.Rect
import android.os.SystemClock
import androidx.car.app.AppManager
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.DateTimeWithZone
import androidx.car.app.model.Distance
import androidx.car.app.model.DistanceSpan
import androidx.car.app.model.ItemList
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.Maneuver
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.RoutePreviewNavigationTemplate
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.navigation.model.Step
import androidx.car.app.navigation.model.TravelEstimate
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import com.saarthi.core.network.NearbyPlaceDto
import com.saarthi.core.network.RouteDto
import com.saarthi.core.network.RouteStepDto
import com.saarthi.core.telemetry.Metric
import com.saarthi.driver.BuildConfig
import com.saarthi.driver.SaarthiDriverApp
import kotlinx.coroutines.launch
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.snapshotter.MapSnapshot
import org.maplibre.android.snapshotter.MapSnapshotter
import java.util.TimeZone
import kotlin.math.max
import kotlin.math.min

/**
 * Guidance on the car screen.
 *
 * Two screens and one renderer. The preview shows the route Saarthi worked out
 * and waits; the guidance screen runs once the driver presses Start; and the
 * renderer draws what the templates cannot — the route itself, and the engine
 * readings a driver is used to seeing in the cockpit.
 *
 * The division is the platform's, not a choice. Android Auto owns the routing
 * cards: the manoeuvre, the distance to it, the arrival time and the action
 * strip are all `NavigationTemplate` slots, drawn by the host to its own rules
 * so they read the same in every app. What is left is the surface behind them,
 * and that is the app's to paint.
 *
 * The trip itself is untouched by any of this. Starting guidance is not
 * starting a shift — the session, the telemetry and the outbox all continue to
 * belong to the phone, and closing the car screen mid-journey stops nothing.
 */

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

/**
 * What Saarthi paints behind the host's cards.
 *
 * Deliberately not a map. Drawing tiles here would mean a second map engine,
 * a second tile budget and a second thing to be wrong about a road — while the
 * phone already has MapLibre and the host already draws a map for the nearby
 * list. What a driver cannot get anywhere else on that screen is the shape of
 * the route ahead and the state of the engine, so that is what this draws.
 *
 * Every reading is drawn from the same snapshot the cockpit reads. A metric
 * the vehicle does not report is drawn as a dash and never as a zero — section
 * 19 holds on the car screen exactly as it does on the phone.
 */
internal class GuidanceSurface(
    private val app: SaarthiDriverApp,
    private val route: RouteDto,
) : SurfaceCallback {

    private var surface: SurfaceContainer? = null

    /** What the host has not covered with its own cards. */
    private val safe = Rect()

    private var snapshotter: MapSnapshotter? = null
    private var snapshot: MapSnapshot? = null
    private var askedFor: String? = null

    private val ink = Paint().apply {
        isAntiAlias = true
        color = Color.WHITE
    }
    private val dim = Paint().apply {
        isAntiAlias = true
        color = Color.parseColor("#C7CEDB")
    }
    private val plate = Paint().apply { color = Color.parseColor("#CC0B0F1A") }
    private val line = Paint().apply {
        isAntiAlias = true
        color = Color.parseColor("#F26522")
        style = Paint.Style.STROKE
        strokeWidth = 12f
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val ground = Paint().apply { color = Color.parseColor("#0B0F1A") }

    override fun onSurfaceAvailable(container: SurfaceContainer) {
        surface = container
        if (safe.isEmpty) safe.set(0, 0, container.width, container.height)
        requestMap()
        draw()
    }

    override fun onSurfaceDestroyed(container: SurfaceContainer) {
        surface = null
        snapshotter?.cancel()
        snapshotter = null
    }

    override fun onVisibleAreaChanged(visibleArea: Rect) {
        if (!visibleArea.isEmpty) safe.set(visibleArea)
        requestMap()
        draw()
    }

    /*
     * The stable area is the part of the surface the host promises not to
     * cover. Laying out against the raw surface instead put the speed reading
     * underneath the arrival-time card and pushed the coolant off the right
     * edge — drawn, and unreadable.
     */
    override fun onStableAreaChanged(stableArea: Rect) {
        if (!stableArea.isEmpty) safe.set(stableArea)
        requestMap()
        draw()
    }

    /**
     * Ask MapLibre for the map behind the route.
     *
     * A snapshot rather than a live map view. A `MapView` needs a window and a
     * lifecycle, and a car surface is neither; the snapshotter renders the same
     * style off-screen to a bitmap, which is exactly what this can paint. It is
     * also the same style the phone's cockpit uses, so the car screen and the
     * handset do not disagree about what the road looks like.
     *
     * Requested once per size. Re-rendering tiles on every telemetry tick would
     * spend the fleet's tile budget several times a second to redraw a road
     * that has not moved.
     */
    private fun requestMap() {
        val points = route.geometry
        if (points.size < 2) return

        /*
         * Sized to the whole surface, not to the safe area.
         *
         * The safe area is where the host promises not to cover *content*, and
         * for a map that is the wrong question: a map is the ground, and the
         * host's cards are meant to float over it. Rendering into the safe
         * area instead squeezed the streets into the right-hand third and left
         * a dark band down the side where the arrival card sits.
         */
        val container = surface ?: return
        val width = container.width
        val height = container.height
        if (width <= 0 || height <= 0) return

        val key = "${width}x${height}"
        if (askedFor == key) return
        askedFor = key

        val bounds = LatLngBounds.Builder()
            .includes(points.map { LatLng(it.latitude, it.longitude) })
            .build()

        snapshotter?.cancel()
        snapshotter = PlainSnapshotter(
            app,
            MapSnapshotter.Options(width, height)
                .withStyle(BuildConfig.MAP_STYLE_URL)
                .withRegion(bounds)
                .withLogo(false),
        ).also { shot ->
            shot.start(
                { ready ->
                    snapshot = ready
                    draw()
                },
                {
                    /*
                     * A map that will not render is a worse screen, not a
                     * broken one: the route line, the readings and the host's
                     * own cards all still work over the plain ground. Clearing
                     * the key lets a later size change try again.
                     */
                    askedFor = null
                },
            )
        }
    }

    /**
     * Repaint with whatever the telemetry holds now.
     *
     * Wrapped, and deliberately so. This runs from a host callback on the main
     * thread — the same path that turns a template mistake into a dead app —
     * and the host hands over a surface that is briefly zero-sized while it is
     * laid out, which is enough to make `lockCanvas` throw. A drawing fault
     * must cost the driver a blank panel, never the screen they are
     * navigating by.
     */
    fun draw() {
        runCatching { paint() }
    }

    private fun paint() {
        val container = surface ?: return
        if (container.width <= 0 || container.height <= 0) return
        val holder = container.surface ?: return
        if (!holder.isValid) return

        val canvas: Canvas = holder.lockCanvas(null) ?: return
        try {
            canvas.drawRect(
                0f,
                0f,
                container.width.toFloat(),
                container.height.toFloat(),
                ground,
            )
            if (safe.isEmpty) safe.set(0, 0, container.width, container.height)
            drawMap(canvas)
            drawRoute(canvas)
            drawReadouts(canvas)
        } finally {
            holder.unlockCanvasAndPost(canvas)
        }
    }

    private fun drawMap(canvas: Canvas) {
        val bitmap = snapshot?.bitmap ?: return
        canvas.drawBitmap(bitmap, 0f, 0f, null)
        drawAttribution(canvas)
    }

    /**
     * The credit MapLibre would have drawn, had its overlay not thrown.
     *
     * Bottom-left, small, over the map — the conventional place. Required by
     * the OpenStreetMap licence and by OpenFreeMap's terms, so it is not
     * optional decoration and must not be dropped to tidy the screen.
     */
    private fun drawAttribution(canvas: Canvas) {
        val container = surface ?: return
        dim.textSize = maxOf(container.height / 42f, 11f)
        val credit = "© OpenStreetMap"
        /*
         * Bottom right, because bottom left is the host's. Its arrival-time
         * card sits there and was covering the credit — which is not a
         * cosmetic problem: an attribution nobody can read is not an
         * attribution, and OpenStreetMap's licence asks for a legible one.
         */
        val width = dim.measureText(credit)
        canvas.drawText(
            credit,
            container.width - width - 10f,
            container.height - 8f,
            dim,
        )
    }

    /**
     * The route, laid exactly over the tiles beneath it.
     *
     * The snapshot converts a coordinate to a pixel in its own projection, so
     * the line follows the roads rather than approximating them. Without a
     * snapshot there is nothing to align to and the line is skipped — a route
     * drawn to one projection over a map drawn to another is worse than no
     * line at all.
     */
    private fun drawRoute(canvas: Canvas) {
        val ready = snapshot ?: return
        val points = route.geometry
        if (points.size < 2) return

        var previous: PointF? = null
        for (point in points) {
            val at = runCatching {
                ready.pixelForLatLng(LatLng(point.latitude, point.longitude))
            }.getOrNull() ?: continue

            val x = at.x
            val y = at.y
            previous?.let { canvas.drawLine(it.x, it.y, x, y, line) }
            previous = PointF(x, y)
        }
    }

    /**
     * Speed, engine, fuel — the cockpit's own readings, out of the way.
     *
     * A full-width bar across the bottom was the first attempt and it was
     * wrong twice over: it lay across the road the driver was following, and
     * it put four equally-sized numbers in a row when only one of them is read
     * at a glance while moving. This is a badge instead — speed large, the
     * rest small beneath it — pinned to the right, because the host keeps its
     * arrival-time card bottom-left and its manoeuvre card top-left.
     *
     * A metric the vehicle does not report shows a dash. Never a zero: a
     * fabricated reading from a driver's own handset is precisely what section
     * 19 exists to prevent, and "0 km/h" on a moving lorry is a lie the app
     * would be telling on the vehicle's behalf.
     */
    private fun drawReadouts(canvas: Canvas) {
        val readings = app.telemetry.snapshot.value
        if (safe.width() <= 0 || safe.height() <= 0) return

        /*
         * Proportional, because a head unit is not a phone and they are not
         * all one size. The first version used fixed pixels and looked
         * reasonable in a 2448-wide window while covering half the map on the
         * 800-wide surface the host actually gives you.
         */
        val unit = safe.height() / 100f
        val width = minOf(safe.width() * 0.42f, unit * 46f)
        val height = unit * 38f

        val right = safe.right - unit * 4f
        val left = right - width
        val top = safe.top + unit * 4f
        val bottom = top + height
        if (left < safe.left) return

        canvas.drawRoundRect(left, top, right, bottom, unit * 3f, unit * 3f, plate)

        val pad = unit * 3f

        // Speed, as the one number read while moving.
        dim.textSize = unit * 5f
        canvas.drawText("SPEED km/h", left + pad, top + unit * 8f, dim)

        val speed = readings[Metric.SPEED]?.value
        ink.textSize = unit * 15f
        canvas.drawText(
            if (speed == null) "-" else "%.0f".format(speed),
            left + pad,
            top + unit * 22f,
            ink,
        )

        // The rest, small, one per line.
        dim.textSize = unit * 4.5f
        ink.textSize = unit * 5.5f
        REST.forEachIndexed { index, readout ->
            val y = top + unit * (28f + index * 4.5f)
            val value = readings[readout.metric]?.value
            canvas.drawText(readout.label, left + pad, y, dim)
            val shown = if (value == null) "-" else readout.format(value)
            canvas.drawText(shown, left + width * 0.55f, y, ink)
        }
    }

    private data class Readout(
        val metric: Metric,
        val label: String,
        val format: (Double) -> String,
    )

    private companion object {
        /** Below the speed, in the order a driver scans them. */
        val REST = listOf(
            Readout(Metric.RPM, "ENGINE") { "%.0f rpm".format(it) },
            Readout(Metric.FUEL_LEVEL, "FUEL") { "%.0f %%".format(it) },
            Readout(Metric.COOLANT_TEMPERATURE, "COOLANT") { "%.0f °C".format(it) },
        )
    }
}

/**
 * A snapshotter that does not draw MapLibre's own overlay.
 *
 * Not a preference. `addOverlay` measures the attribution and scales the
 * library's logo whatever `withLogo(false)` says, and on this build the logo
 * bitmap is null — so it threw a NullPointerException from a Handler callback
 * the moment the tiles came back, killing the app the instant a driver pressed
 * Navigate.
 *
 * Skipping it is only acceptable because the credit is still paid: see
 * `drawAttribution`, which writes it onto the surface where a driver can read
 * it. Dropping the overlay and the attribution with it would be taking
 * OpenStreetMap's data without the one thing its licence asks in return.
 */
private class PlainSnapshotter(
    context: android.content.Context,
    options: Options,
) : MapSnapshotter(context, options) {
    override fun addOverlay(mapSnapshot: MapSnapshot) = Unit
}

// ---------------------------------------------------------------------------
// The route, before committing to it
// ---------------------------------------------------------------------------

/**
 * The route Saarthi worked out, with Start held back.
 *
 * Pressing a place in a list is a question; this is the answer, and Start is
 * where the driver says yes. The same shape the phone uses, for the same
 * reason — see `TerminalViewModel.previewRoute`.
 */
internal class CarRoutePreviewScreen(
    carContext: CarContext,
    private val place: NearbyPlaceDto,
    private val route: RouteDto,
) : Screen(carContext) {

    private val app = carContext.applicationContext as SaarthiDriverApp
    private val surface = GuidanceSurface(app, route)

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onCreate(owner: LifecycleOwner) {
                carContext.getCarService(AppManager::class.java).setSurfaceCallback(surface)
            }

            override fun onDestroy(owner: LifecycleOwner) {
                carContext.getCarService(AppManager::class.java).setSurfaceCallback(null)
            }
        })
    }

    override fun onGetTemplate(): Template {
        val summary = Row.Builder()
            .setTitle(place.name)
            .addText(distanceText(route.distanceKm, route.summary))
            .build()

        return RoutePreviewNavigationTemplate.Builder()
            .setTitle("Route")
            .setHeaderAction(Action.BACK)
            .setItemList(
                ItemList.Builder()
                    .addItem(summary)
                    /*
                     * A route list is a chooser, so the host insists on a
                     * selection listener even when there is one route to
                     * choose. Nothing to do on selection — the row is already
                     * the route, and Start is the action that matters — but
                     * omitting the listener throws and takes the app down.
                     */
                    .setOnSelectedListener { }
                    .build(),
            )
            .setNavigateAction(
                Action.Builder()
                    .setTitle("Start")
                    .setOnClickListener {
                        screenManager.push(CarNavigationScreen(carContext, place, route))
                    }
                    .build(),
            )
            .build()
    }
}

// ---------------------------------------------------------------------------
// Guidance
// ---------------------------------------------------------------------------

/**
 * Turn-by-turn, with the engine in view.
 *
 * The manoeuvre and the arrival time are the host's cards; the route line and
 * the readings behind them are Saarthi's surface. The step shown is chosen by
 * the vehicle's own position rather than by a timer, so a driver who stops for
 * ten minutes is not walked through the route without moving.
 */
internal class CarNavigationScreen(
    carContext: CarContext,
    private val place: NearbyPlaceDto,
    private val route: RouteDto,
) : Screen(carContext) {

    private val app = carContext.applicationContext as SaarthiDriverApp
    private val surface = GuidanceSurface(app, route)

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onCreate(owner: LifecycleOwner) {
                carContext.getCarService(AppManager::class.java).setSurfaceCallback(surface)

                /*
                 * Paced, because telemetry is not.
                 *
                 * The snapshot flow emits as fast as the vehicle reports, and
                 * the first version repainted the whole surface and rebuilt the
                 * template on every one of them — both on the main thread, both
                 * expensive, and together enough to earn a "Saarthi Driver
                 * isn't responding" from the host.
                 *
                 * A speed readout is legible at once a second and no better at
                 * ten. The cards are rebuilt only when the manoeuvre actually
                 * changes, which is a matter of minutes, not milliseconds.
                 */
                owner.lifecycleScope.launch {
                    var paintedAt = 0L
                    var shownStep: String? = null
                    app.telemetry.snapshot.collect {
                        val now = SystemClock.uptimeMillis()
                        if (now - paintedAt >= REPAINT_MS) {
                            paintedAt = now
                            surface.draw()
                        }

                        val step = nextStep()?.instruction
                        if (step != shownStep) {
                            shownStep = step
                            invalidate()
                        }
                    }
                }
            }

            override fun onDestroy(owner: LifecycleOwner) {
                carContext.getCarService(AppManager::class.java).setSurfaceCallback(null)
            }
        })
    }

    override fun onGetTemplate(): Template {
        val next = nextStep()

        val builder = NavigationTemplate.Builder()
            .setActionStrip(
                ActionStrip.Builder()
                    .addAction(
                        Action.Builder()
                            .setTitle("Stop")
                            .setOnClickListener { screenManager.pop() }
                            .build(),
                    )
                    .build(),
            )

        if (next != null) {
            builder.setNavigationInfo(
                RoutingInfo.Builder()
                    .setCurrentStep(
                        Step.Builder()
                            .setManeuver(maneuverOf(next))
                            .setCue(next.instruction)
                            .build(),
                        Distance.create(
                            next.distanceMeters / 1000.0,
                            Distance.UNIT_KILOMETERS,
                        ),
                    )
                    .build(),
            )
        }

        builder.setDestinationTravelEstimate(estimate())

        return builder.build()
    }

    private companion object {
        /** A speed readout is legible at 1 Hz and no better at ten. */
        const val REPAINT_MS = 1_000L
    }

    /**
     * The step the driver has not yet reached.
     *
     * Measured against the vehicle's position rather than counted off by time,
     * because time is not what makes a turn come closer. Falls back to the
     * first step when there is no fix — better a manoeuvre that is early than
     * a screen with nothing on it.
     */
    private fun nextStep(): RouteStepDto? {
        val steps = route.steps
        if (steps.isEmpty()) return null

        val here = app.telemetry.snapshot.value.position ?: return steps.first()

        return steps.minByOrNull { step ->
            val dLat = step.latitude - here.latitude
            val dLon = step.longitude - here.longitude
            dLat * dLat + dLon * dLon
        }
    }

    /**
     * Arrival time and what is left to run.
     *
     * The distance is what the route said rather than a live remainder: the
     * app is not measuring progress along the line, and a figure that pretends
     * to would be a guess dressed as a measurement.
     */
    private fun estimate(): TravelEstimate {
        val arrival = System.currentTimeMillis() + route.durationMinutes * 60_000L
        return TravelEstimate.Builder(
            Distance.create(route.distanceKm, Distance.UNIT_KILOMETERS),
            DateTimeWithZone.create(arrival, TimeZone.getDefault()),
        )
            .setRemainingTimeSeconds(route.durationMinutes * 60L)
            .build()
    }
}

/**
 * The road's word for a turn, in the host's vocabulary.
 *
 * Unknown shapes become a plain turn rather than nothing: the host refuses a
 * `Step` without a manoeuvre, and an arrow that is merely imprecise is better
 * than a guidance card that will not build.
 */
private fun maneuverOf(step: RouteStepDto): Maneuver {
    val left = step.modifier?.contains("left", ignoreCase = true) == true
    val sharp = step.modifier?.contains("sharp", ignoreCase = true) == true
    val slight = step.modifier?.contains("slight", ignoreCase = true) == true

    val type = when {
        step.maneuver.equals("depart", ignoreCase = true) -> Maneuver.TYPE_DEPART
        step.maneuver.equals("arrive", ignoreCase = true) -> Maneuver.TYPE_DESTINATION
        step.modifier?.contains("uturn", ignoreCase = true) == true ->
            if (left) Maneuver.TYPE_U_TURN_LEFT else Maneuver.TYPE_U_TURN_RIGHT
        step.maneuver.equals("roundabout", ignoreCase = true) ->
            Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CW
        sharp -> if (left) Maneuver.TYPE_TURN_SHARP_LEFT else Maneuver.TYPE_TURN_SHARP_RIGHT
        slight -> if (left) Maneuver.TYPE_TURN_SLIGHT_LEFT else Maneuver.TYPE_TURN_SLIGHT_RIGHT
        step.modifier != null -> if (left) Maneuver.TYPE_TURN_NORMAL_LEFT else Maneuver.TYPE_TURN_NORMAL_RIGHT
        else -> Maneuver.TYPE_STRAIGHT
    }

    return Maneuver.Builder(type).build()
}

/** A route summary line the host will render, distance span and all. */
private fun distanceText(km: Double, summary: String): CharSequence {
    val text = android.text.SpannableString(if (summary.isEmpty()) " " else "  $summary")
    text.setSpan(
        DistanceSpan.create(Distance.create(km, Distance.UNIT_KILOMETERS)),
        0,
        1,
        android.text.Spanned.SPAN_INCLUSIVE_EXCLUSIVE,
    )
    return text
}
