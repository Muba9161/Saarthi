package com.saarthi.owner.ui.costs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable

/** The way to Running costs, naming the tabs this person may open. */
@Composable
fun RunningCostsCard(access: CostAccess, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    if (access.tabs.isEmpty()) return
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .pressable(scale = 0.99f, label = stringResource(R.string.costs_card_open), onClick = onOpen)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(Lucide.calculator, well = c.accentSoft, ink = c.accent, size = 40.dp, radius = 12.dp, iconSize = 18.dp)
        Column(Modifier.weight(1f)) {
            Eyebrow(stringResource(R.string.costs_running_costs))
            Text(access.tabs.joinToString(" · ") { it.label }, style = SType.rowTitle, color = c.fg)
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}
