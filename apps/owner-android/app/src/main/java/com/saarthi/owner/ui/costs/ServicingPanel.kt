package com.saarthi.owner.ui.costs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.Page
import com.saarthi.owner.network.ServicingApi
import com.saarthi.owner.network.VehiclesApi
import com.saarthi.owner.ui.common.rememberPaged
import com.saarthi.owner.ui.common.MoreButton
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.FigureRow
import com.saarthi.owner.ui.common.FigureTile
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.km
import com.saarthi.owner.ui.common.prettyDate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * Servicing: for one vehicle, how it stands and what its upkeep has cost, the
 * work booked and the work done; for the fleet, the vehicles worth a look, the
 * work booked, and the work done lately.
 */
@Composable
internal fun ServicingPanel(app: OwnerApp, access: CostAccess, vehicle: VehiclesApi.Vehicle?, changed: Int, onChanged: () -> Unit) {
    val navigator = LocalNavigator.current
    if (access.manageServicing) {
        SaarthiButton(
            stringResource(R.string.costs_log_servicing),
            onClick = { navigator.push("service-log-${vehicle?.id}") { ServiceLogScreen(app, vehicle, onSaved = onChanged) } },
            tone = ButtonTone.SECONDARY,
            leading = Lucide.wrench,
            height = 48.dp,
        )
    }
    if (vehicle != null) VehicleServicing(app, access, vehicle, changed, onChanged) else FleetServicing(app, access, changed, onChanged)
}

private class VehicleUpkeep(val timeline: ServicingApi.Timeline?, val booked: List<ServicingApi.Job>)

@Composable
private fun VehicleServicing(app: OwnerApp, access: CostAccess, vehicle: VehiclesApi.Vehicle, changed: Int, onChanged: () -> Unit) {
    val c = Saarthi.colors
    var attempt by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Loadable<VehicleUpkeep>>(Loadable.Loading) }
    LaunchedEffect(vehicle.id, changed, attempt) {
        state = try {
            coroutineScope {
                val timeline = async { app.servicing.timeline(vehicle.id) }
                val booked = async { app.servicing.jobs(vehicle.id, open = true).items }
                Loadable.Ready(VehicleUpkeep(timeline.await(), booked.await()))
            }
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            Loadable.Failed(failure.readable())
        }
    }
    when (val shown = state) {
        Loadable.Loading -> SkeletonCards(count = 2)
        is Loadable.Failed -> FailedCard(shown.message, { attempt++ })
        is Loadable.Ready -> {
            val timeline = shown.value.timeline
            timeline?.let { HealthCard(it) }
            BookedJobs(app, access, shown.value.booked, showPlate = false, onChanged = onChanged)
            GroupLabel(stringResource(R.string.costs_service_work_done))
            val records = timeline?.records.orEmpty()
            if (records.isEmpty()) Hint(stringResource(R.string.costs_service_none))
            records.forEach { RecordRow(it, showPlate = false) }
            if (timeline == null) Text(stringResource(R.string.costs_service_history_unreadable), style = SType.small, color = c.muted)
        }
    }
}

@Composable
private fun FleetServicing(app: OwnerApp, access: CostAccess, changed: Int, onChanged: () -> Unit) {
    var attempt by remember { mutableIntStateOf(0) }
    var top by remember { mutableStateOf<Loadable<Pair<List<ServicingApi.Risk>, List<ServicingApi.Job>>>>(Loadable.Loading) }
    LaunchedEffect(changed, attempt) {
        top = try {
            coroutineScope {
                val risks = async { app.servicing.risks().filter { it.level == "HIGH" || it.level == "MEDIUM" } }
                val booked = async { app.servicing.jobs(null, open = true).items }
                Loadable.Ready(risks.await() to booked.await())
            }
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            Loadable.Failed(failure.readable())
        }
    }
    val done = rememberPaged<ServicingApi.Record, Page<ServicingApi.Record>>(
        key = "service-done-$changed",
        load = { page -> app.servicing.records(null, page) },
        rowsOf = { it.items },
        hasMoreOf = { it.pagination.hasNextPage },
    )

    when (val shown = top) {
        Loadable.Loading -> SkeletonCards(count = 2)
        is Loadable.Failed -> FailedCard(shown.message, { attempt++ })
        is Loadable.Ready -> {
            val (risks, booked) = shown.value
            if (risks.isNotEmpty()) {
                GroupLabel(stringResource(R.string.costs_service_worth_a_look))
                risks.forEach { risk ->
                    CostRow(
                        title = formatPlate(risk.registrationNumber),
                        detail = risk.reasons.joinToString(" · ").ifBlank { null },
                        trailing = null,
                        badge = stringResource(if (risk.level == "HIGH") R.string.costs_service_needs else R.string.costs_service_soon) to (risk.level == "HIGH"),
                    )
                }
            }
            BookedJobs(app, access, booked, showPlate = true, onChanged = onChanged)
        }
    }
    GroupLabel(stringResource(R.string.costs_service_work_done))
    when (val first = done.first) {
        Loadable.Loading -> SkeletonCards(count = 1)
        is Loadable.Failed -> FailedCard(first.message, done.retry)
        is Loadable.Ready -> {
            if (done.rows.isEmpty()) Hint(stringResource(R.string.costs_service_none))
            done.rows.forEach { RecordRow(it, showPlate = true) }
            if (done.hasMore) MoreButton(done.loadingMore, done.more)
        }
    }
}

