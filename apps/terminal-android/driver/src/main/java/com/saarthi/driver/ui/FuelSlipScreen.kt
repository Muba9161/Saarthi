package com.saarthi.driver.ui

import androidx.camera.core.ImageCapture
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.viewinterop.AndroidView
import com.saarthi.core.telemetry.Metric
import com.saarthi.core.ui.CameraBinding
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.CircleAction
import com.saarthi.driver.ui.design.FleetButton
import com.saarthi.driver.ui.design.FleetCard
import com.saarthi.driver.ui.design.FleetEnter
import com.saarthi.driver.ui.design.FleetError
import com.saarthi.driver.ui.design.FleetField
import com.saarthi.driver.ui.design.FleetOutlineButton
import com.saarthi.driver.ui.design.FleetRadius
import com.saarthi.driver.ui.design.FleetScreen
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.OnyxDeep
import com.saarthi.driver.ui.design.SectionHeader
import com.saarthi.driver.ui.design.Slate

/**
 * A fuel slip, recorded at the pump.
 *
 * Drivers carry paper. A till roll goes in a shirt pocket, survives a week of
 * diesel and sunlight, and reaches the office as an argument about whether it
 * was forty litres or forty-five — because filling in a form beside a running
 * engine is worse than keeping the receipt.
 *
 * So this asks for the two figures printed largest on every slip and takes the
 * photograph as the evidence for the rest. Two numbers and one picture is about
 * fifteen seconds; that is the whole design constraint.
 *
 * The photograph is not optional, and the numbers are not derived from it.
 * Saarthi does not read the slip — it has no OCR here, and pretending to would
 * put invented figures into a fleet's fuel economy. The driver types the two
 * numbers; the photograph is what the office reconciles them against.
 */
