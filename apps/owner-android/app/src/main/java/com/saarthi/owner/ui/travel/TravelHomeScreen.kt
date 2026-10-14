package com.saarthi.owner.ui.travel

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.TravelApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.FacesAlignment
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.rememberPhoto
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.common.vehiclePhotoOf
import com.saarthi.owner.ui.design.Brand
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.jobs.Pill
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.shell.ShellActions
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private const val REFRESH_MS = 45_000L
private val TimeFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
private val DayFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM")

/**
 * The travel operator's home — the design's Travel · Home: how many are on
 * the road, today's trips, and what needs confirming.
 */
@Composable
fun TravelHomeScreen(app: OwnerApp, actions: ShellActions) {
    val model = viewModel { TravelModel(app.travel, app.vehicles) }
    val state by model.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val c = Saarthi.colors

    LaunchedEffect(Unit) {
        while (true) {
            delay(REFRESH_MS)
            model.refresh(silent = true)
        }
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
                val book = shown.value
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(206.dp)
                        .rise()
                        .clip(RoundedCornerShape(28.dp)),
                ) {
                    Image(painterResource(R.drawable.photo_role_travel), null, contentScale = ContentScale.Crop, alignment = FacesAlignment, modifier = Modifier.fillMaxSize())
                    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x1A021D40), Color(0xF2021D40)))))
                    Column(Modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.SpaceBetween) {
                        StatusPill(
                            if (book.onTheRoad > 0) "${book.onTheRoad} on the road" else "Nobody on the road",
                            background = Color.White.copy(alpha = 0.16f),
                            ink = Color.White,
                            dotColor = Brand.live,
                            live = book.onTheRoad > 0,
                            ring = Color.White.copy(alpha = 0.2f),
                        )
                        Row(verticalAlignment = Alignment.Bottom) {
                            Column(Modifier.weight(1f)) {
                                Eyebrow("Today", color = Color.White.copy(alpha = 0.78f))
                                Text(
                                    "${book.today.size} booking${if (book.today.size == 1) "" else "s"}",
                                    style = SType.title.copy(fontSize = 30.sp),
                                    color = Color.White,
                                )
                            }
                            Row(
                                Modifier
                                    .height(44.dp)
                                    .clip(CircleShape)
                                    .background(Color.White)
                                    .pressable { actions.selectTab("map") }
                                    .padding(horizontal = 16.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Text("Map", style = SType.bodyStrong, color = Brand.navy)
                                LineIcon(Lucide.arrowRight, size = 16.dp, color = Brand.navy, stroke = 2.2f)
                            }
                        }
                    }
                }

                Row(Modifier.fillMaxWidth().rise(stagger(1)), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    val running = book.vehicles.count { it.motion() != VehiclesApi.Motion.OFFLINE }
                    Figure("On duty", "$running", "/${book.vehicles.size}", "vehicles", Modifier.weight(1f))
                    Figure("Awaiting", "${book.awaitingYou.size}", "", "to confirm", Modifier.weight(1f), if (book.awaitingYou.isNotEmpty()) c.warning else c.fg)
                    Figure("Rating", book.averageRating?.let { "%.1f".format(it) } ?: "—", "", "from trips", Modifier.weight(1f))
                }

                Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Today's run", style = SType.section, color = c.fg, modifier = Modifier.weight(1f))
                    LinkButton("All bookings", { actions.selectTab("bookings") }, style = SType.smallStrong)
                }
                val list = book.today.ifEmpty { book.upcoming.take(4) }
                if (book.today.isEmpty() && list.isNotEmpty()) {
                    Text("Nothing today. Coming up:", style = SType.small, color = c.muted)
                }
                if (list.isEmpty()) {
                    Text("No bookings yet. Quote on requests near you to fill the diary.", style = SType.small, color = c.muted)
                }
                list.forEach { booking ->
                    BookingRow(booking) { navigator.push("booking-${booking.id}") { TravelBookingScreen(app, booking) { model.refresh(silent = true) } } }
                }
            }
        }
    }
}

