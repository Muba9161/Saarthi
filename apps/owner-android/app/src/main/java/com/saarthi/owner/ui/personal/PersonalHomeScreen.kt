package com.saarthi.owner.ui.personal

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.network.SharingApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.ago
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rememberPhoto
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.common.vehiclePhotoOf
import com.saarthi.owner.ui.design.Brand
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.brandGradient
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.fleet.FleetListModel
import com.saarthi.owner.ui.fleet.VehicleLiveScreen
import com.saarthi.owner.ui.papers.INSURANCE_FOLDER
import com.saarthi.owner.ui.papers.daysLeft
import com.saarthi.owner.ui.papers.standing
import com.saarthi.owner.ui.sharing.InvitationsOnHome
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.shell.ShellActions
import kotlinx.coroutines.delay

private const val REFRESH_MS = 30_000L

/** The platform's "expiring soon" window: thirty days, as the web colours it. */
private const val DUE_SOON_DAYS = 30

/**
 * Home for somebody running their own vehicles — the design's Personal · Home.
 *
 * One vehicle at a time: where it is, its papers, and the people it is
 * shared with.
 */
@Composable
fun PersonalHomeScreen(app: OwnerApp, account: SessionStore.Account, actions: ShellActions) {
    val model = viewModel { FleetListModel(app.vehicles, app.drivers, account) }
    val state by model.state.collectAsStateWithLifecycle()
    var picked by rememberSaveable { mutableStateOf<String?>(null) }
    // The tiles say "loading" or "could not load" rather than a misleading "None".
    var wallet by remember { mutableStateOf<Loadable<PapersApi.Wallet>>(Loadable.Loading) }
    var shares by remember { mutableStateOf<List<SharingApi.Share>>(emptyList()) }
    val navigator = LocalNavigator.current
    val c = Saarthi.colors

    LaunchedEffect(Unit) {
        while (true) {
            delay(REFRESH_MS)
            model.refresh(silent = true)
        }
    }

    val vehicles = (state as? Loadable.Ready)?.value?.vehicles.orEmpty()
    val vehicle = vehicles.firstOrNull { it.id == picked } ?: vehicles.firstOrNull()
    LaunchedEffect(vehicle?.id) {
        val id = vehicle?.id ?: return@LaunchedEffect
        wallet = Loadable.Loading
        wallet = try {
            Loadable.Ready(app.papers.wallet(id))
        } catch (failure: Exception) {
            Loadable.Failed(failure.readable())
        }
        shares = runCatching { app.sharing.shares(id) }.getOrDefault(emptyList())
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = headerClearance(), bottom = tabBarClearance()),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        when (val shown = state) {
            Loadable.Loading -> SkeletonCards()
            is Loadable.Failed -> FailedCard(shown.message, { model.refresh() })
            is Loadable.Ready -> {
                InvitationsOnHome(app, account, Modifier.rise())
                if (vehicle == null) {
                    Text("No vehicle on this account yet. Add one from Saarthi on the web.", style = SType.body, color = c.muted)
                    return@Column
                }
                if (vehicles.size > 1) {
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).rise(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        vehicles.forEach { each ->
                            ChoiceChip(
                                "${each.typeLabel.ifBlank { "Vehicle" }} · ${each.registrationNumber.takeLast(6).let(::formatPlate)}",
                                selected = each.id == vehicle.id,
                                onClick = { picked = each.id },
                            )
                        }
                    }
                }
                WhereItIs(vehicle, Modifier.rise(stagger(1))) {
                    navigator.push("vehicle-map-${vehicle.id}") { VehicleLiveScreen(app, vehicle, null) }
                }

                Row(Modifier.fillMaxWidth().rise(stagger(2)), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    // From the wallet, so a date the RTO register holds counts as much as a scan.
                    val held = (wallet as? Loadable.Ready)?.value
                    val unreadable = wallet is Loadable.Failed
                    val insuranceFolder = held?.folders?.firstOrNull { it.id == INSURANCE_FOLDER }
                    val insuranceDays = insuranceFolder?.let { held.daysLeft(it) }
                    val standing = held?.standing()
                    Tile(
                        Lucide.fileText, c.warningSoft, c.warning, "Insurance",
                        insuranceDays?.let { if (it < 0) "Expired" else "$it days" } ?: "—",
                        when {
                            unreadable -> "could not load"
                            held == null -> "loading"
                            insuranceDays == null -> "not on file"
                            else -> "left"
                        },
                        Modifier.weight(1f),
                        if ((insuranceDays ?: Int.MAX_VALUE) <= DUE_SOON_DAYS) c.warning else c.fg,
                    ) { actions.selectTab("papers") }
                    Tile(
                        Lucide.shieldCheck, c.primarySoft, c.primary, "Papers",
                        // Nothing on file is not "all set": there is simply nothing to check yet.
                        when {
                            standing == null -> "—"
                            standing.onFile == 0 -> "None"
                            standing.attention == 0 -> "All set"
                            else -> "${standing.attention} due"
                        },
                        when {
                            unreadable -> "could not load"
                            standing == null -> "loading"
                            else -> "${standing.onFile} on file"
                        },
                        Modifier.weight(1f),
                        if ((standing?.attention ?: 0) > 0) c.warning else c.fg,
                    ) {
                        actions.selectTab("papers")
                    }
                    Tile(Lucide.gauge, c.accentSoft, c.accent, "Odometer", vehicle.odometerKm?.let { "%,d".format(it.toLong()) } ?: "—", "km", Modifier.weight(1f)) {}
                }

                Text("Quick actions", style = SType.section, color = c.fg, modifier = Modifier.padding(top = 6.dp))
                Row(Modifier.fillMaxWidth().rise(stagger(3)), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Action(Lucide.fileText, c.primarySoft, c.primary, "Papers", Modifier.weight(1f)) { actions.selectTab("papers") }
                    Action(Lucide.users, c.successSoft, c.success, "Sharing", Modifier.weight(1f)) {
                        navigator.push("sharing-${vehicle.id}") { SharingScreen(app, vehicle) }
                    }
                    Action(Lucide.map, c.infoSoft, c.info, "Map", Modifier.weight(1f)) { actions.selectTab("map") }
                }
                if (shares.isNotEmpty()) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .card(radius = 20.dp)
                            .pressable(scale = 0.98f) { navigator.push("sharing-${vehicle.id}") { SharingScreen(app, vehicle) } }
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        IconWell(Lucide.users, well = c.successSoft, ink = c.success, size = 36.dp, shape = CircleShape, iconSize = 16.dp)
                        Text("Shared with ${shares.size} ${if (shares.size == 1) "person" else "people"}", style = SType.bodyStrong, color = c.fg, modifier = Modifier.weight(1f))
                        LineIcon(Lucide.chevronRight, size = 16.dp, color = c.subtle)
                    }
                }
            }
        }
    }
}

