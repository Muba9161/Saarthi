package com.saarthi.driver.ui.shift.papers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.SaarthiDriverApp
import com.saarthi.driver.ui.design.Hint
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.shift.headerClearance
import com.saarthi.driver.ui.shift.tabBarClearance
import kotlinx.coroutines.delay

/**
 * How long an empty list is treated as "still loading".
 *
 * `loadPapers` says when it fails but not when it succeeds, and an empty
 * answer leaves the list as it was — so an empty list with no problem cannot
 * say by itself whether it is empty or not yet here. A list that arrives
 * sooner replaces the skeleton at once.
 */
private const val FIRST_ANSWER_GRACE_MS = 2_000L

/** The last paper the driver asked to open, and what came of it. */
private data class OpenedPaper(val id: String, val title: String, val pdf: Boolean, val result: PaperOpening)

/**
 * Papers — every document a checkpoint might ask for, held on this phone.
 *
 * The list is refreshed when the tab appears, and the cockpit saves each paper
 * to the phone on the way past; opening one only ever reads that saved copy,
 * because the places an officer asks for a permit are the places with no
 * signal. Which papers are saved is watched live, so a row's tick appears the
 * moment its download lands rather than on the next visit.
 */
@Composable
fun PapersTab(cockpit: TerminalViewModel) {
    val context = LocalContext.current
    val cache = remember(context) { (context.applicationContext as SaarthiDriverApp).papers }
    val papers by cockpit.papers.collectAsState()
    val problem by cockpit.papersProblem.collectAsState()
    val onPhone by cache.cached.collectAsState()
    var filter by rememberSaveable { mutableStateOf(PaperFilter.ALL) }
    var opened by remember { mutableStateOf<OpenedPaper?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var settled by remember { mutableStateOf(false) }

    LaunchedEffect(attempt) {
        settled = false
        cockpit.loadPapers()
        delay(FIRST_ANSWER_GRACE_MS)
        settled = true
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = headerClearance(), bottom = tabBarClearance()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val c = Saarthi.colors
        val loadProblem = problem
        Text(
            stringResource(R.string.papers_lead),
            style = SType.lead,
            color = c.muted,
            modifier = Modifier.rise(distance = PapersRise),
        )

        val attention = papers.count { it.expiry.needsAttention }
        if (attention > 0) {
            AttentionBanner(
                count = attention,
                anyExpired = papers.any { it.expiry == Expiry.EXPIRED },
                modifier = Modifier.rise(60, PapersRise),
            )
        }

        when {
            papers.isNotEmpty() -> {
                PaperChips(
                    papers,
                    filter,
                    onFilter = { filter = it },
                    modifier = Modifier
                        .padding(top = 4.dp)
                        .rise(100, PapersRise),
                )
                val shown = papers.filter(filter::admits)
                if (shown.isEmpty()) {
                    Hint(
                        stringResource(if (filter == PaperFilter.VEHICLE) R.string.papers_none_vehicle else R.string.papers_none_yours),
                        Modifier.rise(140, PapersRise),
                    )
                }
                shown.forEachIndexed { index, paper ->
                    key(paper.id) {
                        PaperRow(
                            paper,
                            onPhone = paper.id in onPhone,
                            onOpen = {
                                val result = openPaper(context, cache, paper)
                                // Asking again is what fetches a paper the last pass could not save.
                                if (result == PaperOpening.NOT_ON_PHONE) cockpit.loadPapers()
                                opened = OpenedPaper(paper.id, paper.displayTitle, paper.isPdf, result)
                            },
                            // Staggered as the design does, but only down the first screenful.
                            modifier = Modifier.rise(140 + minOf(index, 8) * 60, PapersRise),
                        )
                    }
                }
            }
            loadProblem != null -> PapersStateCard(
                Lucide.alertTriangle,
                well = c.dangerSoft,
                ink = c.danger,
                title = stringResource(R.string.papers_error_title),
                body = loadProblem,
                modifier = Modifier.rise(distance = PapersRise),
                onRetry = { attempt += 1 },
            )
            !settled -> PapersSkeleton()
            else -> PapersStateCard(
                Lucide.fileText,
                well = c.primarySoft,
                ink = c.primary,
                title = stringResource(R.string.papers_empty_title),
                body = stringResource(R.string.papers_empty_body),
                modifier = Modifier.rise(distance = PapersRise),
            )
        }

        if (loadProblem != null && papers.isNotEmpty()) {
            PaperNotice(loadProblem, Modifier.rise(distance = PapersRise))
        }
        // A "not on this phone" note is withdrawn once that paper has landed.
        opened?.takeUnless { it.result == PaperOpening.NOT_ON_PHONE && it.id in onPhone }?.let { last ->
            key(last) { PaperNotice(openedWords(last), Modifier.rise(distance = PapersRise)) }
        }
    }
}

@Composable
private fun openedWords(opened: OpenedPaper): String = when (opened.result) {
    PaperOpening.OPENED -> stringResource(
        if (opened.pdf) R.string.papers_opening_pdf else R.string.papers_opening,
        opened.title,
    )
    PaperOpening.NOT_ON_PHONE -> stringResource(R.string.papers_not_saved)
    PaperOpening.NO_VIEWER -> stringResource(R.string.papers_no_viewer)
}