/** Every booking: those still to run first, then the rest. */
@Composable
fun TravelBookingsScreen(app: OwnerApp) {
    val model = viewModel { TravelModel(app.travel, app.vehicles) }
    val state by model.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val c = Saarthi.colors
    val top = headerClearance()
    val bottom = tabBarClearance()
    when (val shown = state) {
        Loadable.Loading -> SkeletonCards(modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = top))
        is Loadable.Failed -> FailedCard(shown.message, { model.refresh() }, Modifier.padding(start = 20.dp, end = 20.dp, top = top))
        is Loadable.Ready -> {
            val (open, done) = shown.value.bookings.sortedByDescending { it.startDate }.partition { it.open }
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = top, bottom = bottom),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (open.isEmpty() && done.isEmpty()) {
                    item { Text("No bookings yet.", style = SType.small, color = c.muted) }
                }
                if (open.isNotEmpty()) item { GroupLabel("Still to run") }
                items(open.sortedBy { it.startDate }, key = { it.id }) { booking ->
                    BookingRow(booking) { navigator.push("booking-${booking.id}") { TravelBookingScreen(app, booking) { model.refresh(silent = true) } } }
                }
                if (done.isNotEmpty()) item { GroupLabel("Earlier") }
                items(done, key = { it.id }) { booking ->
                    BookingRow(booking) { navigator.push("booking-${booking.id}") { TravelBookingScreen(app, booking) { model.refresh(silent = true) } } }
                }
            }
        }
    }
}

/** A booking's status as a word and its colours. */
@Composable
internal fun bookingLook(status: String): Triple<String, Color, Color> {
    val c = Saarthi.colors
    return when (status) {
        "AWAITING_CONFIRMATION" -> Triple("Confirm it", c.warningBg, c.warning)
        "PENDING_PAYMENT" -> Triple("Awaiting payment", c.sunken, c.muted)
        "CONFIRMED" -> Triple("Driver assigned", c.primaryWash, c.primary)
        "IN_PROGRESS" -> Triple("On the way", c.successBg, c.success)
        "COMPLETED" -> Triple("Completed", c.sunken, c.muted)
        "DECLINED", "CANCELLED", "REFUNDED" -> Triple("Cancelled", c.dangerBg, c.danger)
        else -> Triple(status.lowercase().replace('_', ' '), c.sunken, c.muted)
    }
}

@Composable
internal fun BookingRow(
    booking: TravelApi.Booking,
    /** Its status in the words of whoever is reading — the operator's by default. */
    look: Triple<String, Color, Color> = bookingLook(booking.status),
    onOpen: () -> Unit,
) {
    val c = Saarthi.colors
    val start = runCatching { Instant.parse(booking.startDate).atZone(ZoneId.systemDefault()) }.getOrNull()
    val (word, ground, ink) = look
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 22.dp, ring = if (booking.status == "IN_PROGRESS") c.primaryRing else c.ring)
            .pressable(scale = 0.98f, onClick = onOpen)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Column(Modifier.width(54.dp)) {
            Text(start?.let { TimeFormat.format(it) } ?: "—", style = SType.bodyStrong, color = c.fg)
            Text(start?.let { if (it.toLocalDate() == java.time.LocalDate.now()) "pickup" else DayFormat.format(it) } ?: "", style = SType.caption, color = c.muted)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(booking.title, style = SType.bodyStrong, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Pill(word, ground, ink)
        }
        val photo = rememberPhoto(vehiclePhotoOf(booking.vehicle?.vehicleType ?: "SUV") ?: R.drawable.vehicle_suv)
        if (photo != null) Image(photo, null, contentScale = ContentScale.Fit, modifier = Modifier.size(width = 70.dp, height = 38.dp))
    }
}

@Composable
private fun Figure(label: String, value: String, suffix: String, caption: String, modifier: Modifier, valueColor: Color = Saarthi.colors.fg) {
    val c = Saarthi.colors
    Column(modifier.card().padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Eyebrow(label, maxLines = 1)
        Row(verticalAlignment = Alignment.Bottom) {
            Text(value, style = SType.headerTitle.copy(fontSize = 22.sp), color = valueColor, maxLines = 1)
            if (suffix.isNotEmpty()) Text(suffix, style = SType.small, color = c.muted, modifier = Modifier.padding(bottom = 2.dp))
        }
        Text(caption, style = SType.caption, color = c.subtle, maxLines = 1)
    }
}
