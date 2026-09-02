package com.saarthi.terminal.ui.screens

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.HourglassTop
import androidx.compose.material.icons.rounded.LinkOff
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.QrCode2
import androidx.compose.material.icons.rounded.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.terminal.domain.TerminalState
import com.saarthi.terminal.ui.Gutter
import com.saarthi.terminal.ui.LocalReducedMotion
import com.saarthi.terminal.ui.PrimaryAction
import com.saarthi.terminal.ui.SaarthiDanger
import com.saarthi.terminal.ui.SaarthiSuccess
import com.saarthi.terminal.ui.SaarthiWarning
import com.saarthi.terminal.ui.GlassCard
import com.saarthi.terminal.ui.StatusTone
import com.saarthi.terminal.ui.TerminalPage
import com.saarthi.terminal.ui.TerminalViewModel

/**
 * The screens between "a driver scanned the QR" and "the driver may drive".
 *
 * The one thing all of them have in common is that the person reading them is
 * *standing beside a truck, waiting*, usually at the start or end of a shift and
 * often in the dark. That shapes every decision here: large type, one message
 * per screen, an honest clock, and never a claim that something is about to
 * happen automatically.
 */

/**
 * Waiting for the fleet (specification sections 13, 14 and 15).
 *
 * Shows where the request has got to, and — this is the part that matters — what
 * happens if nobody answers. It says *escalated*, never "approved
 * automatically", because nothing here ever approves on its own and a driver who
 * believed otherwise would stand here until the shift ended.
 */
