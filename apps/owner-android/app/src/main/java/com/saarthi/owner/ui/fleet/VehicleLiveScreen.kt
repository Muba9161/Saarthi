package com.saarthi.owner.ui.fleet

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.ago
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.km
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.map.MapVehicle
import com.saarthi.owner.ui.map.MarkerState
import com.saarthi.owner.ui.map.VehicleMap
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.delay

private const val FOLLOW_MS = 10_000L

/**
 * One vehicle followed on the map, with its planned route drawn — the camera
 * goes back to it every time a new position arrives.
 */
@Composable
fun VehicleLiveScreen(app: OwnerApp, initial: VehiclesApi.Vehicle, trip: TripsApi.Trip?) {
    var vehicle by remember { mutableStateOf(initial) }
    var focus by remember { mutableIntStateOf(0) }
    val navigator = LocalNavigator.current
    val c = Saarthi.colors

    LaunchedEffect(initial.id) {
        while (true) {
            focus++
            delay(FOLLOW_MS)
            runCatching { app.vehicles.get(initial.id) }.getOrNull()?.let { vehicle = it }
        }
    }

    val location = vehicle.lastLocation
    val markers = if (location?.latitude != null && location.longitude != null) {
        listOf(
            MapVehicle(
                id = vehicle.id,
                latitude = location.latitude,
                longitude = location.longitude,
                state = when (vehicle.motion()) {
                    VehiclesApi.Motion.MOVING -> MarkerState.MOVING
                    VehiclesApi.Motion.OFFLINE -> MarkerState.OFFLINE
                    else -> MarkerState.IDLE
                },
                label = formatPlate(vehicle.registrationNumber),
            ),
        )
    } else {
        emptyList()
    }
    val bottomPx = with(LocalDensity.current) { 180.dp.roundToPx() }

    Box(Modifier.fillMaxSize()) {
        VehicleMap(
            vehicles = markers,
            selectedId = vehicle.id,
            onSelect = {},
            route = trip?.plannedRoute.orEmpty().map { it.latitude to it.longitude },
            focusRequest = focus,
            bottomPaddingPx = bottomPx,
            modifier = Modifier.fillMaxSize(),
        )
        CircleButton(
            Lucide.chevronLeft,
            "Back",
            navigator::pop,
            size = 48.dp,
            modifier = Modifier
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(16.dp),
        )
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.navigationBars)
                .padding(16.dp)
                .card(radius = 24.dp, color = c.elevated)
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PlateChip(vehicle.registrationNumber, size = 12.sp)
                MotionPill(vehicle)
            }
            Text(
                when {
                    location?.recordedAt == null -> "This vehicle has not reported a position yet."
                    trip != null -> listOfNotNull(
                        trip.destinationAddress.ifBlank { null }?.let { "To $it" },
                        trip.remainingKm?.let { "${km(it)} to go" },
                        clockOf(trip.etaAt)?.let { "ETA $it" },
                    ).joinToString(" · ")
                    else -> ago(location.recordedAt).let { if (it == "now") "Reporting now" else "Last seen $it ago" }
                },
                style = SType.body,
                color = c.muted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
