package com.saarthi.driver.ui.start

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.driver.R
import com.saarthi.driver.network.DriverApi
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.design.Aurora
import com.saarthi.driver.ui.design.BrandMark
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.Confetti
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LiveDot
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.RippleRings
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.SaarthiCard
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.StatusPill
import com.saarthi.driver.ui.design.StepHeader
import com.saarthi.driver.ui.design.StepScreen
import com.saarthi.driver.ui.design.SuccessDisc
import com.saarthi.driver.ui.design.SystemBars
import com.saarthi.driver.ui.design.brandGradient
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.popIn
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger

/**
 * Waiting for the fleet.
 *
 * Honest about what scanning did and did not do: it opened a request and
 * authorised nothing, so the vehicle and the word "waiting" lead, and the
 * timeline shows approval as the step still in progress. Cancelling is always
 * offered, because the commonest reason for sitting here is a scan of the
 * wrong truck — and an open request nobody can clear blocks the right one.
 */
@Composable
fun AwaitingApprovalScreen(viewModel: DriverViewModel, assignment: DriverApi.AssignmentDto) {
    val c = Saarthi.colors
    val plate = assignment.registrationNumber
    StepScreen(scroll = true, padding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 20.dp)) {
        StepHeader(
            eyebrow = stringResource(R.string.awaiting_eyebrow),
            title = stringResource(R.string.awaiting_title),
        )
        RadarStage(Modifier.padding(top = 12.dp).rise(stagger(1)))

        SaarthiCard(Modifier.padding(top = 14.dp).rise(stagger(2)), spacing = 8.dp) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Eyebrow(stringResource(R.string.label_vehicle), Modifier.weight(1f))
                StatusPill(
                    stringResource(R.string.awaiting_pill),
                    background = c.warningBg,
                    ink = c.warning,
                    live = true,
                )
            }
            plate?.let { Text(it, style = SType.plate(28.sp, tracking = 0.04.em), color = c.fg) }
            Text(stringResource(R.string.awaiting_body), style = SType.body, color = c.muted)
        }

        SaarthiCard(Modifier.padding(top = 12.dp).rise(stagger(3)), spacing = 0.dp) {
            TimelineStep(
                marker = { IconWell(Lucide.check, well = c.successSoft, ink = c.success, size = 26.dp, shape = CircleShape, iconSize = 13.dp, stroke = 3f) },
                line = TimelineLine.SOLID,
                title = plate?.let { stringResource(R.string.awaiting_step_scanned, it) } ?: stringResource(R.string.awaiting_step_sent),
                subtitle = stringResource(R.string.awaiting_step_scanned_sub),
            )
            TimelineStep(
                marker = {
                    Box(
                        Modifier
                            .size(26.dp)
                            .clip(CircleShape)
                            .background(c.warningBg),
                        contentAlignment = Alignment.Center,
                    ) { LiveDot(c.warning, size = 10.dp) }
                },
                line = TimelineLine.DASHED,
                title = stringResource(R.string.awaiting_step_fleet),
                subtitle = stringResource(R.string.awaiting_step_fleet_sub),
            )
            TimelineStep(
                marker = {
                    Box(
                        Modifier
                            .size(26.dp)
                            .clip(CircleShape)
                            .border(2.dp, c.borderStrong, CircleShape),
                    )
                },
                line = TimelineLine.NONE,
                title = stringResource(R.string.awaiting_step_trip),
                subtitle = stringResource(R.string.awaiting_step_trip_sub),
                muted = true,
            )
        }

        SaarthiButton(
            stringResource(R.string.awaiting_cancel),
            viewModel::cancel,
            Modifier
                .padding(top = 14.dp)
                .rise(stagger(4)),
            tone = ButtonTone.SECONDARY,
            leading = Lucide.ban,
            leadingTint = c.muted,
        )
    }
}

private enum class TimelineLine { SOLID, DASHED, NONE }

