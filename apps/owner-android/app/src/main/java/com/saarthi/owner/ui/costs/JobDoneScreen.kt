package com.saarthi.owner.ui.costs

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.ServicingApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.papers.SlipKind
import com.saarthi.owner.ui.papers.SlipStep
import com.saarthi.owner.ui.papers.rememberSlipReader
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * A booked job finished: what it came to, read off the workshop's final bill
 * (the estimate stands until one is read), and the job closed as done with it.
 */
@Composable
internal fun JobDoneScreen(app: OwnerApp, job: ServicingApi.Job, onDone: () -> Unit) {
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var cost by remember { mutableStateOf(job.cost?.typed().orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val bill = rememberSlipReader({ SlipText.bill(it) }, ReadBill(), onProblem = { problem = it }) { found ->
        problem = null
        found.total?.let { cost = it.typed() }
    }

    DetailScreen(
        eyebrow = formatPlate(job.registrationNumber).ifBlank { stringResource(R.string.costs_servicing) },
        title = job.title,
        footer = {
            problem?.let { NoticeCard(it, NoticeTone.DANGER) }
            SaarthiButton(
                stringResource(R.string.costs_service_mark_done),
                onClick = {
                    busy = true
                    problem = null
                    scope.launch {
                        try {
                            app.servicing.close(job.id, done = true, cost = cost.toDoubleOrNull())
                            onDone()
                            navigator.pop()
                        } catch (failure: Exception) {
                            if (failure is CancellationException) throw failure
                            problem = failure.readable()
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy && !bill.reading,
                busy = busy,
                busyText = stringResource(R.string.costs_saving),
            )
        },
    ) {
        SlipStep(bill, SlipKind.BILL, good = { it.total != null }, goodText = R.string.costs_service_read_good, noneText = R.string.costs_service_read_none)
        Hint(stringResource(R.string.costs_service_bill_hint))
        CompactField(cost, { cost = decimalOf(it) }, stringResource(R.string.costs_service_total), keyboardOptions = Decimal)
    }
}
