package com.saarthi.owner.ui.common

import android.app.DatePickerDialog
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import java.time.LocalDate
import java.time.format.DateTimeFormatter

// Made on each use, so the month and day names follow the app\'s language when it changes.
private val DayLabel: DateTimeFormatter get() = DateTimeFormatter.ofPattern("EEE d MMM yyyy")

/** A day from the phone's calendar, between [earliest] and [latest] when they are set. */
@Composable
fun DayField(label: String, day: LocalDate?, onPick: (LocalDate) -> Unit, latest: LocalDate? = null, earliest: LocalDate? = null) {
    val c = Saarthi.colors
    val context = LocalContext.current
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 14.dp, color = c.elevated, ring = c.input, elevated = false)
            .pressable(scale = 0.99f, label = label) {
                val shown = day ?: LocalDate.now()
                DatePickerDialog(context, { _, y, m, d -> onPick(LocalDate.of(y, m + 1, d)) }, shown.year, shown.monthValue - 1, shown.dayOfMonth).apply {
                    latest?.let { datePicker.maxDate = it.toEpochDay() * DAY_MS + DAY_MS - 1 }
                    earliest?.let { datePicker.minDate = it.toEpochDay() * DAY_MS }
                }.show()
            }
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        LineIcon(Lucide.calendar, size = 18.dp, color = c.primary)
        Text(label, style = SType.small, color = c.muted, modifier = Modifier.weight(1f))
        Text(day?.let(DayLabel::format) ?: stringResource(R.string.ui_day_choose), style = SType.smallStrong, color = if (day == null) c.subtle else c.fg)
    }
}

private const val DAY_MS = 86_400_000L
