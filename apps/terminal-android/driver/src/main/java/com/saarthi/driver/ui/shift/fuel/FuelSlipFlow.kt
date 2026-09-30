package com.saarthi.driver.ui.shift.fuel

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
import androidx.compose.runtime.Stable
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
 * A fuel slip, photographed and filed from the pump: photo, figures, saved.
 *
 * The photograph comes first because it is the evidence for the figures — the
 * server refuses a slip without one — and a failed save keeps both the photo
 * and what was typed, so a driver on a patchy forecourt connection only ever
 * presses Save again. [onSaved] is the Saved step's Done; Add another stays in
 * the flow for a second slip, and the back gesture simply closes.
 */
@Composable
fun FuelSlipFlow(
    visible: Boolean,
    cockpit: TerminalViewModel,
    onClose: () -> Unit,
    onSaved: () -> Unit,
) {
    FlowPanel(visible, onBack = onClose) {
        FuelSlipContent(cockpit, onClose, onSaved)
    }
}

private enum class FuelStep { PHOTO, FIGURES, SAVED }

/** What the driver has put on this slip so far. Kept across a retake and a failed save. */
@Stable
internal class FuelSlipDraft {
    /** The JPEG as taken; not drawn, so not state. */
    var jpeg: ByteArray? = null
    var photo by mutableStateOf<ImageBitmap?>(null)
    var litres by mutableStateOf("")
    var amount by mutableStateOf("")
    var pump by mutableStateOf("")
    var odometer by mutableStateOf("")

    val litresValue: Double? get() = litres.positiveFigure()
    val amountValue: Double? get() = amount.positiveFigure()
    val odometerValue: Double? get() = odometer.normalised().toDoubleOrNull()?.takeIf { it >= 0.0 }

    /** Everything the server insists on: the photo and both figures. */
    val complete: Boolean get() = jpeg != null && litresValue != null && amountValue != null

    fun clear() {
        jpeg = null
        photo = null
        litres = ""
        amount = ""
        pump = ""
        odometer = ""
    }
}

/** A comma is a decimal point on half the keyboards in the country. */
private fun String.normalised(): String = trim().replace(',', '.')

private fun String.positiveFigure(): Double? = normalised().toDoubleOrNull()?.takeIf { it > 0.0 }

/**
 * The odometer to start the slip with: the vehicle's reading when it reports
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
private fun ColumnScope.FuelSlipContent(
    cockpit: TerminalViewModel,
    onClose: () -> Unit,
    onSaved: () -> Unit,
) {
    val state by cockpit.uiState.collectAsState()
    val draft = remember { FuelSlipDraft() }
    var step by remember { mutableStateOf(FuelStep.PHOTO) }
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
            title = stringResource(R.string.fuel_title),
            plate = state.registration,
            onBack = { if (!saving) onClose() },
        )
        FuelStepper(step.ordinal)

        val stepModifier = Modifier
            .weight(1f)
            .fillMaxWidth()
            .stepIn()
        when (step) {
            FuelStep.PHOTO -> FuelCameraStep(
                onShot = { jpeg, photo ->
                    draft.jpeg = jpeg
                    draft.photo = photo
                    if (draft.odometer.isEmpty()) draft.odometer = odometerFrom(state.telemetry)
                    problem = null
                    step = FuelStep.FIGURES
                },
                modifier = stepModifier,
            )
            FuelStep.FIGURES -> FuelFiguresStep(
                draft = draft,
                saving = saving,
                problem = problem,
                onRetake = { step = FuelStep.PHOTO },
                onSave = save@{
                    val jpeg = draft.jpeg ?: return@save
                    val litres = draft.litresValue ?: return@save
                    val amount = draft.amountValue ?: return@save
                    if (saving) return@save
                    saving = true
                    problem = null
                    cockpit.saveFuelSlip(jpeg, litres, amount, draft.odometerValue, draft.pump.trim().ifEmpty { null }) { refusal ->
                        saving = false
                        if (refusal == null) step = FuelStep.SAVED else problem = refusal
                    }
                },
                modifier = stepModifier,
            )
            FuelStep.SAVED -> FuelSavedStep(
                onAnother = {
                    draft.clear()
                    step = FuelStep.PHOTO
                },
                onDone = onSaved,
                modifier = stepModifier,
            )
        }
    }
}

/**
 * `.fs-step`: each step arrives from 40 to the right and fades in.
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
 * Photo, Figures, Saved — three numbered stops on a rail that fills to the
 * current one. Read out as one phrase, since three separate "1", "2", "3"
 * would tell a screen-reader user nothing.
 */
@Composable
private fun FuelStepper(at: Int) {
    val c = Saarthi.colors
    val reduced = Saarthi.reducedMotion
    val names = listOf(
        stringResource(R.string.fuel_step_photo),
        stringResource(R.string.fuel_step_figures),
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
            label = "fuel-rail",
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
                // `box-shadow: 0 0 0 2px` — a ring outside the disc, not a border eating into it.
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
