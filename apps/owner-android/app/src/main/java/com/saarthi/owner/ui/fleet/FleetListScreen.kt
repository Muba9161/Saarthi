package com.saarthi.owner.ui.fleet

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.AccountType
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.DriversApi
import com.saarthi.owner.network.PreferencesApi
import com.saarthi.owner.network.SharingApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.VehicleClass
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.plural
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rememberPhoto
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.common.vehicleClassOf
import com.saarthi.owner.ui.common.vehiclePhotoOf
import com.saarthi.owner.ui.design.Avatar
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SegmentedControl
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.sharing.SharedScopeRequest
import com.saarthi.owner.ui.sharing.SharedVehicleScreen
import com.saarthi.owner.ui.sharing.sharedWithMeItems
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val REFRESH_MS = 30_000L

/**
 * "Your fleet" — every vehicle with where it stands right now, and every
 * driver with what they are doing. The design's Fleet · Vehicles board.
 *
 * A personal account opens the same board: the Personal plan has drivers too
 * (up to six, the owner among them), so the Drivers switch stays.
 *
 * As on the web, the vehicles come in two scopes when the plan includes
 * sharing (Mine, and Shared with me with the invitations waiting counted on
 * it) and in two layouts, rows or cards, the choice saved on the server.
 */
@Composable
fun FleetListScreen(app: OwnerApp, account: SessionStore.Account) {
    val model = viewModel { FleetListModel(app.vehicles, app.drivers, account) }
    val state by model.state.collectAsStateWithLifecycle()
    var showDrivers by rememberSaveable { mutableStateOf(false) }
    var filter by rememberSaveable { mutableStateOf<VehicleClass?>(null) }
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()

    val sharing = account.hasFeature(SharingApi.FEATURE)
    var sharedScope by rememberSaveable { mutableStateOf(false) }
    var shared by remember { mutableStateOf<Loadable<SharingApi.SharedWithMe>>(Loadable.Loading) }
    var answering by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }

    suspend fun loadShared(silent: Boolean) {
        if (!sharing) return
        if (!silent) shared = Loadable.Loading
        shared = try {
            Loadable.Ready(app.sharing.sharedWithMe())
        } catch (failure: Exception) {
            if (silent && shared is Loadable.Ready) return
            Loadable.Failed(failure.readable())
        }
    }

    LaunchedEffect(Unit) {
        loadShared(silent = false)
        while (true) {
            delay(REFRESH_MS)
            model.refresh(silent = true)
            loadShared(silent = true)
        }
    }

    // The share invitation alert asks for this list to open on Shared with me.
    val requested by SharedScopeRequest.open
    LaunchedEffect(requested) {
        if (requested && sharing) {
            showDrivers = false
            sharedScope = true
            loadShared(silent = true)
        }
        SharedScopeRequest.open.value = false
    }

    // The saved layout, read once a session; rows until the person picks cards.
    val layout by VehicleLayout.mode
    LaunchedEffect(Unit) {
        if (VehicleLayout.mode.value == null) {
            VehicleLayout.mode.value = runCatching { app.viewPreferences.viewMode(PreferencesApi.VEHICLES) }.getOrNull() ?: PreferencesApi.TABLE
        }
    }
    fun chooseLayout(cards: Boolean) {
        val mode = if (cards) PreferencesApi.CARDS else PreferencesApi.TABLE
        VehicleLayout.mode.value = mode
        // Saved quietly: the toggle has already moved, and a failure only means it is not remembered.
        scope.launch { runCatching { app.viewPreferences.setViewMode(PreferencesApi.VEHICLES, mode) } }
    }

    fun answer(invitation: SharingApi.Invitation, accept: Boolean) {
        answering = invitation.shareId
        notice = null
        scope.launch {
            notice = try {
                app.sharing.respond(invitation.shareId, accept)
                loadShared(silent = true)
                (if (accept) "${formatPlate(invitation.registrationNumber)} is now in Shared with me." else "Invitation declined.") to NoticeTone.SUCCESS
            } catch (failure: Exception) {
                failure.readable() to NoticeTone.DANGER
            }
            answering = null
        }
    }

    val top = headerClearance()
    val bottom = tabBarClearance()
    when (val shown = state) {
        Loadable.Loading -> SkeletonCards(modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = top))
        is Loadable.Failed -> FailedCard(shown.message, { model.refresh() }, Modifier.padding(start = 20.dp, end = 20.dp, top = top))
        is Loadable.Ready -> {
            val lists = shown.value
            val classes = lists.vehicles.groupingBy { vehicleClassOf(it.artType) }.eachCount()
            val vehicles = lists.vehicles.filter { filter == null || vehicleClassOf(it.artType) == filter }
            val papersDue = lists.vehicles.sumOf { it.documentHealth.expired + it.documentHealth.expiringSoon }

            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = top, bottom = bottom),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item(key = "switch") {
                    SegmentedControl(
                        options = listOf("Vehicles · ${lists.vehicles.size}", "Drivers · ${lists.drivers.size}"),
                        selected = if (showDrivers) 1 else 0,
                        onSelect = { showDrivers = it == 1 },
                        modifier = Modifier.rise(),
                    )
                }
                if (!showDrivers) {
                    item(key = "tools") {
                        Row(
                            Modifier.fillMaxWidth().rise(stagger(1)),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            if (sharing) {
                                val waiting = (shared as? Loadable.Ready)?.value?.invitations?.size ?: 0
                                ChoiceChip("Mine", selected = !sharedScope, onClick = { sharedScope = false })
                                ChoiceChip(
                                    if (waiting > 0) "Shared with me · $waiting" else "Shared with me",
                                    selected = sharedScope,
                                    onClick = { sharedScope = true },
                                )
                            }
                            Box(Modifier.weight(1f))
                            if (!sharedScope) LayoutToggle(cards = layout.isCards(), onChange = ::chooseLayout)
                        }
                    }
                    notice?.let { (text, tone) -> item(key = "notice") { NoticeCard(text, tone) } }
                }
                if (!showDrivers && sharedScope) {
                    sharedWithMeItems(
                        state = shared,
                        answering = answering,
                        onAnswer = ::answer,
                        onOpen = { vehicle ->
                            navigator.push("shared-${vehicle.shareId}") {
                                SharedVehicleScreen(app, vehicle) { scope.launch { loadShared(silent = true) } }
                            }
                        },
                        onRetry = { scope.launch { loadShared(silent = false) } },
                    )
                } else if (!showDrivers) {
                    if (classes.size > 1) {
                        item(key = "chips") {
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(rememberScrollState())
                                    .rise(stagger(1)),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                ChoiceChip("All · ${lists.vehicles.size}", selected = filter == null, onClick = { filter = null })
                                VehicleClass.entries.filter { it in classes }.forEach { kind ->
                                    ChoiceChip(
                                        "${kind.label} · ${classes[kind]}",
                                        selected = filter == kind,
                                        onClick = { filter = kind },
                                    )
                                }
                            }
                        }
                    }
                    if (papersDue > 0) {
                        item(key = "papers") {
                            NoticeCard(
                                "${plural(papersDue, "paper")} due or expired across ${if (account.accountType == AccountType.PERSONAL) "your vehicles" else "the fleet"}. Renew them before a check post stops a vehicle.",
                                NoticeTone.WARNING,
                                Modifier.rise(stagger(2)),
                                icon = Lucide.alertTriangle,
                            )
                        }
                    }
                    if (vehicles.isEmpty()) {
                        item(key = "empty") { EmptyLine("No vehicles here yet.") }
                    }
                    items(vehicles, key = { it.id }) { vehicle ->
                        val open = { navigator.push("vehicle-${vehicle.id}") { VehicleScreen(app, account, vehicle) } }
                        if (layout.isCards()) VehicleCard(vehicle, open) else VehicleRow(vehicle, open)
                    }
                } else {
                    if (lists.drivers.isEmpty()) {
                        item(key = "empty-drivers") { EmptyLine("No drivers on this account.") }
                    }
                    items(lists.drivers, key = { it.id }) { driver -> DriverRow(driver) }
                }
            }
        }
    }
}

