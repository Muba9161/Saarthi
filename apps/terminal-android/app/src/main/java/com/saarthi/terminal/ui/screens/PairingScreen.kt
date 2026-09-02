package com.saarthi.terminal.ui.screens

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
import com.saarthi.terminal.network.TerminalPairingPayload
import com.saarthi.terminal.ui.Gutter
import com.saarthi.terminal.ui.PrimaryAction
import com.saarthi.terminal.ui.SaarthiWarning
import com.saarthi.terminal.ui.SectionLabel
import com.saarthi.terminal.ui.GlassCard
import com.saarthi.terminal.ui.StatusTone
import com.saarthi.terminal.ui.TerminalPage
import com.saarthi.terminal.ui.TerminalViewModel
import com.saarthi.terminal.util.DebugLog
import com.saarthi.terminal.util.DeviceEnvironment
import kotlinx.serialization.json.Json
import java.util.concurrent.Executors

/**
 * Connecting a terminal to a vehicle (specification section 9).
 *
 * Two ways in, side by side and equally weighted, because a terminal is a tablet
 * bolted into a cab: its camera gets scratched, its screen gets sun-bleached,
 * and it is frequently mounted where nothing can be held up in front of it. A
 * pairing flow that only works through a camera fails on exactly the units that
 * are hardest to reach — so the typed `STH-XXXX-XXXX` code is not a fallback
 * buried behind a link, it is the second half of the screen.
 *
 * The QR is checked for its `kind` before any network call. A code issued for a
 * Saarthi Device test phone scans perfectly here and would otherwise cost a
 * round trip and an error nobody standing at a truck could interpret.
 */