@Composable
private fun TimelineStep(
    marker: @Composable () -> Unit,
    line: TimelineLine,
    title: String,
    subtitle: String,
    muted: Boolean = false,
) {
    val c = Saarthi.colors
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            marker()
            if (line != TimelineLine.NONE) {
                Canvas(
                    Modifier
                        .width(2.dp)
                        .heightIn(min = 20.dp)
                        .height(34.dp),
                ) {
                    drawLine(
                        color = if (line == TimelineLine.SOLID) c.success.copy(alpha = 0.4f) else c.borderStrong,
                        start = Offset(size.width / 2f, 0f),
                        end = Offset(size.width / 2f, size.height),
                        strokeWidth = size.width,
                        pathEffect = if (line == TimelineLine.DASHED) {
                            PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 5.dp.toPx()))
                        } else {
                            null
                        },
                    )
                }
            }
        }
        Column(Modifier.padding(bottom = if (line == TimelineLine.NONE) 0.dp else 14.dp)) {
            Text(title, style = SType.bodyStrong, color = if (muted) c.muted else c.fg)
            Text(subtitle, style = SType.small, color = c.subtle)
        }
    }
}

/**
 * The drawn street map with the vehicle at its centre and amber rings pulsing
 * out — Humsafar checking with the fleet every few seconds.
 *
 * Scenery, and marked so: every fact on it is also written in words below.
 */
