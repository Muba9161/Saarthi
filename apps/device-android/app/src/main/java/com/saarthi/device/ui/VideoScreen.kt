package com.saarthi.device.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.saarthi.device.video.VideoPublisher
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer

/**
 * The camera screen.
 *
 * Renders the *publisher's* own video track rather than opening a second camera
 * of its own. That matters: the service owns the capturer so a stream can run
 * with the phone in a pocket, and a screen that opened its own CameraX preview
 * would fight it for the lens and win — stopping the stream the moment somebody
 * looked at it.
 *
 * So this attaches a sink to whatever is already capturing. Opening the screen
 * during a live stream shows exactly what is being sent, and closing it leaves
 * the stream running.
 */
@Composable
fun VideoScreen(
    publisherState: VideoPublisher.State,
    videoEnabled: Boolean,
    channel: Int,
    busy: Boolean,
    onChannelChange: (Int) -> Unit,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onPreviewOnly: () -> Unit,
) {
    val context = LocalContext.current
    var hasPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    val requestPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        hasPermission = granted
        if (granted) onPreviewOnly()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Camera", style = MaterialTheme.typography.titleLarge)

        if (!hasPermission) {
            SectionCard(
                title = "Camera permission needed",
                subtitle = "Used to scan pairing codes and, when you start it, to stream this vehicle's view to the Saarthi dashboard.",
            ) {
                Button(
                    onClick = { requestPermission.launch(Manifest.permission.CAMERA) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Allow camera") }
            }
            return@Column
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(4f / 3f)
                .clip(RoundedCornerShape(12.dp))
                .background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            if (publisherState.capturing) {
                PublisherPreview(mirror = channel == 2)
            } else {
                Text(
                    "Camera off",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        /*
         * Which camera is selected, stated rather than implied.
         *
         * This was two OutlinedButtons whose *disabled* one was the active
         * channel — technically consistent, and unreadable: a greyed "Road"
         * next to a bright "Cabin" says Cabin to everyone who looks at it, when
         * it meant Road. Someone then watched the wrong channel on the dashboard
         * and got a 404 from a gateway that was working perfectly.
         *
         * FilterChip carries a real selected state, with a tick, so there is
         * nothing to infer.
         */
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(
                selected = channel == 1,
                onClick = { onChannelChange(1) },
                label = { Text("Road") },
                leadingIcon = if (channel == 1) {
                    { Icon(Icons.Filled.Check, contentDescription = null) }
                } else {
                    null
                },
                modifier = Modifier.weight(1f),
            )
            FilterChip(
                selected = channel == 2,
                onClick = { onChannelChange(2) },
                label = { Text("Cabin") },
                leadingIcon = if (channel == 2) {
                    { Icon(Icons.Filled.Check, contentDescription = null) }
                } else {
                    null
                },
                modifier = Modifier.weight(1f),
            )
        }

        // Which channel the dashboard has to open to see this. The two are
        // separate choices, and getting them out of step looks like a broken
        // gateway rather than a mismatch.
        Text(
            "Streaming channel $channel — open the same channel on the dashboard to watch.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        SectionCard(title = "Stream") {
            StatusRow(
                label = "Connection",
                value = describeConnection(publisherState),
                health = connectionHealth(publisherState),
            )
            if (publisherState.resolution != null) {
                StatusRow("Encoding", publisherState.resolution, Health.IDLE)
            }
            if (publisherState.sessionId != null) {
                StatusRow("Session", publisherState.sessionId.take(8), Health.IDLE)
            }
            if (publisherState.error != null) {
                StatusRow("Error", publisherState.error, Health.BAD)
            }

            if (publisherState.simulated) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    SimulatedBadge()
                    Spacer(Modifier.size(8.dp))
                    Text(
                        "The camera is running, but this environment has no gateway — nothing is receiving the stream.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            Button(
                onClick = if (publisherState.publishing || publisherState.capturing) onStop else onStart,
                enabled = !busy && videoEnabled,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (busy) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.size(8.dp))
                }
                Text(
                    if (publisherState.publishing || publisherState.capturing) {
                        "Stop streaming"
                    } else {
                        "Start streaming"
                    },
                )
            }

            if (!videoEnabled) {
                // Said plainly rather than shown as a broken button. Opening the
                // encoder against a gateway that does not exist costs battery
                // and a driver's mobile data and produces nothing.
                Text(
                    "Saarthi has no video gateway configured on this environment, so there is nowhere for this device to publish.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Text(
            "While streaming, this camera can be watched from the Saarthi dashboard. Every viewing is recorded against the person who opened it, and so is every time this device starts the camera.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * A sink on the publisher's existing video track.
 *
 * `DisposableEffect` detaching on exit is load-bearing: a renderer left attached
 * to a track after its composable has gone holds an EGL surface the WebRTC
 * thread will keep writing into, which crashes the native layer rather than
 * merely leaking.
 */
@Composable
private fun PublisherPreview(mirror: Boolean) {
    val context = LocalContext.current
    val publisher = remember { VideoPublisher.get(context) }

    val renderer = remember {
        SurfaceViewRenderer(context).apply {
            init(publisher.eglBase.eglBaseContext, null)
            setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
            setEnableHardwareScaler(true)
        }
    }

    DisposableEffect(renderer) {
        publisher.attachPreview(renderer)
        onDispose {
            publisher.detachPreview(renderer)
            renderer.release()
        }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { renderer },
        update = { it.setMirror(mirror) },
    )
}

/**
 * What the stream is actually doing.
 *
 * The reconnecting case is listed before the idle ones deliberately. A phone
 * that has lost signal mid-stream previously read "Camera on, not streaming",
 * which is indistinguishable from never having started — so somebody watching
 * the dashboard saw a camera stop and the phone gave no hint that it was trying
 * to come back.
 */
private fun describeConnection(state: VideoPublisher.State): String = when {
    state.publishing -> "Live"
    state.simulated -> "Camera on, no gateway"
    state.wanted && state.attempts > 0 -> "Reconnecting… (attempt ${state.attempts + 1})"
    state.wanted -> "Connecting…"
    state.capturing -> "Camera on, not streaming"
    else -> "Idle"
}

private fun connectionHealth(state: VideoPublisher.State): Health = when {
    state.publishing -> Health.OK
    // Trying to come back is a warning, not a failure. Red for something the
    // app is actively recovering from would train people to ignore red.
    state.wanted -> Health.WARN
    state.error != null -> Health.BAD
    state.simulated || state.capturing -> Health.WARN
    else -> Health.IDLE
}