@Composable
fun FuelSlipScreen(
    cockpit: TerminalViewModel,
    onBack: () -> Unit,
) {
    val state by cockpit.uiState.collectAsState()
    val busy by cockpit.busy.collectAsState()

    var jpeg by remember { mutableStateOf<ByteArray?>(null) }
    var preview by remember { mutableStateOf<ImageBitmap?>(null) }
    var litres by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    var station by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }
    var saved by remember { mutableStateOf(false) }
    var capturing by remember { mutableStateOf(false) }

    val litresValue = litres.trim().toDoubleOrNull()
    val amountValue = amount.trim().toDoubleOrNull()
    val complete = jpeg != null && litresValue != null && litresValue > 0 &&
        amountValue != null && amountValue > 0

    FleetScreen {
        Spacer(Modifier.height(FleetSpace.snug))

        FleetEnter(index = 0) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(FleetSpace.snug),
            ) {
                CircleAction(
                    icon = Icons.AutoMirrored.Rounded.ArrowBack,
                    contentDescription = "Back",
                    onClick = onBack,
                )
                Column(Modifier.weight(1f)) {
                    Text(
                        "Fuel slip",
                        style = MaterialTheme.typography.titleLarge,
                        color = Chalk,
                    )
                    Text(
                        "Photograph the slip and type the two figures. No more paper to keep.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                    )
                }
            }
        }

        Spacer(Modifier.height(FleetSpace.base))

        if (saved) {
            FleetEnter(index = 1) {
                FleetCard(Modifier.fillMaxWidth()) {
                    SectionHeader("Saved")
                    Spacer(Modifier.height(FleetSpace.tight))
                    Text(
                        "Your fleet has the slip and the figures. You can throw the paper away.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Ash,
                    )
                    Spacer(Modifier.height(FleetSpace.snug))
                    Row(horizontalArrangement = Arrangement.spacedBy(FleetSpace.tight)) {
                        FleetOutlineButton(
                            label = "Add another",
                            onClick = {
                                jpeg = null
                                preview = null
                                litres = ""
                                amount = ""
                                station = ""
                                saved = false
                            },
                            modifier = Modifier.weight(1f),
                        )
                        FleetOutlineButton(
                            label = "Done",
                            onClick = onBack,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
            return@FleetScreen
        }

        // --- The photograph, first ------------------------------------------
        FleetEnter(index = 1) {
            Column {
                val shot = preview
                if (shot == null) {
                    SlipViewfinder(
                        capturing = capturing,
                        onCapture = { capture ->
                            capturing = true
                            capturePhoto(
                                capture = capture,
                                tag = "fuel-slip",
                                onResult = { bytes, bitmap ->
                                    capturing = false
                                    jpeg = bytes
                                    preview = bitmap
                                },
                                onFailure = {
                                    capturing = false
                                    problem = "The camera could not take the photo. Try again."
                                },
                            )
                        },
                    )
                } else {
                    Image(
                        bitmap = shot,
                        contentDescription = "The fuel slip you photographed",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .fillMaxWidth()
                            .aspectRatio(4f / 3f)
                            .clip(RoundedCornerShape(FleetRadius.card)),
                    )
                    Spacer(Modifier.height(FleetSpace.tight))
                    FleetOutlineButton(
                        label = "Take it again",
                        onClick = {
                            jpeg = null
                            preview = null
                        },
                    )
                }
                Spacer(Modifier.height(FleetSpace.base))
            }
        }

        // --- Then the two figures -------------------------------------------
        FleetEnter(index = 2) {
            FleetCard(Modifier.fillMaxWidth()) {
                Column(verticalArrangement = Arrangement.spacedBy(FleetSpace.snug)) {
                    FleetField(
                        value = litres,
                        onValueChange = { litres = it },
                        label = "Litres",
                        placeholder = "As printed on the slip",
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Decimal,
                            imeAction = ImeAction.Next,
                        ),
                    )
                    FleetField(
                        value = amount,
                        onValueChange = { amount = it },
                        label = "Amount paid (₹)",
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Decimal,
                            imeAction = ImeAction.Next,
                        ),
                    )
                    FleetField(
                        value = station,
                        onValueChange = { station = it },
                        label = "Pump name",
                        placeholder = "Optional",
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    )

                    // The rate, worked out rather than asked for. A third number
                    // to type at a pump is a third chance to mistype one — and
                    // seeing it lets a driver catch a slip of the finger.
                    if (litresValue != null && litresValue > 0 && amountValue != null) {
                        Text(
                            "That is ₹%.2f a litre.".format(amountValue / litresValue),
                            style = MaterialTheme.typography.bodySmall,
                            color = Slate,
                        )
                    }
                }
            }
        }

        problem?.let {
            Spacer(Modifier.height(FleetSpace.snug))
            FleetError(it)
        }

        Spacer(Modifier.height(FleetSpace.base))

        FleetEnter(index = 3) {
            FleetButton(
                label = "Save this slip",
                busyLabel = "Saving…",
                busy = busy,
                enabled = complete && !busy,
                onClick = {
                    val bytes = jpeg ?: return@FleetButton
                    problem = null
                    cockpit.saveFuelSlip(
                        jpeg = bytes,
                        litres = litresValue ?: 0.0,
                        totalCost = amountValue ?: 0.0,
                        // Sent where the vehicle reported one, so the office can
                        // see which pump this was without asking.
                        // The vehicle's own reading, where it has one.
                        odometerKm = state.telemetry.value(Metric.ODOMETER),
                        stationName = station.trim().ifBlank { null },
                    ) { failure ->
                        if (failure == null) saved = true else problem = failure
                    }
                },
            )
            if (jpeg == null) {
                Spacer(Modifier.height(FleetSpace.tight))
                Text(
                    "Photograph the slip first — it is the evidence for the figures.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate,
                )
            }
        }

        Spacer(Modifier.height(FleetSpace.wide))
    }
}

/**
 * A rear-camera viewfinder, framed for a till roll.
 *
 * Rear-facing, unlike the arrival selfie: this is a photograph of a piece of
 * paper held in the other hand. 4:3 because that is what a receipt fits in
 * without the driver having to hold the phone at arm's length.
 */
@Composable
private fun SlipViewfinder(
    capturing: Boolean,
    onCapture: (ImageCapture) -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val imageCapture = remember { ImageCapture.Builder().build() }
    val previewView = remember {
        PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
    }

    // Bound through `:core`, which owns the CameraX dependency and therefore
    // the Guava future its provider hands back. See `CameraBinding`.
    LaunchedEffect(lifecycleOwner) {
        CameraBinding.bind(
            context = context,
            lifecycleOwner = lifecycleOwner,
            previewView = previewView,
            preferFront = false,
            imageCapture,
        )
    }

    Column {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(4f / 3f)
                .clip(RoundedCornerShape(FleetRadius.card))
                .background(OnyxDeep),
        ) {
            AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())
        }
        Spacer(Modifier.height(FleetSpace.snug))
        FleetButton(
            label = "Photograph the slip",
            busyLabel = "Taking it…",
            busy = capturing,
            enabled = !capturing,
            onClick = { onCapture(imageCapture) },
        )
    }
}
