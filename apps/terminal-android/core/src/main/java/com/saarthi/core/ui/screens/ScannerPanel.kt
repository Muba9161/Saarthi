package com.saarthi.core.ui.screens

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.saarthi.core.network.TerminalPairingPayload
import com.saarthi.core.ui.Gutter
import com.saarthi.core.ui.PrimaryAction
import com.saarthi.core.ui.SaarthiWarning
import com.saarthi.core.ui.SectionLabel
import com.saarthi.core.ui.GlassCard
import com.saarthi.core.ui.StatusTone
import com.saarthi.core.ui.TerminalPage
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.core.util.DebugLog
import com.saarthi.core.util.DeviceEnvironment
import kotlinx.serialization.json.Json
import java.util.concurrent.Executors

/**
 * A camera that reads one QR code.
 *
 * Shared because both apps point a camera at a square and wait. A fitted tablet
 * reads a pairing code carried to it by a fitter; a driver's phone reads the
 * code stuck to the vehicle. What differs is only what happens next, which is
 * why `onCode` is a parameter and everything else here is not.
 */
/**
 * The camera, with an ML Kit barcode analyser attached.
 *
 * Analysis runs on a single background thread with `STRATEGY_KEEP_ONLY_LATEST`:
 * a terminal is often a cheap tablet, and queueing frames on one would put the
 * scanner several seconds behind what the camera is pointed at, which reads as a
 * scanner that does not work.
 */
