package com.saarthi.driver.ui.shift.map

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.saarthi.core.network.RouteStepDto
import com.saarthi.core.telemetry.Metric
import com.saarthi.core.ui.MapLook
import com.saarthi.core.ui.TerminalMap
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Lucide
import kotlinx.coroutines.delay
import java.util.Locale

/**
 * The live map as the design draws it: the top-down vehicle pins with an indigo
 * glow, an indigo route with a soft wide casing, and a saffron end point. The
 * credits are printed by the screens themselves, clear of their own panels.
 */
val HumsafarMapLook = MapLook(
    truckMarker = R.drawable.pin_truck,
    busMarker = R.drawable.pin_bus,
    carMarker = R.drawable.pin_car,
    autoMarker = R.drawable.pin_car,
    markerScale = 1f,
    haloColor = "#727FF3",
    haloOpacity = 0.28f,
    haloRadius = 24f,
    routeColor = "#727FF3",
    routeWidth = 5f,
    casingColor = "#727FF3",
    casingOpacity = 0.28f,
    casingWidth = 16f,
    destinationColor = "#FE5D09",
    destinationRadius = 8f,
    destinationRing = "rgba(254,93,9,0.22)",
    destinationRingWidth = 10f,
    nativeAttribution = false,
)

/**
 * Whether the map follows the vehicle, and when it should show the whole route.
 *
 * A drag hands the view to the driver; following comes back by itself after a
 * quiet spell, as every navigator does, or at once from the recentre button.
 */
@Stable
class MapCamera {
    var following by mutableStateOf(true)
        private set
    var frameRequest by mutableIntStateOf(0)
        private set
    internal var panEpoch by mutableIntStateOf(0)
        private set

    fun recentre() {
        following = true
    }

    fun panned() {
        following = false
        panEpoch++
    }

    fun frameRoute() {
        following = true
        frameRequest++
    }
}

/** A camera that frames each new destination once and resumes following on its own. */
@Composable
fun rememberMapCamera(navigation: TerminalViewModel.NavigationUi): MapCamera {
    val camera = remember { MapCamera() }
    LaunchedEffect(camera.following, camera.panEpoch) {
        if (camera.following) return@LaunchedEffect
        delay(RESUME_FOLLOW_MS)
        camera.recentre()
    }
    val destination = navigation.route?.destination
    LaunchedEffect(destination?.latitude, destination?.longitude) {
        if (destination != null) camera.frameRoute()
    }
    return camera
}

/** The shared map engine, dressed in [HumsafarMapLook] and driven by the cockpit. */
@Composable
fun LiveMap(
    state: TerminalViewModel.UiState,
    navigation: TerminalViewModel.NavigationUi,
    camera: MapCamera,
    modifier: Modifier = Modifier,
) {
    val route = navigation.route
    TerminalMap(
        position = state.telemetry.position,
        headingDegrees = state.telemetry.value(Metric.HEADING),
        driving = state.moving,
        // Remembered against the route so a speed tick does not hand the map a
        // fresh list of several thousand points.
        routeGeometry = remember(route) { route?.geometry?.map { it.latitude to it.longitude } ?: emptyList() },
        destination = route?.destination?.let { it.latitude to it.longitude },
        followVehicle = camera.following,
        onUserPannedMap = camera::panned,
        navigating = navigation.guiding,
        previewingRoute = navigation.previewing,
        frameRouteRequest = camera.frameRequest,
        vehicleType = state.server?.vehicle?.vehicleType,
        look = HumsafarMapLook,
        modifier = modifier,
    )
}

/** "Truck", "Bus" or "Car" — from the same grouping that picks the map pin. */
@Composable
fun vehicleWord(vehicleType: String?): String = stringResource(
    when (HumsafarMapLook.markerFor(vehicleType)) {
        R.drawable.pin_car -> R.string.vehicle_car
        R.drawable.pin_bus -> R.string.vehicle_bus
        else -> R.string.vehicle_truck
    },
)

/** The glyph for the next manoeuvre; a straight arrow for anything unfamiliar. */
fun maneuverIcon(step: RouteStepDto?): String {
    val modifier = step?.modifier
    return when {
        step == null -> Lucide.arrowUp
        step.maneuver == "arrive" -> Lucide.flag
        step.maneuver == "roundabout" || step.maneuver == "exit roundabout" -> Lucide.roundabout
        step.maneuver == "fork" -> Lucide.fork
        modifier == "uturn" -> Lucide.uTurn
        modifier == "left" || modifier == "sharp left" -> Lucide.turnLeft
        modifier == "right" || modifier == "sharp right" -> Lucide.turnRight
        modifier == "slight left" -> Lucide.slightLeft
        modifier == "slight right" -> Lucide.slightRight
        else -> Lucide.arrowUp
    }
}

/**
 * How far to the turn, rounded to what a driver can act on: "Now" under 50 m,
 * fifty-metre steps below a kilometre, then tenths.
 */
@Composable
fun distanceToTurn(metres: Int): String = when {
    metres < 50 -> stringResource(R.string.nav_now)
    metres < 1_000 -> stringResource(R.string.nav_metres, (metres / 50) * 50)
    metres < 10_000 -> stringResource(R.string.nav_km, String.format(Locale.getDefault(), "%.1f", metres / 1_000.0))
    else -> stringResource(R.string.nav_km, (metres / 1_000).toString())
}

/** Following resumes after this long without a drag or pinch — the tablet's own interval. */
private const val RESUME_FOLLOW_MS = 12_000L
