package com.saarthi.driver.ui.plate

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Build
import android.util.Size
import android.view.Surface
import android.view.ViewGroup
import android.view.WindowManager
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.lifecycle.awaitInstance
import androidx.camera.view.PreviewView
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.lifecycleScope
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.saarthi.core.ui.CameraBinding
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Brand
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.breathing
import com.saarthi.driver.ui.design.popIn
import com.saarthi.driver.ui.design.rememberLoop
import com.saarthi.driver.ui.start.NoCamera
import com.saarthi.driver.ui.start.drawBrackets
import com.saarthi.driver.ui.start.rememberCameraAccess
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** How long the confirmed plate stays on screen before the scanner closes. */
private const val CONFIRM_MS = 650L

private val Found = Color(0xFF4ADE80)

/**
 * The number-plate reader: a full-screen camera that fills the vehicle number in.
 *
 * Point it at a plate and it does the rest — no shutter. What it reads is shown
 * as it reads, so a rider can see it settling on the right number; once two
 * frames agree it turns green, buzzes once and hands the number back. It only
 * ever fills a field the person can still correct: nothing is sent from here.
 *
 * A dialog rather than a sheet, so it covers the whole screen from inside a
 * scrolling form, and Back closes it.
 */
@Composable
internal fun PlateScanner(onPlate: (String) -> Unit, onDismiss: () -> Unit) {
    // Read from the activity, outside the dialog: a dialog's content is handed
    // no insets, which put the hint under the gesture bar and, held sideways,
    // the close button off the edge.
    val safe = WindowInsets.safeDrawing.asPaddingValues()
    FollowSensorWhileOpen()
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        FullScreenWindow()
        val camera = rememberCameraAccess()
        val haptics = LocalHapticFeedback.current
        var reading by remember { mutableStateOf<String?>(null) }
        var found by remember { mutableStateOf<String?>(null) }
        var preparing by remember { mutableStateOf(false) }
        val handOver by rememberUpdatedState(onPlate)

        LaunchedEffect(found) {
            val plate = found ?: return@LaunchedEffect
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            delay(CONFIRM_MS)
            handOver(plate)
        }

        Box(
            Modifier
                .fillMaxSize()
                .background(Color(0xFF0B0D12)),
        ) {
            if (camera.granted) {
                PlateCamera(
                    onReading = { reading = it },
                    onPlate = { found = it },
                    onPreparing = { preparing = it },
                    modifier = Modifier.fillMaxSize(),
                )
            }
            // The picture runs edge to edge; everything over it keeps clear of
            // the bars and the camera cutout.
            Box(
                Modifier
                    .fillMaxSize()
                    .padding(safe),
            ) {
                if (camera.granted) {
                    Viewfinder(found != null)
                    ReadingPanel(reading = found ?: reading, confirmed = found != null, preparing = preparing)
                } else {
                    NoCamera(onAllow = camera.request, message = stringResource(R.string.plate_scan_camera_needed))
                }
                TopBar(onDismiss)
            }
        }
    }
}

/**
 * The dialog's window across the whole display, cutout included.
 *
 * Left alone, a dialog held sideways is moved clear of the camera cutout but
 * keeps the display's full width, so it hangs off the far edge.
 */
@Composable
private fun FullScreenWindow() {
    val window = (LocalView.current.parent as? DialogWindowProvider)?.window ?: return
    SideEffect {
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
    }
}

/**
 * Turns with the phone while the scanner is open, rotation lock or not.
 *
 * A plate is wide, and held sideways it fills the picture — twice the pixels
 * for the reader. The app's own setting comes back when the scanner closes.
 */
