package com.saarthi.owner.ui.fleet

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.RequirementsApi
import com.saarthi.owner.network.ReturnLoadsApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.ago
import com.saarthi.owner.ui.common.clockOf
import com.saarthi.owner.ui.common.plural
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SaarthiField
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.jobs.Pill
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/** What the screen reads in one go. */
private data class Backhaul(val risks: List<ReturnLoadsApi.EmptyRisk>, val loads: List<ReturnLoadsApi.Opportunity>)

/**
 * "Return loads" — trucks about to run home empty, and the loads that would
 * fill them, best fit first. The design's Business · Backhaul.
 */
@Composable
fun ReturnLoadsScreen(app: OwnerApp) {
    val c = Saarthi.colors
    var state by remember { mutableStateOf<Loadable<Backhaul>>(Loadable.Loading) }
    var reload by remember { mutableIntStateOf(0) }
    var quoting by remember { mutableStateOf<ReturnLoadsApi.Opportunity?>(null) }
    var done by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(reload) {
        state = try {
            coroutineScope {
                val risks = async { app.returnLoads.emptyRisk() }
                val loads = async { app.returnLoads.opportunities() }
                Loadable.Ready(Backhaul(risks.await().filter { !it.hasReturnLoad }, loads.await().sortedByDescending { it.score }))
            }
        } catch (failure: Exception) {
            Loadable.Failed(failure.readable())
        }
    }

    Box(Modifier.fillMaxSize()) {
        DetailScreen(eyebrow = "Business · backhaul", title = "Return loads", eyebrowColor = c.success) {
            when (val shown = state) {
                Loadable.Loading -> SkeletonCards()
                is Loadable.Failed -> NoticeCard(shown.message, NoticeTone.WARNING, icon = Lucide.cloudOff)
                is Loadable.Ready -> {
                    done?.let { NoticeCard(it, NoticeTone.SUCCESS, icon = Lucide.check) }
                    shown.value.risks.firstOrNull()?.let { EmptySoonHero(it, shown.value.loads.size, Modifier.rise()) }
                    shown.value.risks.drop(1).forEach { RiskRow(it) }
                    if (shown.value.loads.isEmpty()) {
                        NoticeCard(
                            if (shown.value.risks.isEmpty()) {
                                "No truck is about to run empty, and nothing is waiting on the way back."
                            } else {
                                "Nothing matches the way back yet. New loads are checked as customers post them."
                            },
                            NoticeTone.INFO,
                            icon = Lucide.refresh,
                        )
                    } else {
                        GroupLabel("Best match first")
                        shown.value.loads.forEachIndexed { index, load ->
                            LoadCard(load, best = index == 0, modifier = Modifier.rise(stagger(index + 1))) { quoting = load }
                        }
                    }
                }
            }
        }

        QuoteSheet(
            load = quoting,
            onDismiss = { quoting = null },
            onQuote = { load, price, note, finish ->
                app.returnLoads.runCatching { quote(load.id, price, note) }
                    .onSuccess {
                        done = "Quote sent for ${load.materialName}. The customer has been told."
                        quoting = null
                        reload++
                    }
                    .let { finish(it.exceptionOrNull()?.readable()) }
            },
        )
    }
}

/** The headline: one truck about to drive home empty. */
@Composable
private fun EmptySoonHero(risk: ReturnLoadsApi.EmptyRisk, matches: Int, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(214.dp)
            .clip(RoundedCornerShape(28.dp)),
    ) {
        Image(
            painterResource(R.drawable.photo_safety_night),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        Box(
            Modifier
                .fillMaxSize()
                .background(Brush.verticalGradient(listOf(Color(0x99021D40), Color(0xF2021D40)))),
        )
        Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Eyebrow("Running empty soon", color = Color.White.copy(alpha = 0.78f))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PlateChip(risk.truckRegistration, size = 12.sp)
                    // When it drops comes first: on a narrow phone the driver's name is what gets cut.
                    Text(
                        listOfNotNull(clockOf(risk.arrivingAt)?.let { "Drops $it" }, risk.driverName).joinToString(" · "),
                        style = SType.caption,
                        color = Color.White.copy(alpha = 0.85f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                }
            }
            Text(
                "${risk.destinationAddress.substringBefore(',')} — would run ${risk.emptyReturnKm?.toInt() ?: "—"} km back empty",
                style = SType.title.copy(fontSize = 22.sp, lineHeight = 26.sp),
                color = Color.White,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
            StatusPill(
                if (matches > 0) "${plural(matches, "load")} match the way back" else "Watching for loads on the way back",
                background = Color.White.copy(alpha = 0.14f),
                ink = Color.White,
                dotColor = if (matches > 0) Color(0xFF4ADE80) else Color(0xFFF2952C),
                live = matches > 0,
                ring = Color.White.copy(alpha = 0.2f),
            )
        }
    }
}