@Composable
fun ScannerPanel(
    onToken: (String) -> Unit,
    onRejected: (String) -> Unit,
    modifier: Modifier = Modifier,
    /**
     * What this app is looking for in a square.
     *
     * The camera, the preview, the permission handling and the frame pump are
     * identical for both apps; only the meaning of what is read differs. A
     * fitted tablet wants a terminal pairing payload, a driver's phone wants the
     * vehicle identity code stuck to the truck — and neither should have to
     * carry its own copy of CameraX to say so.
     *
     * Returns the token to act on, or null when the code is not the kind this
     * app is looking for. `onRejected` then explains it, because to somebody
     * standing at a truck every Saarthi QR looks the same.
     */
    accept: (raw: String) -> ScanResult = ::terminalPairingCode,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    /*
     * Whether the camera may be used — re-read, not decided once.
     *
     * This was a keyless `remember`, so it captured the answer at the instant
     * the pairing screen first composed. On a fresh install that is *before* the
     * installer has answered the permission dialog, and the value never changed
     * afterwards: the panel showed "Camera unavailable on this terminal" for the
     * rest of the process lifetime, on a tablet whose camera was working and
     * whose permission had just been granted. The only way out was to kill the
     * app, which nobody thinks to do because the message says the hardware is
     * missing.
     *
     * Now it is re-checked whenever the screen resumes — which covers the grant
     * dialog closing, and a return from Android's settings page.
     */
    var hasCamera by remember {
        mutableStateOf(DeviceEnvironment.hasPermission(context, Manifest.permission.CAMERA))
    }

    val cameraPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> hasCamera = granted }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                hasCamera = DeviceEnvironment.hasPermission(context, Manifest.permission.CAMERA)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    GlassCard(modifier) {
        SectionLabel("Scan the pairing code")
        Spacer(Modifier.height(12.dp))

        if (!hasCamera) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f)
                    .clip(RoundedCornerShape(16.dp))
                    .padding(Gutter),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        Icons.Rounded.CameraAlt,
                        contentDescription = null,
                        modifier = Modifier.size(48.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        // Two different situations, and the installer can only
                        // act on one of them. Saying "unavailable" for both sent
                        // somebody looking for a hardware fault on a tablet that
                        // was simply waiting to be asked.
                        if (DeviceEnvironment.hasCameraHardware(context)) {
                            "Saarthi needs the camera to scan a pairing code."
                        } else {
                            "This terminal has no camera. Use the pairing code instead."
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                    if (DeviceEnvironment.hasCameraHardware(context)) {
                        Spacer(Modifier.height(16.dp))
                        PrimaryAction(
                            label = "Allow camera",
                            icon = Icons.Rounded.CameraAlt,
                            tone = StatusTone.INFO,
                            onClick = { cameraPermission.launch(Manifest.permission.CAMERA) },
                        )
                    }
                }
            }
            return@GlassCard
        }

        val executor = remember { Executors.newSingleThreadExecutor() }
        val scanner = remember {
            BarcodeScanning.getClient(
                com.google.mlkit.vision.barcode.BarcodeScannerOptions.Builder()
                    .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                    .build(),
            )
        }
        val json = remember { Json { ignoreUnknownKeys = true } }

        DisposableEffect(Unit) {
            onDispose {
                executor.shutdown()
                scanner.close()
            }
        }

        AndroidView(
            factory = { viewContext ->
                val previewView = PreviewView(viewContext).apply {
                    scaleType = PreviewView.ScaleType.FILL_CENTER
                }
                val providerFuture = ProcessCameraProvider.getInstance(viewContext)

                providerFuture.addListener({
                    val provider = providerFuture.get()

                    val preview = Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }

                    val analysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                        .also { imageAnalysis ->
                            imageAnalysis.setAnalyzer(executor) { proxy ->
                                processFrame(proxy, scanner, json, onToken, onRejected, accept)
                            }
                        }

                    runCatching {
                        provider.unbindAll()
                        provider.bindToLifecycle(
                            lifecycleOwner,
                            // The rear camera: an installer holds a phone up to
                            // the tablet, and the tablet's front camera is
                            // pointed at the installer's face.
                            CameraSelector.DEFAULT_BACK_CAMERA,
                            preview,
                            analysis,
                        )
                    }.onFailure { error ->
                        DebugLog.error("pairing", "Could not open the camera", error)
                    }
                }, ContextCompat.getMainExecutor(viewContext))

                previewView
            },
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(RoundedCornerShape(16.dp)),
        )

        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Rounded.QrCodeScanner,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "Hold the code steady inside the frame.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * Read one frame, and accept only a Saarthi *terminal* pairing code.
 *
 * The `kind` check is the important line: a device pairing QR, a vehicle
 * identity QR and an unrelated code all scan perfectly here.
 *
 * Refusing them is right. Refusing them **silently** was not, and that was a
 * real defect — the two pairing dialogs in the dashboard look almost identical,
 * an installer who opens the wrong one scans a code that is genuinely valid, and
 * a camera that does nothing reads as a camera that is broken. Every rejection
 * now says what was scanned and where to find the right code.
 */
@androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
internal fun processFrame(
    proxy: ImageProxy,
    scanner: com.google.mlkit.vision.barcode.BarcodeScanner,
    json: Json,
    onToken: (String) -> Unit,
    onRejected: (String) -> Unit,
    accept: (raw: String) -> ScanResult,
) {
    val image = proxy.image
    if (image == null) {
        proxy.close()
        return
    }

    val input = InputImage.fromMediaImage(image, proxy.imageInfo.rotationDegrees)
    scanner.process(input)
        .addOnSuccessListener { barcodes ->
            for (barcode in barcodes) {
                val raw = barcode.rawValue ?: continue

                when (val result = accept(raw)) {
                    is ScanResult.Accepted -> {
                        onToken(result.token)
                        break
                    }

                    is ScanResult.Refused -> {
                        onRejected(result.reason)
                        continue
                    }
                }

            }
        }
        .addOnCompleteListener { proxy.close() }
}

/** What a non-Saarthi, or non-pairing, code appears to be. */
internal fun describeForeignCode(raw: String): String = when {
    raw.contains("/q/") ->
        "That is the vehicle's identity QR, the one a driver scans to sign on. " +
            "A terminal needs a pairing code from Connect a terminal."
    raw.startsWith("http", ignoreCase = true) ->
        "That code is a web link, not a Saarthi Terminal pairing code."
    else -> "That is not a Saarthi Terminal pairing code."
}
