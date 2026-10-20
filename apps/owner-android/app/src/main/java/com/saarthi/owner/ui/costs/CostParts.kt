package com.saarthi.owner.ui.costs

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable

internal val Decimal = KeyboardOptions(keyboardType = KeyboardType.Decimal)
internal val Whole = KeyboardOptions(keyboardType = KeyboardType.Number)

/** Typed money or litres: digits and one point, kept short. */
internal fun decimalOf(typed: String, max: Int = 10): String {
    val kept = typed.filter { it.isDigit() || it == '.' }
    val first = kept.indexOf('.')
    return (if (first < 0) kept else kept.substring(0, first + 1) + kept.substring(first + 1).replace(".", "")).take(max)
}

/** A number the form shows again: no ".0" on a whole one. */
internal fun Double.typed(): String = if (this % 1.0 == 0.0) toLong().toString() else toString()

/** One entry in a cost list: what, the details under it, the amount beside it, and how it stands. */
@Composable
internal fun CostRow(
    title: String,
    detail: String?,
    trailing: String?,
    modifier: Modifier = Modifier,
    badge: Pair<String, Boolean>? = null,
    onClick: (() -> Unit)? = null,
) {
    val c = Saarthi.colors
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 18.dp)
            .then(if (onClick != null) Modifier.pressable(scale = 0.99f, label = title, onClick = onClick) else Modifier)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = SType.bodyStrong, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
            detail?.let { Text(it, style = SType.caption, color = c.muted, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            badge?.let { (word, warn) ->
                StatusPill(word, background = if (warn) c.warningBg else c.sunken, ink = if (warn) c.warning else c.muted, dot = false)
            }
        }
        trailing?.let { Text(it, style = SType.bodyStrong, color = c.fg) }
    }
}

/** The vehicle an entry is for, by its plate. */
@Composable
internal fun VehiclePicker(vehicles: List<VehiclesApi.Vehicle>, selectedId: String?, onPick: (VehiclesApi.Vehicle) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        vehicles.forEach { vehicle ->
            ChoiceChip(formatPlate(vehicle.registrationNumber), selected = vehicle.id == selectedId, onClick = { onPick(vehicle) })
        }
    }
}
