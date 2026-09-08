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