/** "Where it is" — the plate as it is painted, and the way to find it. */
@Composable
private fun WhereItIs(vehicle: VehiclesApi.Vehicle, modifier: Modifier, onFind: () -> Unit) {
    val (word, dot) = when (vehicle.motion()) {
        VehiclesApi.Motion.MOVING -> "Moving" to Brand.live
        VehiclesApi.Motion.IDLE, VehiclesApi.Motion.SERVICE -> "Parked" to Color(0xFFF2952C)
        VehiclesApi.Motion.OFFLINE -> "Not reporting" to Color(0xFF9F9FA8)
    }
    Box(
        modifier
            .fillMaxWidth()
            .height(232.dp)
            .shadow(20.dp, RoundedCornerShape(28.dp), spotColor = Color(0xBF021D40), ambientColor = Color.Transparent)
            .brandGradient(RoundedCornerShape(28.dp)),
    ) {
        val photo = vehiclePhotoOf(vehicle.artType)?.let { rememberPhoto(it) }
        if (photo != null) {
            Image(photo, null, contentScale = ContentScale.Fit, modifier = Modifier.align(Alignment.BottomEnd).padding(end = 4.dp, bottom = 10.dp).size(width = 170.dp, height = 90.dp))
        }
        Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Eyebrow("Where it is", Modifier.weight(1f), color = Color.White.copy(alpha = 0.75f))
                StatusPill(word, background = Color.White.copy(alpha = 0.14f), ink = Color.White, dotColor = dot, live = word == "Moving", ring = Color.White.copy(alpha = 0.2f))
            }
            Box(
                Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color.White)
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            ) {
                Text(formatPlate(vehicle.registrationNumber), style = SType.plate(24.sp, 0.06.em), color = Color(0xFF18181B))
            }
            Text(
                vehicle.lastLocation?.recordedAt?.let { at -> ago(at).let { if (it == "now") "Reporting now" else "Last seen $it ago" } } ?: "No position reported yet",
                style = SType.small,
                color = Color.White.copy(alpha = 0.82f),
            )
            Box(Modifier.weight(1f))
            Row(
                Modifier
                    .height(44.dp)
                    .clip(CircleShape)
                    .background(Color.White)
                    .pressable(onClick = onFind)
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text("Find my ${vehicle.typeLabel.ifBlank { "vehicle" }.let { if (it == it.uppercase()) it else it.lowercase() }}", style = SType.bodyStrong, color = Brand.navy)
                LineIcon(Lucide.arrowRight, size = 16.dp, color = Brand.navy, stroke = 2.2f)
            }
        }
    }
}

@Composable
private fun Tile(icon: String, well: Color, ink: Color, label: String, value: String, caption: String, modifier: Modifier, valueColor: Color = Saarthi.colors.fg, onClick: () -> Unit) {
    val c = Saarthi.colors
    Column(modifier.card().pressable(onClick = onClick).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        IconWell(icon, well = well, ink = ink, size = 30.dp, radius = 10.dp, iconSize = 16.dp)
        Eyebrow(label, maxLines = 1)
        Text(value, style = SType.headerTitle.copy(fontSize = 19.sp), color = valueColor, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(caption, style = SType.caption, color = c.subtle, maxLines = 1)
    }
}

@Composable
private fun Action(icon: String, well: Color, ink: Color, label: String, modifier: Modifier, onClick: () -> Unit) {
    val c = Saarthi.colors
    Column(
        modifier.card(radius = 20.dp).pressable(scale = 0.95f, label = label, onClick = onClick).padding(vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        IconWell(icon, well = well, ink = ink, size = 44.dp, radius = 14.dp)
        Text(label, style = SType.smallStrong, color = c.fg)
    }
}
