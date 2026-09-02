package com.saarthi.terminal.ui.screens

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.GpsFixed
import androidx.compose.material.icons.rounded.GpsOff
import androidx.compose.material.icons.rounded.LocalShipping
import androidx.compose.material.icons.rounded.Memory
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.terminal.network.TerminalVehicleQrDto
import com.saarthi.terminal.telemetry.Metric
import com.saarthi.terminal.ui.Gutter
import com.saarthi.terminal.ui.LivePulse
import com.saarthi.terminal.ui.SectionLabel
import com.saarthi.terminal.ui.GlassCard
import com.saarthi.terminal.ui.StatusChip
import com.saarthi.terminal.ui.StatusTone
import com.saarthi.terminal.ui.TerminalPage
import com.saarthi.terminal.ui.TerminalViewModel

/**
 * The resting screen (specification sections 10 and 11).
 *
 * What a terminal shows for most of its life: the vehicle it belongs to, its own
 * health, and — the whole point — **the vehicle's permanent Saarthi QR**.
 *
 * That QR is the vehicle's identity. It is the same code printed on the
 * windscreen sticker, rendered by the server from the vehicle's existing
 * `QrCode` record. The terminal does not mint it, does not rotate it, and above
 * all does not create a new one per driver: a driver scans this same code with
 * their own Saarthi account, which is what section 10 is about and what section
 * 12 depends on.
 *
 * Everything else on this screen answers the question an installer or a
 * dispatcher asks about a parked truck — is that terminal alive, does it have
 * GPS, is it talking to Saarthi — because a terminal that has quietly stopped
 * reporting looks exactly like one that is working until somebody checks.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun VehicleIdentityScreen(
    viewModel: TerminalViewModel,
    expanded: Boolean,
    onOpenAdmin: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val vehicle = state.server?.vehicle
    val qr = state.server?.vehicleQr
    val health = state.server?.health

    TerminalPage {
        // --- Header ---------------------------------------------------------
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("SAARTHI", style = MaterialTheme.typography.titleLarge, letterSpacing = 4.sp)

            Row(verticalAlignment = Alignment.CenterVertically) {
                LivePulse(
                    active = !state.offline,
                    tone = if (state.offline) StatusTone.WARN else StatusTone.GOOD,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    if (state.offline) "OFFLINE" else "ONLINE",
                    style = MaterialTheme.typography.labelMedium,
                    color = if (state.offline) {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                )
                Spacer(Modifier.width(8.dp))
                IconButton(onClick = onOpenAdmin) {
                    Icon(Icons.Rounded.Build, contentDescription = "Terminal diagnostics")
                }
            }
        }

        Spacer(Modifier.height(Gutter))

        val qrPanel: @Composable (Modifier) -> Unit = { modifier ->
            GlassCard(modifier) {
                SectionLabel("Vehicle QR")
                Spacer(Modifier.height(12.dp))
                VehicleQrImage(qr, Modifier.fillMaxWidth())
                Spacer(Modifier.height(12.dp))
                Text(
                    "A driver scans this with their own Saarthi account to sign on.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (qr != null) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        // The short label exists for a dirty screen or a camera
                        // that will not focus. It is the same code, typed.
                        qr.shortLabel,
                        style = MaterialTheme.typography.titleMedium,
                        fontFamily = FontFamily.Monospace,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }

        val detailPanel: @Composable (Modifier) -> Unit = { modifier ->
            Column(modifier, verticalArrangement = Arrangement.spacedBy(Gutter)) {
                GlassCard(Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Rounded.LocalShipping,
                            contentDescription = null,
                            modifier = Modifier.size(32.dp),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(
                                vehicle?.registrationNumber ?: "Not connected",
                                style = MaterialTheme.typography.headlineMedium,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                vehicle?.organizationName.orEmpty(),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    Spacer(Modifier.height(Gutter))

                    DetailRow("Vehicle type", vehicle?.vehicleType?.humanise())
                    DetailRow("Body", vehicle?.truckType?.humanise())
                    DetailRow(
                        "Make & model",
                        listOfNotNull(vehicle?.manufacturer, vehicle?.model)
                            .joinToString(" ")
                            .ifBlank { null },
                    )
                    DetailRow("Status", vehicle?.status?.humanise())
                    DetailRow(
                        "Odometer",
                        vehicle?.odometerKm?.let { "${it.toLong()} km" },
                    )
                }

                GlassCard(Modifier.fillMaxWidth()) {
                    SectionLabel("Terminal")
                    Spacer(Modifier.height(12.dp))

                    // Wraps rather than squeezes. Three chips do not fit
                    // across a phone, and a `Row` answers that by crushing its
                    // children instead of moving one to the next line.
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        StatusChip(
                            icon = if (state.offline) Icons.Rounded.CloudOff else Icons.Rounded.CloudDone,
                            label = if (state.offline) "Offline" else "Connected",
                            tone = if (state.offline) StatusTone.WARN else StatusTone.GOOD,
                        )
                        StatusChip(
                            icon = if (state.telemetry.hasPosition) {
                                Icons.Rounded.GpsFixed
                            } else {
                                Icons.Rounded.GpsOff
                            },
                            label = if (state.telemetry.hasPosition) "GPS" else "No GPS",
                            tone = if (state.telemetry.hasPosition) {
                                StatusTone.GOOD
                            } else {
                                StatusTone.WARN
                            },
                        )
                        StatusChip(
                            icon = Icons.Rounded.Memory,
                            label = if (health?.vehicleDataConnected == true) {
                                "Vehicle data"
                            } else {
                                "No vehicle data"
                            },
                            tone = if (health?.vehicleDataConnected == true) {
                                StatusTone.GOOD
                            } else {
                                StatusTone.NEUTRAL
                            },
                        )
                    }

                    Spacer(Modifier.height(Gutter))

                    DetailRow("Terminal id", state.server?.terminal?.deviceIdentifier)
                    DetailRow(
                        "Battery",
                        health?.batteryPercent?.let {
                            "$it%${if (health.batteryCharging == true) " · charging" else ""}"
                        },
                    )
                    DetailRow("Network", health?.networkType?.humanise())
                    DetailRow(
                        "Speed",
                        state.telemetry.value(Metric.SPEED)?.let { "${it.toInt()} km/h" },
                    )
                    if (state.pendingUploads > 0) {
                        DetailRow("Saved offline", "${state.pendingUploads} readings")
                    }
                }
            }
        }

        if (expanded) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Gutter),
            ) {
                qrPanel(Modifier.weight(1f))
                detailPanel(Modifier.weight(1f))
            }
        } else {
            // Stacked, and the page scrolls. `fillMaxSize` here would mean "fill
            // infinity" inside a scrolling parent, which is what hid the detail
            // panel below the fold in the first place.
            Column(
                Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(Gutter),
            ) {
                qrPanel(Modifier.fillMaxWidth())
                detailPanel(Modifier.fillMaxWidth())
                Spacer(Modifier.height(Gutter))
            }
        }
    }
}

/**
 * The QR itself.
 *
 * Rendered server-side and delivered as a data URI, so the terminal carries no
 * QR encoder and — more importantly — cannot generate a code of its own. That is
 * not a convenience: a terminal able to render an arbitrary QR is a terminal
 * that could be made to display one, and this code is a vehicle's identity.
 *
 * Always drawn on white. A QR on a dark surface does not scan.
 */