@Composable
private fun VehicleRow(vehicle: VehiclesApi.Vehicle, onOpen: () -> Unit) {
    val c = Saarthi.colors
    val photo = vehiclePhotoOf(vehicle.artType)
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .pressable(scale = 0.98f, onClick = onOpen)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier
                .size(width = 72.dp, height = 54.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(c.sunken),
            contentAlignment = Alignment.Center,
        ) {
            val bitmap = photo?.let { rememberPhoto(it) }
            if (bitmap != null) {
                Image(bitmap, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.padding(4.dp))
            } else {
                LineIcon(Lucide.truck, size = 26.dp, color = c.muted)
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                PlateChip(vehicle.registrationNumber, size = 12.sp)
                Box(Modifier.weight(1f))
                MotionPill(vehicle)
            }
            Text(
                listOfNotNull(
                    vehicle.categoryLabel?.takeIf { it.isNotBlank() } ?: vehicle.typeLabel.ifBlank { null },
                    vehicle.currentDriver?.name?.ifBlank { null }
                        ?: listOfNotNull(vehicle.manufacturer, vehicle.model).joinToString(" ").ifBlank { null },
                ).joinToString(" · "),
                style = SType.small,
                color = c.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** "● 62 km/h", "Idle 18m", "Offline", "In service". */
@Composable
internal fun MotionPill(vehicle: VehiclesApi.Vehicle) {
    val c = Saarthi.colors
    when (vehicle.motion()) {
        VehiclesApi.Motion.MOVING -> StatusPill(
            "${(vehicle.lastLocation?.speedKph ?: 0.0).toInt()} km/h",
            background = c.successBg,
            ink = c.success,
            live = true,
        )
        VehiclesApi.Motion.IDLE -> StatusPill(
            vehicle.minutesSinceReport()?.let { "Idle ${it}m" } ?: "Idle",
            background = c.warningBg,
            ink = c.warning,
        )
        VehiclesApi.Motion.OFFLINE -> StatusPill("Offline", background = c.sunken, ink = c.muted)
        VehiclesApi.Motion.SERVICE -> StatusPill("Service", background = c.warningBg, ink = c.warning)
    }
}

@Composable
private fun DriverRow(driver: DriversApi.Driver) {
    val c = Saarthi.colors
    val (word, ground, ink) = when (driver.availability) {
        "ON_TRIP" -> Triple("On trip", c.successBg, c.success)
        "AVAILABLE" -> Triple("Available", c.primaryWash, c.primary)
        "OFF_DUTY" -> Triple("Off duty", c.sunken, c.muted)
        "ON_LEAVE" -> Triple("On leave", c.sunken, c.muted)
        "SUSPENDED" -> Triple("Suspended", c.dangerBg, c.danger)
        else -> Triple(driver.availability.lowercase().replaceFirstChar { it.uppercase() }, c.sunken, c.muted)
    }
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Avatar(driver.fullName, size = 48.dp, background = c.primarySoft, ink = c.primary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(driver.fullName, style = SType.rowTitle, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(
                    driver.currentTruck?.registrationNumber?.ifBlank { null }?.let(::formatPlate),
                    "${plural(driver.totalTrips, "trip")}",
                    driver.overallScore?.let { "score $it" },
                ).joinToString(" · "),
                style = SType.small,
                color = c.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        StatusPill(word, background = ground, ink = ink, live = driver.availability == "ON_TRIP")
    }
}

@Composable
private fun EmptyLine(text: String) {
    val c = Saarthi.colors
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        IconWell(Lucide.truck, well = c.sunken, ink = c.muted, size = 64.dp, shape = CircleShape, iconSize = 26.dp)
        Text(text, style = SType.body, color = c.muted)
    }
}
