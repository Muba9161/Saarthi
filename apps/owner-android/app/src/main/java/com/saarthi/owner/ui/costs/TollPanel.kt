package com.saarthi.owner.ui.costs

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.Page
import com.saarthi.owner.network.TollApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.rememberPaged
import com.saarthi.owner.ui.common.MoreButton
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.FigureRow
import com.saarthi.owner.ui.common.FigureTile
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.ago
import com.saarthi.owner.ui.common.isNow
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.prettyDate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.tracking.attempt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

private class TollView(val summary: TollApi.Summary, val tags: List<TollApi.Tag>, val capabilities: TollApi.Capabilities?)

/**
 * Toll & FASTag: the toll spent over thirty days and where it went, each
 * FASTag with what its bank last said, and the plazas crossed.
 */
@Composable
internal fun TollPanel(app: OwnerApp, access: CostAccess, vehicle: VehiclesApi.Vehicle?) {
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var attempt by remember { mutableIntStateOf(0) }
    var changed by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Loadable<TollView>>(Loadable.Loading) }
    var finding by remember { mutableStateOf(false) }
    var findNote by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }
    LaunchedEffect(vehicle?.id, attempt, changed) {
        state = try {
            coroutineScope {
                val summary = async { app.toll.summary(vehicle?.id) }
                val tags = async { app.toll.tags(vehicle?.id) }
                val capabilities = async { if (access.bankLink) attempt { app.toll.capabilities() } else null }
                Loadable.Ready(TollView(summary.await(), tags.await(), capabilities.await()))
            }
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            Loadable.Failed(failure.readable())
        }
    }
    val crossings = rememberPaged<TollApi.Crossing, Page<TollApi.Crossing>>(
        key = "crossings-${vehicle?.id}-$changed",
        load = { page -> app.toll.crossings(vehicle?.id, page) },
        rowsOf = { it.items },
        hasMoreOf = { it.pagination.hasNextPage },
    )

    when (val shown = state) {
        Loadable.Loading -> SkeletonCards(count = 2)
        is Loadable.Failed -> FailedCard(shown.message, { attempt++ })
        is Loadable.Ready -> {
            val view = shown.value
            val attention = view.tags.count { it.needsAttention }
            FigureRow {
                FigureTile(stringResource(R.string.costs_toll_window, view.summary.windowDays), rupees(view.summary.total), "", Modifier.weight(1.2f))
                FigureTile(stringResource(R.string.costs_toll_per_crossing), view.summary.averagePerCrossing?.let(::rupees) ?: "—", "", Modifier.weight(1f))
                FigureTile(stringResource(R.string.costs_toll_need_a_look), attention.toString(), pluralStringResource(R.plurals.costs_toll_tags_unit, attention), Modifier.weight(1f))
            }

            GroupLabel(if (vehicle == null) stringResource(R.string.costs_toll_fastags) else "FASTag")
            if (view.tags.isEmpty()) Hint(stringResource(if (vehicle == null) R.string.costs_toll_none else R.string.costs_toll_none_vehicle))
            view.tags.forEach { tag ->
                CostRow(
                    title = listOfNotNull(formatPlate(tag.registrationNumber).takeIf { vehicle == null }, tag.issuerBank.ifBlank { null }).joinToString(" · "),
                    detail = listOfNotNull(tag.tagId?.ifBlank { null }, tag.balanceUpdatedAt?.let { if (isNow(it)) stringResource(R.string.costs_fastag_balance_now) else stringResource(R.string.costs_fastag_balance_from, ago(it)) }).joinToString(" · ").ifBlank { null },
                    trailing = tag.balance?.let(::rupees) ?: "—",
                    badge = tagHealthWord(tag)?.let { it to tag.needsAttention },
                    onClick = { navigator.push("fastag-${tag.id}") { FastagScreen(app, access, tag, onChanged = { changed++ }) } },
                )
            }
            // A vehicle with no tag on record: the bank link can look its plate up.
            val canFind = vehicle != null && view.tags.isEmpty() && access.manageToll && view.capabilities?.supportsLookup == true
            if (canFind) {
                SaarthiButton(
                    stringResource(R.string.costs_toll_find),
                    onClick = {
                        finding = true
                        findNote = null
                        scope.launch {
                            findNote = try {
                                val found = app.toll.discover(vehicle!!.id)
                                if (found?.found == true) {
                                    changed++
                                    (found.fastag?.issuerBank?.let { Words.get(R.string.costs_toll_found_with, it) } ?: Words.get(R.string.costs_toll_found)) to NoticeTone.SUCCESS
                                } else {
                                    (found?.reason ?: Words.get(R.string.costs_toll_not_found)) to NoticeTone.INFO
                                }
                            } catch (failure: Exception) {
                                if (failure is CancellationException) throw failure
                                failure.readable() to NoticeTone.DANGER
                            } finally {
                                finding = false
                            }
                        }
                    },
                    tone = ButtonTone.SECONDARY,
                    leading = Lucide.search,
                    busy = finding,
                    busyText = stringResource(R.string.costs_asking_bank),
                    height = 48.dp,
                )
            }
            findNote?.let { (text, tone) -> NoticeCard(text, tone) }

            if (view.summary.topPlazas.isNotEmpty()) {
                GroupLabel(stringResource(R.string.costs_toll_where_money_goes))
                view.summary.topPlazas.forEach { plaza ->
                    CostRow(title = plaza.plazaName, detail = pluralStringResource(R.plurals.costs_toll_crossings, plaza.crossings, plaza.crossings), trailing = rupees(plaza.total))
                }
            }
        }
    }

    GroupLabel(stringResource(R.string.costs_toll_crossings_title))
    when (val first = crossings.first) {
        Loadable.Loading -> SkeletonCards(count = 1)
        is Loadable.Failed -> FailedCard(first.message, crossings.retry)
        is Loadable.Ready -> {
            if (crossings.rows.isEmpty()) Hint(stringResource(R.string.costs_toll_crossings_none))
            crossings.rows.forEach { crossing ->
                CostRow(
                    title = crossing.plazaName,
                    detail = listOfNotNull(
                        formatPlate(crossing.registrationNumber).takeIf { vehicle == null && crossing.registrationNumber.isNotBlank() },
                        TollApi.modeWord(crossing.paymentMode),
                        prettyDate(crossing.crossedAt),
                    ).joinToString(" · "),
                    trailing = rupees(crossing.amount),
                )
            }
            if (crossings.hasMore) MoreButton(crossings.loadingMore, crossings.more)
        }
    }
}

/** How a tag stands, when it is worth saying: low, blocked, running out, or not known. */
internal fun tagHealthWord(tag: TollApi.Tag): String? = when (tag.health.health) {
    "LOW_BALANCE" -> Words.get(R.string.costs_tag_low_balance)
    "BLOCKED" -> Words.get(R.string.costs_tag_blocked)
    "EXPIRING" -> Words.get(R.string.costs_tag_expiring)
    "UNKNOWN" -> if (tag.balance == null) Words.get(R.string.costs_fastag_balance_unknown) else null
    else -> if (tag.status != "ACTIVE" && tag.status.isNotBlank()) tag.status.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() } else null
}
