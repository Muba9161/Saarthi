package com.saarthi.driver.ui.shift.expense

import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.core.telemetry.Metric
import com.saarthi.core.telemetry.TelemetrySnapshot
import com.saarthi.core.ui.LocalReducedMotion
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.shift.flow.FlowPanel
import com.saarthi.driver.ui.shift.flow.FlowTopBar
import kotlin.math.roundToLong

/**
 * Any slip a driver pays on the road, photographed and filed: photo, details,
 * saved. Fuel, a toll paid in cash, parking, a repair, a meal, loading charges,
 * a challan — one flow for all of them, so no paper is kept.
 *
 * The photograph comes first because it is the evidence for the figures — the
 * server refuses a slip without one — and a failed save keeps both the photo
 * and what was typed, so a driver on a patchy connection only ever presses Save
 * again. [onSaved] is the Saved step's Done; Add another stays in the flow for
 * a second slip, and the back gesture simply closes.
 */
@Composable
fun ExpenseSlipFlow(
    visible: Boolean,
    cockpit: TerminalViewModel,
    onClose: () -> Unit,
    onSaved: () -> Unit,
) {
    FlowPanel(visible, onBack = onClose) {
        ExpenseSlipContent(cockpit, onClose, onSaved)
    }
}

private enum class SlipStep { PHOTO, DETAILS, SAVED }

/**
 * The odometer to start a fuel slip with: the vehicle's reading when it reports
 * one, whole kilometres. A simulator's figure is left out — it would be filed
 * against a real vehicle as if the dash had said it.
 */
private fun odometerFrom(telemetry: TelemetrySnapshot): String =
    telemetry.takeUnless { it.isSimulated(Metric.ODOMETER) }
        ?.value(Metric.ODOMETER)
        ?.roundToLong()
        ?.toString()
        .orEmpty()

@Composable
private fun ColumnScope.ExpenseSlipContent(
    cockpit: TerminalViewModel,
    onClose: () -> Unit,
    onSaved: () -> Unit,
) {
    val slips: ExpenseSlipViewModel = viewModel()
    val state by cockpit.uiState.collectAsState()
    val draft = remember { ExpenseSlipDraft() }
    var step by remember { mutableStateOf(SlipStep.PHOTO) }
    var saving by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }

    // A slip on its way is not abandoned by a stray back swipe.
    BackHandler(enabled = saving) {}

    Column(
        Modifier
            .weight(1f)
            .padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        FlowTopBar(
            title = stringResource(R.string.expense_title),
            plate = state.registration,
            onBack = { if (!saving) onClose() },
        )
        SlipStepper(step.ordinal)

        val stepModifier = Modifier
            .weight(1f)
            .fillMaxWidth()
            .stepIn()
        when (step) {
            SlipStep.PHOTO -> SlipCameraStep(
                onShot = { jpeg, photo ->
                    draft.jpeg = jpeg
                    draft.photo = photo
                    if (draft.odometer.isEmpty()) draft.odometer = odometerFrom(state.telemetry)
                    problem = null
                    step = SlipStep.DETAILS
                },
                modifier = stepModifier,
            )
            SlipStep.DETAILS -> SlipDetailsStep(
                draft = draft,
                saving = saving,
                problem = problem,
                onRetake = { step = SlipStep.PHOTO },
                onSave = save@{
                    if (saving || !draft.complete) return@save
                    saving = true
                    problem = null
                    slips.save(draft) { refusal ->
                        saving = false
                        if (refusal == null) step = SlipStep.SAVED else problem = refusal
                    }
                },
                modifier = stepModifier,
            )
            SlipStep.SAVED -> SlipSavedStep(
                onAnother = {
                    draft.clear()
                    step = SlipStep.PHOTO
                },
                onDone = onSaved,
                modifier = stepModifier,
            )
        }
    }
}

/**
 * Each step arrives from 40 to the right and fades in.
 *
 * Applied to a step's own root, so every change of step — forward, or back for
 * a retake — plays it afresh.
 */
private fun Modifier.stepIn(): Modifier = composed {
    val reduced = LocalReducedMotion.current
    val progress = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) { if (!reduced) progress.animateTo(1f, tween(550, easing = Ease.out)) }
    val travel = with(LocalDensity.current) { 40.dp.toPx() }
    graphicsLayer {
        alpha = progress.value
        translationX = (1f - progress.value) * travel
    }
}

/**
 * Photo, Details, Saved — three numbered stops on a rail that fills to the
 * current one. Read out as one phrase, since three separate "1", "2", "3"
 * would tell a screen-reader user nothing.
 */
@Composable
private fun SlipStepper(at: Int) {
    val c = Saarthi.colors
    val reduced = Saarthi.reducedMotion
    val names = listOf(
        stringResource(R.string.fuel_step_photo),
        stringResource(R.string.expense_step_details),
        stringResource(R.string.fuel_step_saved),
    )
    val label = stringResource(R.string.fuel_step_label, at + 1, names.size, names[at])
    // The design's rail is its `sunken`, which on this screen is the light
    // theme's track grey and the dark theme's sunken.
    val rail = if (c.dark) c.sunken else c.track
    BoxWithConstraints(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 6.dp)
            .clearAndSetSemantics { contentDescription = label },
    ) {
        val between = (maxWidth - StopWidth) / (names.size - 1)
        val filled by animateDpAsState(
            if (at == 0) 0.dp else StopWidth / 2 + between * at - RailInset,
            if (reduced) snap() else tween(600, easing = Ease.out),
            label = "slip-rail",
        )
        Box(
            Modifier
                .padding(start = RailInset, end = RailInset, top = 14.dp)
                .fillMaxWidth()
                .height(3.dp)
                .clip(CircleShape)
                .background(rail),
        )
        Box(
            Modifier
                .padding(start = RailInset, top = 14.dp)
                .width(filled)
                .height(3.dp)
                .clip(CircleShape)
                .background(c.primary),
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            names.forEachIndexed { index, name ->
                StepStop(number = index + 1, name = name, reached = index <= at, passed = index < at, rail = rail)
            }
        }
    }
}

/** One stop on the rail: a disc with its number (a tick once passed) and its name under it. */
@Composable
private fun StepStop(number: Int, name: String, reached: Boolean, passed: Boolean, rail: Color) {
    val c = Saarthi.colors
    val ground by animateColorAsState(if (reached) c.primary else c.card, tween(400), label = "stop-ground")
    val ink by animateColorAsState(if (reached) c.onPrimary else c.muted, tween(400), label = "stop-ink")
    Column(
        Modifier.width(StopWidth),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            Modifier
                .size(30.dp)
                // A ring outside the disc, not a border eating into it.
                .drawBehind {
                    if (!reached) drawCircle(rail, radius = size.minDimension / 2f + 2.dp.toPx())
                }
                .clip(CircleShape)
                .background(ground),
            contentAlignment = Alignment.Center,
        ) {
            if (passed) {
                LineIcon(Lucide.check, size = 14.dp, color = ink, stroke = 3f)
            } else {
                Text(number.toString(), style = SType.smallStrong.copy(fontWeight = FontWeight.Bold, fontSize = 13.sp), color = ink)
            }
        }
        Text(name, style = SType.captionStrong, color = if (reached) c.fg else c.muted)
    }
}

private val StopWidth = 72.dp

/** The rail starts 24 from the stepper's edge; the stops sit 6 in, so 18 from theirs. */
private val RailInset = 18.dp
