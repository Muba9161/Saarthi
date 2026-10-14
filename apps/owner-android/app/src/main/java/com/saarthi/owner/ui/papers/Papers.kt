package com.saarthi.owner.ui.papers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.jobs.Pill

/** The order papers are listed in: the next to run out first, the ones with no date last. */
private fun List<PapersApi.Paper>.soonestFirst(): List<PapersApi.Paper> =
    sortedWith(compareByDescending<PapersApi.Paper> { it.rejected }.thenBy { it.daysRemaining ?: Int.MAX_VALUE })

/**
 * One vehicle's papers — opened from its Papers card. The numbers are shown
 * masked; the papers themselves stay in the web folders.
 */
@Composable
fun VehiclePapersScreen(app: OwnerApp, vehicle: VehiclesApi.Vehicle) {
    val c = Saarthi.colors
    var state by remember { mutableStateOf<Loadable<List<PapersApi.Paper>>>(Loadable.Loading) }

    LaunchedEffect(vehicle.id) {
        state = try {
            Loadable.Ready(app.papers.forVehicle(vehicle.id).soonestFirst())
        } catch (failure: Exception) {
            Loadable.Failed(failure.readable())
        }
    }

    DetailScreen(eyebrow = formatPlate(vehicle.registrationNumber), title = "Papers") {
        when (val shown = state) {
            Loadable.Loading -> SkeletonCards()
            is Loadable.Failed -> NoticeCard(shown.message, NoticeTone.WARNING)
            is Loadable.Ready -> {
                if (shown.value.isEmpty()) {
                    Text("No papers on file yet. Add them from Saarthi on the web.", style = SType.small, color = c.muted)
                }
                shown.value.forEachIndexed { index, paper ->
                    PaperRow(paper, plate = null, modifier = Modifier.rise(stagger(index.coerceAtMost(6))))
                }
                if (shown.value.isNotEmpty()) {
                    Text("Numbers are hidden here. The papers themselves are in Saarthi on the web.", style = SType.caption, color = c.subtle)
                }
            }
        }
    }
}

/** A paper's state, in the words and colours its row shows. */
private data class PaperTone(val well: Color, val ink: Color, val words: String, val alarm: Boolean)

@Composable
private fun PapersApi.Paper.tone(): PaperTone {
    val c = Saarthi.colors
    return when {
        rejected -> PaperTone(c.dangerSoft, c.danger, "Rejected · upload again", alarm = true)
        expired -> PaperTone(c.dangerSoft, c.danger, "Expired", alarm = true)
        dueSoon -> PaperTone(c.warningSoft, c.warning, "$daysRemaining days left", alarm = true)
        pending -> PaperTone(c.infoSoft, c.info, "Being checked", alarm = false)
        daysRemaining != null -> PaperTone(c.successSoft, c.success, "Valid · $daysRemaining days", alarm = false)
        else -> PaperTone(c.successSoft, c.success, "On file", alarm = false)
    }
}

/** One paper: what it is, its masked number, and how long it has left. [plate] is shown when the list mixes vehicles. */
@Composable
fun PaperRow(paper: PapersApi.Paper, plate: String?, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val tone = paper.tone()
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 22.dp, ring = if (paper.expired || paper.rejected) c.dangerRing else c.ring)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(Lucide.fileText, well = tone.well, ink = tone.ink, size = 44.dp, radius = 14.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(paper.documentTypeLabel, style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            listOfNotNull(plate?.let(::formatPlate), paper.maskedNumber).takeIf { it.isNotEmpty() }?.let { parts ->
                Text(parts.joinToString(" · "), style = SType.caption, color = c.muted, maxLines = 1)
            }
            Pill(tone.words, tone.well, tone.ink)
        }
        IconWell(
            if (tone.alarm) Lucide.alertTriangle else Lucide.check,
            well = tone.well,
            ink = tone.ink,
            size = 34.dp,
            shape = CircleShape,
            iconSize = 16.dp,
        )
    }
}
