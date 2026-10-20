package com.saarthi.owner.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card

/** Figure tiles side by side, all as tall as the tallest, so the numbers line up when a label takes two lines. */
@Composable
fun FigureRow(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp), content = content)
}

/** One figure in a small card: what it is, the number, and its unit beside it. */
@Composable
fun FigureTile(label: String, value: String, unit: String, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(
        modifier
            .fillMaxHeight()
            .card(radius = 18.dp)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Eyebrow(label, maxLines = 2)
        Spacer(Modifier.weight(1f))
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(value, style = SType.headerTitle.copy(fontSize = 18.sp), color = c.fg, maxLines = 1)
            // A unit is never broken across lines ("k" over "m").
            if (unit.isNotEmpty()) Text(unit, style = SType.caption, color = c.muted, maxLines = 1, softWrap = false, modifier = Modifier.padding(bottom = 2.dp))
        }
    }
}