@Composable
private fun RadarStage(modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val shape = RoundedCornerShape(28.dp)
    Box(
        modifier
            .fillMaxWidth()
            .height(210.dp)
            .clip(shape)
            .background(c.stage)
            .border(1.dp, c.ring, shape),
    ) {
        Canvas(Modifier.matchParentSize()) {
            val sx = size.width / 350f
            val sy = size.height / 210f
            fun line(x1: Float, y1: Float, x2: Float, y2: Float, color: Color, width: Float) =
                drawLine(color, Offset(x1 * sx, y1 * sy), Offset(x2 * sx, y2 * sy), width, StrokeCap.Round)
            val street = 1.5.dp.toPx()
            line(0f, 40f, 350f, 30f, c.street, street)
            line(0f, 90f, 350f, 84f, c.street, street)
            line(0f, 150f, 350f, 158f, c.street, street)
            line(0f, 196f, 350f, 204f, c.street, street)
            line(50f, 0f, 60f, 210f, c.street, street)
            line(130f, 0f, 124f, 210f, c.street, street)
            line(220f, 0f, 230f, 210f, c.street, street)
            line(300f, 0f, 292f, 210f, c.street, street)
            val artery = 6.dp.toPx()
            line(0f, 116f, 350f, 100f, c.artery, artery)
            line(190f, 0f, 178f, 210f, c.artery, artery)
        }
        Box(Modifier.align(Alignment.Center).size(90.dp), contentAlignment = Alignment.Center) {
            RippleRings(color = c.warningGlow, periodMs = 2_600, from = 0.5f, to = 2.6f, startAlpha = 1f, count = 3)
            Box(
                Modifier
                    .size(58.dp)
                    .shadow(10.dp, CircleShape, spotColor = Color(0x99021D40))
                    .brandGradient(CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                LineIcon(Lucide.truck, size = 26.dp, color = Color.White)
            }
        }
        Row(
            Modifier
                .align(Alignment.BottomStart)
                .padding(14.dp)
                .card(radius = 999.dp)
                .padding(horizontal = 12.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            LiveDot(c.warning, size = 8.dp)
            Text(stringResource(R.string.awaiting_checking), style = SType.captionStrong, color = c.fg)
        }
    }
}

/**
 * The fleet said no, with its reason when it gave one.
 *
 * The commonest rejection is the wrong vehicle, which the next scan fixes, so
 * the one action here is "scan a different vehicle" rather than anything that
 * reads like an appeal.
 */
@Composable
fun RejectedScreen(viewModel: DriverViewModel, assignment: DriverApi.AssignmentDto) {
    val c = Saarthi.colors
    val plate = assignment.registrationNumber
    val reason = assignment.rejectionReason?.takeIf { it.isNotBlank() }
    StepScreen(scroll = true) {
        StepHeader(
            eyebrow = stringResource(R.string.rejected_eyebrow),
            title = stringResource(R.string.rejected_title),
        )
        IconWell(
            Lucide.xCircle,
            well = c.dangerSoft,
            ink = c.danger,
            size = 76.dp,
            radius = 26.dp,
            iconSize = 34.dp,
            modifier = Modifier
                .padding(top = 30.dp)
                .popIn(),
        )
        Column(
            Modifier
                .padding(top = 20.dp)
                .rise(stagger(2)),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            StatusPill(stringResource(R.string.rejected_pill), background = c.dangerBg, ink = c.danger)
            if (plate != null) {
                Text(stringResource(R.string.rejected_for), style = SType.lead.copy(fontSize = 16.sp), color = c.muted)
                Text(plate, style = SType.plate(30.sp), color = c.fg)
                Text(stringResource(R.string.rejected_declined), style = SType.lead.copy(fontSize = 16.sp), color = c.muted)
            } else {
                Text(stringResource(R.string.rejected_generic), style = SType.lead.copy(fontSize = 16.sp), color = c.muted)
            }
        }
        SaarthiCard(Modifier.padding(top = 20.dp).rise(stagger(3)), spacing = 8.dp) {
            Eyebrow(stringResource(R.string.rejected_reason))
            Text(
                reason ?: stringResource(R.string.rejected_no_reason),
                style = SType.lead.copy(fontSize = 16.sp),
                color = if (reason != null) c.fg else c.muted,
            )
        }
        Spacer(Modifier.weight(1f).heightIn(min = 24.dp))
        SaarthiButton(stringResource(R.string.rejected_action), viewModel::cancel, Modifier.rise(stagger(4)))
    }
}

/**
 * "You are approved" — shown once, as the fleet's yes arrives.
 *
 * The brand panel, confetti and a written tick; then the one thing to do next,
 * the safety check, before the driver is let through to the dashboard.
 */
@Composable
fun ApprovedScreen(plate: String?, fleetName: String?, onContinue: () -> Unit) {
    val c = Saarthi.colors
    SystemBars(lightContent = true)
    Column(
        Modifier
            .fillMaxSize()
            .background(c.canvas)
            .windowInsetsPadding(WindowInsets.navigationBars),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(430.dp)
                .brandGradient(RoundedCornerShape(bottomStart = 36.dp, bottomEnd = 36.dp)),
        ) {
            Aurora()
            Confetti(
                colors = listOf(Color(0xFFFE5D09), Color(0xFF4ADE80), Color.White, Color(0xFF86ABF2), Color(0xFFF49434), Color(0xFF3DAE79)),
                lefts = listOf(0.05f, 0.13f, 0.21f, 0.30f, 0.38f, 0.46f, 0.54f, 0.62f, 0.70f, 0.78f, 0.86f, 0.94f, 0.17f, 0.66f, 0.42f),
            )
            BrandMark(
                height = 32.dp,
                plated = true,
                modifier = Modifier
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .padding(start = 20.dp, top = 12.dp),
            )
            Column(
                Modifier
                    .align(Alignment.Center)
                    .padding(top = 40.dp, start = 24.dp, end = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Box(
                        Modifier
                            .size(164.dp)
                            .clip(CircleShape)
                            .background(Color.White.copy(alpha = 0.06f)),
                    )
                    SuccessDisc(
                        size = 112.dp,
                        disc = Color.White,
                        tick = Color(0xFF2A845A),
                        halo = Color.White.copy(alpha = 0.14f),
                        haloWidth = 12.dp,
                        tickSize = 56.dp,
                    )
                }
                Column(Modifier.rise(stagger(3)), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(stringResource(R.string.approved_title), style = SType.celebrate, color = Color.White, textAlign = TextAlign.Center)
                    Text(
                        fleetName?.let { stringResource(R.string.approved_by, it) } ?: stringResource(R.string.approved_by_generic),
                        style = SType.lead,
                        color = Color.White.copy(alpha = 0.8f),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
                plate?.let {
                    Text(
                        it,
                        style = SType.plate(22.sp),
                        color = Color(0xFF18181B),
                        modifier = Modifier
                            .rise(stagger(4))
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color.White)
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                    )
                }
            }
        }
        Column(
            Modifier
                .weight(1f)
                .padding(start = 20.dp, end = 20.dp, top = 22.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                Modifier
                    .rise(stagger(5))
                    .fillMaxWidth()
                    .card()
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                IconWell(Lucide.shieldCheck, well = c.successSoft, ink = c.success, iconSize = 22.dp)
                Column {
                    Text(stringResource(R.string.before_drive_title), style = SType.cardTitle, color = c.fg)
                    Text(stringResource(R.string.before_drive_body), style = SType.small, color = c.muted)
                }
            }
            Spacer(Modifier.weight(1f))
            SaarthiButton(
                stringResource(R.string.approved_action),
                onContinue,
                Modifier.rise(stagger(6)),
                trailing = Lucide.arrowRight,
            )
        }
    }
}