@Composable
private fun RiskRow(risk: ReturnLoadsApi.EmptyRisk) {
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 20.dp)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        PlateChip(risk.truckRegistration, size = 12.sp)
        Text(
            "${risk.destinationAddress.substringBefore(',')} · ${risk.emptyReturnKm?.toInt() ?: "—"} km empty",
            style = SType.small,
            color = c.muted,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun LoadCard(load: ReturnLoadsApi.Opportunity, best: Boolean, modifier: Modifier = Modifier, onQuote: () -> Unit) {
    val c = Saarthi.colors
    val quoted = load.quoteId != null
    Column(
        modifier
            .fillMaxWidth()
            .card(radius = 24.dp, ring = if (best) c.successGlow else c.ring)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Pill(if (best) "Best fit · ${load.detourKm.toInt()} km detour" else "${load.detourKm.toInt()} km detour", if (best) c.successBg else c.sunken, if (best) c.success else c.muted)
            Box(Modifier.weight(1f))
            Text("Posted ${ago(load.createdAt)}${if (ago(load.createdAt) == "now") "" else " ago"}", style = SType.caption, color = c.subtle)
        }
        RouteStops(
            from = load.originAddress,
            fromNote = listOfNotNull(clockOf(load.pickupAt)?.let { "Pick up $it" }, "${load.distanceToPickupKm.toInt()} km from drop").joinToString(" · "),
            to = load.destinationAddress,
            toNote = clockOf(load.deliverBy)?.let { "Deliver by $it" },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Figure("Load", "${load.quantity.let { if (it % 1.0 == 0.0) it.toLong() else it }} ${RequirementsApi.unitWord(load.unit)}", Modifier.weight(1f))
            Figure("Goods", load.materialName, Modifier.weight(1f))
            Figure("Worth", load.estimatedRevenue?.let(::rupees) ?: "—", Modifier.weight(1f))
        }
        SaarthiButton(
            if (quoted) "Quote sent" else "Quote for this load",
            onClick = onQuote,
            enabled = !quoted,
            height = 52.dp,
        )
    }
}

@Composable
private fun Figure(label: String, value: String, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(c.sunken)
            .padding(12.dp),
    ) {
        Eyebrow(label, maxLines = 1)
        Text(value, style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A price for the matched load, sent as a quote on the customer's order. */
@Composable
private fun QuoteSheet(
    load: ReturnLoadsApi.Opportunity?,
    onDismiss: () -> Unit,
    onQuote: suspend (ReturnLoadsApi.Opportunity, Double, String?, (String?) -> Unit) -> Unit,
) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    var shown by remember { mutableStateOf(load) }
    if (load != null) shown = load
    var price by remember(load?.id) { mutableStateOf(load?.estimatedRevenue?.toLong()?.toString().orEmpty()) }
    var note by remember(load?.id) { mutableStateOf("") }
    var busy by remember(load?.id) { mutableStateOf(false) }
    var error by remember(load?.id) { mutableStateOf<String?>(null) }

    BottomSheet(visible = load != null, onDismiss = onDismiss) {
        val current = shown ?: return@BottomSheet
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Quote for ${current.materialName}", style = SType.sheetTitle, color = c.fg)
            Text(
                "${current.originAddress.substringBefore(',')} → ${current.destinationAddress.substringBefore(',')} on ${current.truckRegistration}'s way back.",
                style = SType.body,
                color = c.muted,
            )
            SaarthiField(
                value = price,
                onValueChange = { price = it.filter(Char::isDigit).take(8) },
                label = "Your price (₹)",
                leading = Lucide.receipt,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
            SaarthiField(value = note, onValueChange = { note = it.take(300) }, label = "A note (optional)", leading = Lucide.send)
            error?.let { RevealedNotice(it, NoticeTone.DANGER) }
            SaarthiButton(
                "Send quote",
                onClick = {
                    val amount = price.toDoubleOrNull() ?: return@SaarthiButton
                    busy = true
                    error = null
                    scope.launch {
                        onQuote(current, amount, note) { problem ->
                            busy = false
                            error = problem
                        }
                    }
                },
                enabled = (price.toDoubleOrNull() ?: 0.0) > 0,
                busy = busy,
            )
        }
    }
}