@Composable
fun ApprovalWaitingScreen(viewModel: TerminalViewModel) {
    val state by viewModel.uiState.collectAsState()
    val session = state.server?.session
    val reducedMotion = LocalReducedMotion.current

    // A local clock, so the elapsed time moves even between server refreshes.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(1_000)
            now = System.currentTimeMillis()
        }
    }

    val step = when (state.state) {
        TerminalState.DRIVER_IDENTIFIED -> 1
        TerminalState.SELFIE_SUBMITTED -> 2
        else -> 3
    }

    TerminalPage(scrollable = false) {
        Spacer(Modifier.height(24.dp))

        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            PulsingHalo(
                active = !reducedMotion,
                tint = MaterialTheme.colorScheme.primary,
            ) {
                Icon(
                    when (step) {
                        1 -> Icons.Rounded.QrCode2
                        2 -> Icons.Rounded.PhotoCamera
                        else -> Icons.Rounded.HourglassTop
                    },
                    contentDescription = null,
                    modifier = Modifier.size(56.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
            }

            Spacer(Modifier.height(28.dp))

            Text(
                when (step) {
                    1 -> "Vehicle confirmed"
                    2 -> "Photo received"
                    else -> "Waiting for approval"
                },
                style = MaterialTheme.typography.headlineMedium,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(10.dp))

            Text(
                when (step) {
                    1 -> "Take your arrival photo in the Saarthi app on your phone."
                    2 -> "Submit your request from the Saarthi app on your phone."
                    else -> "${state.registration ?: "This vehicle"} · your fleet has been notified"
                },
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(Modifier.height(32.dp))

        GlassCard(Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        session?.driver?.name ?: "Driver",
                        style = MaterialTheme.typography.titleLarge,
                    )
                    Text(
                        state.registration ?: "",
                        style = MaterialTheme.typography.bodyMedium,
                        fontFamily = FontFamily.Monospace,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                if (session?.submittedAt != null) {
                    ElapsedClock(session.submittedAt, now)
                }
            }

            Spacer(Modifier.height(Gutter))

            StepRow("Vehicle QR scanned", done = step >= 1)
            StepRow("Arrival photo submitted", done = step >= 2)
            StepRow("Approved by your fleet", done = false, active = step >= 3)
        }

        Spacer(Modifier.height(Gutter))

        /*
         * The SLA, stated honestly.
         *
         * This is the sentence that stops a driver waiting for a timer that will
         * never fire. Section 15 is explicit: fifteen minutes escalates, and only
         * an explicit authorisation activates a driver.
         */
        Surface(
            color = SaarthiWarning.copy(alpha = 0.14f),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                "If nobody answers within 15 minutes this is escalated to your fleet owner. " +
                    "It is never approved automatically — somebody has to decide.",
                Modifier.padding(14.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }

        Spacer(Modifier.weight(1f))

        Text(
            "You can leave this screen. The terminal will show the next step as soon as your fleet decides.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * Approved (specification section 16).
 *
 * The one screen in this app that is allowed to feel like a welcome. It is also
 * the screen that must not let anybody past it without the safety check, so the
 * only action on it starts the checklist.
 */
@Composable
fun WelcomeScreen(viewModel: TerminalViewModel) {
    val state by viewModel.uiState.collectAsState()
    val reducedMotion = LocalReducedMotion.current

    TerminalPage(scrollable = false) {
        Spacer(Modifier.weight(1f))

        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            PulsingHalo(active = !reducedMotion, tint = SaarthiSuccess) {
                Icon(
                    Icons.Rounded.Verified,
                    contentDescription = null,
                    modifier = Modifier.size(60.dp),
                    tint = SaarthiSuccess,
                )
            }

            Spacer(Modifier.height(28.dp))

            Text(
                "VERIFIED",
                style = MaterialTheme.typography.titleMedium,
                letterSpacing = 8.sp,
                color = SaarthiSuccess,
            )

            Spacer(Modifier.height(12.dp))

            Text(
                "Welcome, ${state.driverName ?: "driver"}",
                style = MaterialTheme.typography.headlineMedium,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(8.dp))

            Text(
                "You are assigned to",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Text(
                state.registration ?: "",
                style = MaterialTheme.typography.displaySmall,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
            )

            Spacer(Modifier.height(28.dp))

            Text(
                "Before starting your trip, complete the vehicle safety check.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(Modifier.height(32.dp))

        PrimaryAction(
            label = "Start the safety check",
            onClick = { viewModel.loadChecklist() },
            tone = StatusTone.GOOD,
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.weight(1f))
    }
}

/**
 * Rejected (specification section 59).
 *
 * The reason is the screen. A refusal with no explanation leaves somebody
 * standing at a truck at four in the morning with nothing to do next, which is
 * why the API makes the reason mandatory and why it is set in the largest type
 * here.
 */
@Composable
fun RejectedScreen(viewModel: TerminalViewModel) {
    val state by viewModel.uiState.collectAsState()
    val session = state.server?.session

    TerminalPage(scrollable = false) {
        Spacer(Modifier.weight(1f))

        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                Icons.Rounded.LinkOff,
                contentDescription = null,
                modifier = Modifier.size(56.dp),
                tint = SaarthiDanger,
            )

            Spacer(Modifier.height(20.dp))

            Text(
                "Not approved",
                style = MaterialTheme.typography.headlineMedium,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(16.dp))

            GlassCard(Modifier.fillMaxWidth()) {
                Text(
                    session?.rejectionReason
                        ?: "Your fleet did not approve this request.",
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (session?.decidedByName != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Decided by ${session.decidedByName}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            Spacer(Modifier.height(20.dp))

            Text(
                "Speak to your dispatcher. You can scan the vehicle QR again once this is resolved.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(Modifier.height(28.dp))

        PrimaryAction(
            label = "Back to the vehicle screen",
            onClick = { viewModel.refresh() },
            tone = StatusTone.NEUTRAL,
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.weight(1f))
    }
}

/**
 * Credentials gone.
 *
 * A terminal that has been unpaired, suspended or had its credentials rotated.
 * It says what happened and what to do, and — because this is exactly the state
 * an engineer is called out for — it offers the diagnostics screen.
 */
@Composable
fun RevokedScreen(viewModel: TerminalViewModel, onOpenAdmin: () -> Unit) {
    val state by viewModel.uiState.collectAsState()

    TerminalPage(scrollable = false) {
        Spacer(Modifier.weight(1f))

        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                Icons.Rounded.LinkOff,
                contentDescription = null,
                modifier = Modifier.size(56.dp),
                tint = SaarthiWarning,
            )
            Spacer(Modifier.height(20.dp))
            Text(
                "This terminal is not connected",
                style = MaterialTheme.typography.headlineMedium,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                state.error
                    ?: "Its credentials are no longer valid. Ask your fleet to issue a new pairing code from Vehicle → Hardware.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(Modifier.height(28.dp))

        /*
         * The way out.
         *
         * Without this the tablet is stranded: the fleet disconnects it from
         * the dashboard, its credentials stop working, and this screen has
         * nothing on it that will make it accept a new code. On a kiosk-locked
         * terminal the installer cannot even reach Android's app settings to
         * clear the data, so "connect it to another vehicle" would mean a
         * factory reset of a tablet bolted into a cab.
         */
        PrimaryAction(
            label = "Connect to a vehicle",
            icon = Icons.Rounded.QrCode2,
            onClick = { viewModel.forgetPairing() },
            tone = StatusTone.GOOD,
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(12.dp))

        PrimaryAction(
            label = "Terminal diagnostics",
            icon = Icons.Rounded.Build,
            onClick = onOpenAdmin,
            tone = StatusTone.NEUTRAL,
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.weight(1f))
    }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * A soft halo behind an icon.
 *
 * Stops entirely under reduced motion rather than slowing down — a slower pulse
 * is still movement, and the point of that setting is that nothing moves on its
 * own.
 */
@Composable
private fun PulsingHalo(
    active: Boolean,
    tint: androidx.compose.ui.graphics.Color,
    content: @Composable () -> Unit,
) {
    val scale = if (active) {
        val transition = rememberInfiniteTransition(label = "halo")
        transition.animateFloat(
            initialValue = 1f,
            targetValue = 1.14f,
            animationSpec = infiniteRepeatable(
                animation = tween(1_800, easing = LinearEasing),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "halo-scale",
        ).value
    } else {
        1f
    }

    Box(contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size((132 * scale).dp)
                .clip(CircleShape)
                .background(tint.copy(alpha = 0.12f)),
        )
        content()
    }
}

/** Minutes and seconds since a timestamp, ticking. */
@Composable
private fun ElapsedClock(submittedAtIso: String, now: Long) {
    val submittedAt = remember(submittedAtIso) {
        runCatching { java.time.Instant.parse(submittedAtIso).toEpochMilli() }.getOrNull()
    } ?: return

    val elapsed = ((now - submittedAt) / 1000).coerceAtLeast(0)
    val minutes = elapsed / 60
    val seconds = elapsed % 60
    val escalated = minutes >= 15

    Column(horizontalAlignment = Alignment.End) {
        Text(
            "%d:%02d".format(minutes, seconds),
            style = MaterialTheme.typography.headlineSmall,
            color = if (escalated) SaarthiWarning else MaterialTheme.colorScheme.onSurface,
        )
        Text(
            if (escalated) "escalated" else "waiting",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun StepRow(label: String, done: Boolean, active: Boolean = false) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            if (done) Icons.Rounded.CheckCircle else Icons.Rounded.HourglassTop,
            contentDescription = null,
            tint = when {
                done -> SaarthiSuccess
                active -> MaterialTheme.colorScheme.primary
                else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
            },
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.width(12.dp))
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = if (done || active) {
                MaterialTheme.colorScheme.onSurface
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
    }
}