/** How the vehicle stands, as the web's service timeline says it, and what its upkeep has cost. */
@Composable
private fun HealthCard(timeline: ServicingApi.Timeline) {
    val c = Saarthi.colors
    val warn = timeline.health.health == "Service overdue" || timeline.health.health == "Service due"
    Column(
        Modifier.fillMaxWidth().card(radius = 22.dp, ring = if (warn) c.warningRing else c.ring).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(timeline.health.health.ifBlank { stringResource(R.string.costs_service_history) }, style = SType.bodyStrong, color = c.fg, modifier = Modifier.weight(1f))
            prettyDate(timeline.nextDueAt)?.let { StatusPill(stringResource(R.string.costs_service_due, it), background = if (warn) c.warningBg else c.sunken, ink = if (warn) c.warning else c.muted, dot = false) }
        }
        timeline.health.reasons.takeIf { it.isNotEmpty() }?.let {
            Text(it.joinToString(" · "), style = SType.caption, color = c.muted, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
        FigureRow {
            FigureTile(stringResource(R.string.costs_service_spent), rupees(timeline.spend.total), "", Modifier.weight(1.2f))
            FigureTile(stringResource(R.string.costs_service_parts), rupees(timeline.spend.parts), "", Modifier.weight(1f))
            FigureTile(stringResource(R.string.costs_service_labour), rupees(timeline.spend.labour), "", Modifier.weight(1f))
        }
        timeline.spend.costPerKm?.let { Text(stringResource(R.string.costs_service_cost_per_km, it), style = SType.caption, color = c.subtle) }
    }
}

/** Work booked ahead, each with the way to mark it done or call it off. */
@Composable
private fun BookedJobs(app: OwnerApp, access: CostAccess, jobs: List<ServicingApi.Job>, showPlate: Boolean, onChanged: () -> Unit) {
    if (jobs.isEmpty()) return
    GroupLabel(stringResource(R.string.costs_service_booked))
    jobs.forEach { job -> JobRow(app, access, job, showPlate, onChanged) }
}

@Composable
private fun JobRow(app: OwnerApp, access: CostAccess, job: ServicingApi.Job, showPlate: Boolean, onChanged: () -> Unit) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var busy by remember(job.id) { mutableStateOf(false) }
    var problem by remember(job.id) { mutableStateOf<String?>(null) }
    fun callOff() {
        busy = true
        problem = null
        scope.launch {
            try {
                app.servicing.close(job.id, done = false)
                onChanged()
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                problem = failure.readable()
            } finally {
                busy = false
            }
        }
    }
    Column(Modifier.fillMaxWidth().card(radius = 18.dp, ring = if (job.overdue) c.warningRing else c.ring).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(job.title, style = SType.bodyStrong, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            job.cost?.let { Text(rupees(it), style = SType.bodyStrong, color = c.fg) }
        }
        Text(
            listOfNotNull(
                formatPlate(job.registrationNumber).takeIf { showPlate && job.registrationNumber.isNotBlank() },
                ServicingApi.typeWord(job.type),
                job.serviceProvider,
                prettyDate(job.scheduledAt)?.let { stringResource(if (job.overdue) R.string.costs_was_due else R.string.costs_service_for, it) },
            ).joinToString(" · "),
            style = SType.caption,
            color = if (job.overdue) c.warning else c.muted,
        )
        if (access.manageServicing) {
            Row(horizontalArrangement = Arrangement.spacedBy(18.dp), modifier = Modifier.padding(top = 2.dp)) {
                // Done goes by way of the final bill, so the job closes with what it really cost.
                LinkButton(
                    stringResource(R.string.costs_service_mark_done),
                    onClick = { navigator.push("job-done-${job.id}") { JobDoneScreen(app, job, onDone = onChanged) } },
                    enabled = !busy,
                    style = SType.smallStrong,
                )
                LinkButton(stringResource(R.string.costs_service_call_off), onClick = ::callOff, enabled = !busy, color = c.danger, style = SType.smallStrong)
            }
        }
        problem?.let { NoticeCard(it, NoticeTone.DANGER) }
    }
}

@Composable
private fun RecordRow(record: ServicingApi.Record, showPlate: Boolean) {
    CostRow(
        title = record.title,
        detail = listOfNotNull(
            formatPlate(record.registrationNumber).takeIf { showPlate && record.registrationNumber.isNotBlank() },
            ServicingApi.typeWord(record.type),
            record.workshopName,
            km(record.odometerKm),
            prettyDate(record.serviceDate ?: record.completedAt),
        ).joinToString(" · ").ifBlank { null },
        trailing = record.totalCost?.let(::rupees),
    )
}