@Composable
private fun VehicleQrImage(qr: TerminalVehicleQrDto?, modifier: Modifier = Modifier) {
    Box(
        modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(16.dp))
            .background(Color.White)
            .padding(Gutter),
        contentAlignment = Alignment.Center,
    ) {
        if (qr == null) {
            Text(
                "Waiting for the vehicle code…",
                color = Color.Black.copy(alpha = 0.55f),
                style = MaterialTheme.typography.bodyMedium,
            )
            return@Box
        }

        val bitmap = remember(qr.imageDataUri) { decodeDataUri(qr.imageDataUri) }

        if (bitmap != null) {
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = "Saarthi vehicle QR code",
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Text(
                // The typed code still works, so the screen says so rather than
                // showing an empty box.
                "Code could not be drawn. Use ${qr.shortLabel}.",
                color = Color.Black.copy(alpha = 0.7f),
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * Decode a `data:` URI into a bitmap.
 *
 * The server renders SVG for the web and PNG for here. Only base64 payloads are
 * accepted; a URI that is not one is treated as undrawable rather than parsed
 * leniently, because the only thing that should ever appear in this box is a
 * code Saarthi produced.
 */
private fun decodeDataUri(uri: String): android.graphics.Bitmap? = runCatching {
    val marker = ";base64,"
    val index = uri.indexOf(marker)
    if (index < 0) return null
    val bytes = Base64.decode(uri.substring(index + marker.length), Base64.DEFAULT)
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
}.getOrNull()

@Composable
private fun DetailRow(label: String, value: String?) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            // An em dash rather than a blank. "Not recorded" and "empty string"
            // look identical otherwise, and one of them is a data problem.
            value ?: "—",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
        )
    }
}

/** `LIGHT_COMMERCIAL` → `Light commercial`. */
internal fun String.humanise(): String =
    lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