@Composable
private fun FollowSensorWhileOpen() {
    val activity = LocalContext.current.findActivity() ?: return
    DisposableEffect(activity) {
        val before = activity.requestedOrientation
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
        onDispose { activity.requestedOrientation = before }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

@Composable
private fun BoxScope.TopBar(onClose: () -> Unit) {
    Row(
        Modifier
            .align(Alignment.TopCenter)
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Eyebrow(stringResource(R.string.plate_scan_title), color = Color.White.copy(alpha = 0.85f))
        CircleButton(
            Lucide.close,
            stringResource(R.string.plate_scan_close),
            onClose,
            background = Color.White.copy(alpha = 0.14f),
            ink = Color.White,
            elevated = false,
        )
    }
}

/**
 * The plate-shaped frame: saffron brackets with a sweep while it looks, snapping
 * green once the number is confirmed. A guide for the rider; the reader itself
 * looks at the whole picture, so a plate just outside the frame still reads.
 *
 * Held sideways, the frame takes most of the screen — between the title above
 * and the reading below — and the sweep runs left to right, along the plate.
 */
@Composable
private fun BoxScope.Viewfinder(confirmed: Boolean) {
    val sweep by rememberLoop(1_400, Ease.standard, reverse = true, rest = 0.5f, label = "plate-sweep")
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    Box(
        Modifier
            .align(Alignment.Center)
            .then(
                if (landscape) {
                    Modifier
                        .fillMaxSize()
                        .padding(start = 48.dp, end = 48.dp, top = 64.dp, bottom = 100.dp)
                } else {
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 28.dp)
                        .aspectRatio(2f)
                },
            ),
    ) {
        if (confirmed) {
            Canvas(Modifier.matchParentSize().popIn(from = 1.12f)) { drawBrackets(Found, 3.dp.toPx()) }
        } else {
            Canvas(Modifier.matchParentSize().breathing(periodMs = 2_400, low = 0.55f)) {
                drawBrackets(Brand.saffron, 2.4.dp.toPx())
            }
            Canvas(Modifier.matchParentSize()) {
                val glow = listOf(Brand.saffron.copy(alpha = 0f), Brand.saffron.copy(alpha = 0.95f), Brand.saffron.copy(alpha = 0f))
                val stroke = 2.dp.toPx()
                if (landscape) {
                    // A vertical line travelling along the plate.
                    val x = size.width * (0.06f + 0.88f * sweep)
                    val top = size.height * 0.1f
                    val bottom = size.height * 0.9f
                    drawLine(Brush.verticalGradient(glow, startY = top, endY = bottom), Offset(x, top), Offset(x, bottom), stroke)
                } else {
                    val y = size.height * (0.12f + 0.76f * sweep)
                    val left = size.width * 0.08f
                    val right = size.width * 0.92f
                    drawLine(Brush.horizontalGradient(glow, startX = left, endX = right), Offset(left, y), Offset(right, y), stroke)
                }
            }
        }
    }
}

/** What has been read so far, drawn as a plate, over the hint that says what to do. */
@Composable
private fun BoxScope.ReadingPanel(reading: String?, confirmed: Boolean, preparing: Boolean) {
    // Sideways it packs tight, inside the band the frame leaves free.
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    Column(
        Modifier
            .align(Alignment.BottomCenter)
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.7f))))
            .padding(
                start = 24.dp,
                end = 24.dp,
                top = if (landscape) 8.dp else 40.dp,
                bottom = if (landscape) 10.dp else 28.dp,
            ),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(if (landscape) 4.dp else 14.dp),
    ) {
        Box(Modifier.height(52.dp), contentAlignment = Alignment.Center) {
            AnimatedContent(
                targetState = reading,
                transitionSpec = { fadeIn(tween(200)) togetherWith fadeOut(tween(120)) },
                label = "plate-reading",
            ) { plate ->
                if (plate != null) {
                    Text(
                        plate,
                        style = SType.plate(22.sp),
                        color = Color(0xFF18181B),
                        maxLines = 1,
                        modifier = Modifier
                            .semantics { liveRegion = LiveRegionMode.Polite }
                            .shadow(10.dp, RoundedCornerShape(12.dp))
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (confirmed) Found else Color.White)
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                    )
                }
            }
        }
        Text(
            stringResource(if (preparing) R.string.plate_scan_preparing else R.string.plate_scan_hint),
            style = SType.small,
            color = Color.White.copy(alpha = 0.85f),
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * The rear camera with the text recogniser on every frame it can keep up with.
 *
 * Frames are analysed one at a time with `STRATEGY_KEEP_ONLY_LATEST`, so the
 * reader is never behind what the camera points at. Analysis asks for 720p: a
 * plate across a lane is only a few dozen pixels tall at the default 480p.
 *
 * Released as the scanner closes — the camera is bound to the activity and
 * would otherwise keep running behind the form.
 */
@Composable
private fun PlateCamera(
    onReading: (String) -> Unit,
    onPlate: (String) -> Unit,
    onPreparing: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val latestReading by rememberUpdatedState(onReading)
    val latestPlate by rememberUpdatedState(onPlate)
    val latestPreparing by rememberUpdatedState(onPreparing)
    val preview = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    // Read under the configuration so a turn of the phone recomposes this, and
    // rebinds: the recogniser only reads text the right way up, and the frames
    // are rotated for the screen as it was when the camera was bound.
    val orientation = LocalConfiguration.current.orientation
    val rotation = LocalView.current.display?.rotation ?: Surface.ROTATION_0

    DisposableEffect(lifecycleOwner, orientation, rotation) {
        val executor = Executors.newSingleThreadExecutor()
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        // Touched only from ML Kit's listeners, which run on the main thread.
        val consensus = PlateConsensus()
        val done = AtomicBoolean(false)

        val analysis = ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setResolutionSelector(
                ResolutionSelector.Builder()
                    .setResolutionStrategy(
                        ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER),
                    )
                    .build(),
            )
            .setTargetRotation(rotation)
            .build()

        analysis.setAnalyzer(executor) { proxy ->
            val input = proxy.toInputImage()
            if (input == null || done.get()) {
                proxy.close()
                return@setAnalyzer
            }
            recognizer.process(input)
                .addOnSuccessListener { text ->
                    if (done.get()) return@addOnSuccessListener
                    latestPreparing(false)
                    val lines = text.textBlocks
                        .flatMap { it.lines }
                        .sortedBy { it.boundingBox?.top ?: 0 }
                        .map { it.text }
                    val plate = PlateReading.read(lines)
                    val agreed = consensus.offer(plate)
                    // A one-frame misread is never shown: only what two frames agree on.
                    if (plate != null && consensus.seen(plate) >= 2) latestReading(plate)
                    if (agreed != null && done.compareAndSet(false, true)) latestPlate(agreed)
                }
                .addOnFailureListener { error ->
                    // The model is still being fetched by Play services: say so, keep trying.
                    if ((error as? MlKitException)?.errorCode == MlKitException.UNAVAILABLE) latestPreparing(true)
                }
                .addOnCompleteListener { proxy.close() }
        }

        CameraBinding.bind(context, lifecycleOwner, preview, preferFront = false, analysis)
        onDispose {
            done.set(true)
            analysis.clearAnalyzer()
            executor.shutdown()
            recognizer.close()
            lifecycleOwner.lifecycleScope.launch {
                runCatching { ProcessCameraProvider.awaitInstance(context).unbindAll() }
            }
        }
    }
    AndroidView(factory = { preview }, modifier = modifier)
}

/** The frame as ML Kit wants it, upright; null when CameraX handed over no image. */
@androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
private fun ImageProxy.toInputImage(): InputImage? =
    image?.let { InputImage.fromMediaImage(it, imageInfo.rotationDegrees) }