@Composable
fun PairingScreen(
    viewModel: TerminalViewModel,
    expanded: Boolean,
    onOpenAdmin: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val busy by viewModel.busy.collectAsState()
    /*
     * Held as a `TextFieldValue` so the caret can be placed deliberately.
     *
     * With a plain `String`, reformatting on every keystroke left Compose to
     * guess where the caret had gone, and it guessed wrong the moment the
     * formatter inserted a dash: the caret stayed *before* it, so the next
     * character landed mid-code. Typing STHRIG10001 produced STH-IG10-010R —
     * silently, with every character accepted and the result wrong. An
     * installer in a yard would read that as the code being rejected.
     *
     * The caret is pinned to the end after each edit, which is exactly right
     * for a fixed-shape code nobody edits in the middle of.
     */
    var code by remember { mutableStateOf(TextFieldValue("")) }
    var scanned by remember { mutableStateOf<String?>(null) }

    /**
     * Why the last scanned code was refused.
     *
     * Cleared on its own after a few seconds. The analyser sees the same QR
     * dozens of times a second, so without a timeout the message would become
     * permanent once anything wrong came into frame, including long after the
     * installer had moved on to the right code.
     */
    var scanRefusal by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(scanRefusal) {
        if (scanRefusal != null) {
            kotlinx.coroutines.delay(6_000)
            scanRefusal = null
        }
    }

    TerminalPage {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text("SAARTHI", style = MaterialTheme.typography.titleLarge, letterSpacing = 4.sp)
                Text(
                    "Connect this terminal to a vehicle",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // Reachable even here. A terminal that cannot pair is exactly the
            // terminal an engineer needs diagnostics for.
            IconButton(onClick = onOpenAdmin) {
                Icon(Icons.Rounded.Build, contentDescription = "Terminal diagnostics")
            }
        }

        Spacer(Modifier.height(Gutter))

        state.error?.let { message ->
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    message,
                    Modifier.padding(14.dp),
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Spacer(Modifier.height(Gutter))
        }

        scanRefusal?.let { message ->
            Surface(
                color = SaarthiWarning.copy(alpha = 0.16f),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    Modifier.padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Rounded.QrCodeScanner,
                        contentDescription = null,
                        tint = SaarthiWarning,
                        modifier = Modifier.size(20.dp),
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(message, style = MaterialTheme.typography.bodyMedium)
                }
            }
            Spacer(Modifier.height(Gutter))
        }

        val content: @Composable () -> Unit = {
            ScannerPanel(
                onToken = { token ->
                    if (scanned != token) {
                        scanned = token
                        scanRefusal = null
                        viewModel.pairWithToken(token)
                    }
                },
                onRejected = { reason -> scanRefusal = reason },
                modifier = if (expanded) Modifier.fillMaxHeight() else Modifier.fillMaxWidth(),
            )
        }

        val codePanel: @Composable () -> Unit = {
            GlassCard(
                modifier = if (expanded) {
                    Modifier.fillMaxHeight()
                } else {
                    Modifier.fillMaxWidth()
                },
            ) {
                SectionLabel("Or enter the pairing code")
                Spacer(Modifier.height(12.dp))
                Text(
                    "Generate it from Vehicle → Hardware in the Saarthi dashboard.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(20.dp))

                OutlinedTextField(
                    value = code,
                    onValueChange = { input ->
                        // Formatted as it is typed. Somebody entering this is
                        // reading it aloud off a phone in a yard, and matching
                        // the shape they can see is the whole reason the code
                        // has dashes in it.
                        val formatted = formatPairingCode(input.text)
                        code = TextFieldValue(
                            text = formatted,
                            selection = TextRange(formatted.length),
                        )
                    },
                    label = { Text("STH-XXXX-XXXX") },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.headlineSmall.copy(
                        fontFamily = FontFamily.Monospace,
                        letterSpacing = 4.sp,
                        textAlign = TextAlign.Center,
                    ),
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Characters,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )

                Spacer(Modifier.height(20.dp))

                PrimaryAction(
                    label = if (busy) "Connecting…" else "Connect",
                    icon = Icons.Rounded.Link,
                    enabled = !busy && code.text.length == 13,
                    onClick = { viewModel.pairWithCode(code.text) },
                    modifier = Modifier.fillMaxWidth(),
                )

                Spacer(Modifier.height(16.dp))
                Text(
                    "This terminal: ${viewModel.settings.apiUrl}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        if (expanded) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Gutter),
            ) {
                Box(Modifier.weight(1f)) { content() }
                Box(Modifier.weight(1f)) { codePanel() }
            }
        } else {
            // Stacked on a phone, and the page scrolls to reach the code entry.
            // `weight` is meaningless once the parent height is unbounded.
            Column(
                Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(Gutter),
            ) {
                content()
                codePanel()
                Spacer(Modifier.height(Gutter))
            }
        }
    }
}

/**
 * Format a pairing code as it is typed.
 *
 * Strips everything the alphabet does not contain and re-inserts the dashes, so
 * a person can paste `sth4k2p9xq7`, type it with spaces, or read it out with
 * pauses, and all three arrive as `STH-4K2P-9XQ7`.
 */
private fun formatPairingCode(input: String): String {
    val compact = input.uppercase().filter { it.isLetterOrDigit() }.take(11)
    if (compact.length <= 3) return compact
    val body = compact.drop(3)
    return buildString {
        append(compact.take(3))
        append('-')
        append(body.take(4))
        if (body.length > 4) {
            append('-')
            append(body.drop(4))
        }
    }
}

/**
 * The camera, with an ML Kit barcode analyser attached.
 *
 * Analysis runs on a single background thread with `STRATEGY_KEEP_ONLY_LATEST`:
 * a terminal is often a cheap tablet, and queueing frames on one would put the
 * scanner several seconds behind what the camera is pointed at, which reads as a
 * scanner that does not work.
 */
@Composable
private fun ScannerPanel(
    onToken: (String) -> Unit,
    onRejected: (String) -> Unit,
    modifier: Modifier = Modifier,
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
                                processFrame(proxy, scanner, json, onToken, onRejected)
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
private fun processFrame(
    proxy: ImageProxy,
    scanner: com.google.mlkit.vision.barcode.BarcodeScanner,
    json: Json,
    onToken: (String) -> Unit,
    onRejected: (String) -> Unit,
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

                val payload = runCatching {
                    json.decodeFromString(TerminalPairingPayload.serializer(), raw)
                }.getOrNull()

                if (payload == null) {
                    // Not a Saarthi pairing payload at all. A vehicle identity QR
                    // is a URL rather than JSON and lands here, which is worth
                    // naming: to somebody standing at a truck, both of them are
                    // just "the Saarthi code".
                    onRejected(describeForeignCode(raw))
                    continue
                }

                if (payload.kind != "saarthi.terminal.pair") {
                    DebugLog.info("pairing", "Refused a QR of kind ${payload.kind}")
                    onRejected(
                        if (payload.kind == "saarthi.device.pair") {
                            "That is a Saarthi Device code. In the dashboard, scroll to " +
                                "Saarthi Terminal on the vehicle's Hardware tab and use " +
                                "Connect a terminal instead."
                        } else {
                            "That is not a Saarthi Terminal pairing code."
                        },
                    )
                    continue
                }

                onToken(payload.token)
                break
            }
        }
        .addOnCompleteListener { proxy.close() }
}

/** What a non-Saarthi, or non-pairing, code appears to be. */
private fun describeForeignCode(raw: String): String = when {
    raw.contains("/q/") ->
        "That is the vehicle's identity QR, the one a driver scans to sign on. " +
            "A terminal needs a pairing code from Connect a terminal."
    raw.startsWith("http", ignoreCase = true) ->
        "That code is a web link, not a Saarthi Terminal pairing code."
    else -> "That is not a Saarthi Terminal pairing code."
}
