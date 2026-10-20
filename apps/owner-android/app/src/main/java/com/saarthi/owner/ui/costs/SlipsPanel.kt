package com.saarthi.owner.ui.costs

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.FuelApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.rememberPaged
import com.saarthi.owner.ui.common.MoreButton
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.prettyDate
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.tracking.attempt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The slips drivers file from the cab — tolls paid in cash, parking, repairs,
 * food, loading, challans: the total, where it went, and each slip with its photo.
 */
@Composable
internal fun SlipsPanel(app: OwnerApp, access: CostAccess, vehicle: VehiclesApi.Vehicle?, changed: Int, onChanged: () -> Unit) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    val paged = rememberPaged<FuelApi.Slip, FuelApi.SlipPage>(
        key = "slips-${vehicle?.id}-$category-$changed",
        load = { page -> app.fuel.slips(vehicle?.id, category, page) },
        rowsOf = { it.items },
        hasMoreOf = { it.pagination.hasNextPage },
    )

    // The office files one a driver handed in on paper, as the driver would from the cab.
    if (access.logFuel) {
        SaarthiButton(
            stringResource(R.string.costs_file_slip),
            onClick = { navigator.push("slip-log-${vehicle?.id}") { SlipLogScreen(app, vehicle, onSaved = onChanged) } },
            tone = ButtonTone.SECONDARY,
            leading = Lucide.receipt,
            height = 48.dp,
        )
    }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ChoiceChip(stringResource(R.string.costs_slips_all), selected = category == null, onClick = { category = null }, height = 36.dp)
        FuelApi.SLIP_CATEGORIES.forEach { (value, label) -> ChoiceChip(label, selected = category == value, onClick = { category = value }, height = 36.dp) }
    }
    when (val first = paged.first) {
        Loadable.Loading -> SkeletonCards(count = 2)
        is Loadable.Failed -> FailedCard(first.message, paged.retry)
        is Loadable.Ready -> {
            val totals = first.value.totals
            SpendCard(totals, showBreakdown = category == null)
            if (paged.rows.isEmpty()) Hint(stringResource(if (category == null) R.string.costs_slips_none else R.string.costs_slips_none_kind))
            paged.rows.forEach { slip ->
                SlipRow(app, slip, showPlate = vehicle == null) {
                    navigator.push("slip-${slip.id}") { SlipScreen(app, slip) }
                }
            }
            if (paged.hasMore) MoreButton(paged.loadingMore, paged.more)
        }
    }
}

/** What was spent, and — over every kind — where it went, largest first. */
@Composable
private fun SpendCard(totals: FuelApi.SlipTotals, showBreakdown: Boolean) {
    val c = Saarthi.colors
    Column(Modifier.fillMaxWidth().card(radius = 22.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Eyebrow(stringResource(R.string.costs_slips_spent))
        Text(rupees(totals.amount), style = SType.headerTitle, color = c.fg)
        if (showBreakdown) {
            val largest = totals.byCategory.values.maxOrNull() ?: 0.0
            totals.byCategory.entries.sortedByDescending { it.value }.forEach { (kind, amount) ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row {
                        Text(FuelApi.categoryWord(kind), style = SType.small, color = c.muted, modifier = Modifier.weight(1f))
                        Text(rupees(amount), style = SType.smallStrong, color = c.fg)
                    }
                    Box(Modifier.fillMaxWidth().height(5.dp).clip(CircleShape).background(c.track)) {
                        Box(Modifier.fillMaxWidth((amount / largest).toFloat().coerceIn(0.02f, 1f)).height(5.dp).clip(CircleShape).background(c.primary))
                    }
                }
            }
        }
    }
}

@Composable
private fun SlipRow(app: OwnerApp, slip: FuelApi.Slip, showPlate: Boolean, onOpen: () -> Unit) {
    val c = Saarthi.colors
    Row(
        Modifier.fillMaxWidth().card(radius = 18.dp).pressable(scale = 0.99f, label = stringResource(R.string.costs_slips_open), onClick = onOpen).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SlipPhoto(app, slip.photoId, thumbnail = true, size = 48.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(FuelApi.categoryWord(slip.category), style = SType.bodyStrong, color = c.fg)
            Text(
                listOfNotNull(
                    formatPlate(slip.registrationNumber).takeIf { showPlate && slip.registrationNumber.isNotBlank() },
                    slip.vendorName,
                    slip.driverName,
                    prettyDate(slip.recordedAt),
                ).joinToString(" · "),
                style = SType.caption,
                color = c.muted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(rupees(slip.amount), style = SType.bodyStrong, color = c.fg)
    }
}

/** One slip: its photo as large as the screen allows, and what was filed with it. */
@Composable
private fun SlipScreen(app: OwnerApp, slip: FuelApi.Slip) {
    val c = Saarthi.colors
    DetailScreen(eyebrow = formatPlate(slip.registrationNumber), title = FuelApi.categoryWord(slip.category)) {
        SlipPhoto(app, slip.photoId, thumbnail = false, size = null)
        CostRow(
            title = rupees(slip.amount),
            detail = listOfNotNull(slip.vendorName, slip.driverName, prettyDate(slip.recordedAt)).joinToString(" · ").ifBlank { null },
            trailing = null,
        )
        Text(slip.tripReference?.let { stringResource(R.string.costs_slip_filed_against, it) } ?: stringResource(R.string.costs_slip_filed_between), style = SType.small, color = c.muted)
        slip.notes?.ifBlank { null }?.let { Text(it, style = SType.body, color = c.fg) }
    }
}

/** A slip's photo: a square thumbnail when [size] is set, else the whole photo across the width. */
@Composable
private fun SlipPhoto(app: OwnerApp, photoId: String?, thumbnail: Boolean, size: Dp?) {
    val c = Saarthi.colors
    val bitmap by produceState<ImageBitmap?>(null, photoId, thumbnail) {
        value = photoId?.let { id ->
            attempt { app.fuel.slipPhoto(id, thumbnail) }?.let { bytes ->
                withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() }
            }
        }
    }
    val shape = RoundedCornerShape(if (size != null) 12.dp else 20.dp)
    val shown = bitmap
    val frame = if (size != null) Modifier.size(size) else Modifier.fillMaxWidth().heightIn(min = 200.dp)
    if (shown == null) {
        Box(frame.clip(shape).background(c.sunken), contentAlignment = Alignment.Center) {
            IconWell(Lucide.receipt, well = c.sunken, ink = c.muted, size = 32.dp, radius = 10.dp)
        }
    } else {
        Image(
            shown,
            contentDescription = stringResource(R.string.costs_slip_photo_description),
            contentScale = if (size != null) ContentScale.Crop else ContentScale.FillWidth,
            modifier = frame.clip(shape),
        )
    }
}
