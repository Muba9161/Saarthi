package com.saarthi.driver.ui.design

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * A stroked line icon, drawn from the same SVG path data the design uses.
 *
 * The design's icons are Lucide outlines on a 24-unit grid with round caps and
 * joins, and a Material icon beside one looks like it came from another app. So
 * the paths are carried verbatim and drawn here; [stroke] is in grid units, as
 * the design's `stroke-width` is.
 *
 * Decorative by default. Pass [description] only when the icon is the only
 * thing that says what a control does.
 */
@Composable
fun LineIcon(
    path: String,
    modifier: Modifier = Modifier,
    size: Dp = 20.dp,
    color: Color = Saarthi.colors.fg,
    stroke: Float = 2f,
    fill: String? = null,
    description: String? = null,
) {
    val outline = remember(path) { PathParser().parsePathString(path).toPath() }
    val solid = remember(fill) { fill?.let { PathParser().parsePathString(it).toPath() } }
    Canvas(
        modifier
            .size(size)
            .then(
                if (description != null) {
                    Modifier.semantics { contentDescription = description }
                } else {
                    Modifier
                },
            ),
    ) {
        scale(this.size.width / 24f, this.size.height / 24f, pivot = Offset.Zero) {
            drawPath(
                outline,
                color = color,
                style = Stroke(width = stroke, cap = StrokeCap.Round, join = StrokeJoin.Round),
            )
            solid?.let { drawPath(it, color = color) }
        }
    }
}

/** The icon paths, lifted from the design files. */
object Lucide {
    const val chevronLeft = "m15 18-6-6 6-6"
    const val chevronRight = "m9 18 6-6-6-6"
    const val close = "M18 6 6 18M6 6l12 12"
    const val arrowRight = "M5 12h14M12 5l7 7-7 7"
    const val arrowLeft = "M19 12H5M12 19l-7-7 7-7"
    const val arrowUp = "M12 19V5M5 12l7-7 7 7"
    const val arrowDown = "M12 5v14M19 12l-7 7-7-7"
    const val check = "M20 6 9 17l-5-5"
    const val bell = "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"
    const val siren =
        "M7 18v-6a5 5 0 1 1 10 0v6M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"
    const val home = "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"
    const val map =
        "M14.1 5.4 9.9 3.3a2 2 0 0 0-1.8 0L3.5 5.6A1 1 0 0 0 3 6.5v13.2a.8.8 0 0 0 1.2.7l3.9-2a2 2 0 0 1 1.8 0l4.2 2.1a2 2 0 0 0 1.8 0l4.6-2.3a1 1 0 0 0 .5-.9V4.1a.8.8 0 0 0-1.2-.7l-3.9 2a2 2 0 0 1-1.8 0ZM9 3.2v15M15 5.8v15"
    const val route =
        "M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM9 16h6.5a3.5 3.5 0 0 0 0-7H9.5a3.5 3.5 0 0 1 0-7H15"
    const val fileText =
        "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"
    const val file = "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4"
    const val user = "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
    const val users =
        "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
    const val mapPin =
        "M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0ZM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
    const val mic = "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v3"
    const val truck =
        "M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14M17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
    const val bluetooth = "m7 7 10 10-5 5V2l5 5L7 17"
    const val receipt = "M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .7V2l-3 2-3-2-3 2-3-2-3 2zM8 8h8M8 12h8M8 16h5"
    const val download =
        "M12 2v8M16 6l-4 4-4-4M8 14H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-4"
    const val volume =
        "M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5ZM16 9a5 5 0 0 1 0 6M19.4 18.4a9 9 0 0 0 0-12.8"
    const val volumeOff =
        "M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5ZM22 9l-6 6M16 9l6 6"
    const val maximize =
        "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"
    const val minimize =
        "M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"
    const val crosshair = "M12 2v3M12 19v3M2 12h3M19 12h3M5 12a7 7 0 1 0 14 0 7 7 0 1 0-14 0"
    const val crosshairDot = "M9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0"
    const val gauge = "m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0"
    const val search = "M3 11a8 8 0 1 0 16 0 8 8 0 1 0-16 0M21 21l-4.3-4.3"
    const val fingerprint =
        "M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4M14 13.12c0 2.38 0 6.38-1 8.88M2 12a10 10 0 0 1 18-6M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2M9 6.8a6 6 0 0 1 9 5.2v2"
    const val fingerprintFull =
        "M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4M14 13.12c0 2.38 0 6.38-1 8.88M17.29 21.02c.12-.6.43-2.3.5-3.02M2 12a10 10 0 0 1 18-6M2 16h.01M21.8 16c.2-2 .131-5.354 0-6M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2M8.65 22c.21-.66.45-1.32.57-2M9 6.8a6 6 0 0 1 9 5.2v2"
    const val lock = "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM7 11V7a5 5 0 0 1 10 0v4"
    const val mail =
        "M22 7l-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
    const val atSign = "M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"
    const val eye = "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7ZM9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0"
    const val eyeOff =
        "M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20M14.12 14.12a3 3 0 1 1-4.24-4.24"
    const val timer = "M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"
    const val shield =
        "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
    const val shieldCheck = shield + "M9 12l2 2 4-4"
    const val camera =
        "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3zM9 13a3 3 0 1 0 6 0 3 3 0 1 0-6 0"
    const val qr =
        "M4 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM15 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1ZM14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"
    const val hash = "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"
    const val key =
        "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"
    const val keyDot = "M16 7.5a.5.5 0 1 0 1 0 .5.5 0 1 0-1 0"
    const val info = "M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0M12 16v-4M12 8h.01"
    const val ban = "M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0M4.9 4.9l14.2 14.2"
    const val xCircle = "M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0M15 9l-6 6M9 9l6 6"
    const val alertTriangle = "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01"
    const val cloudOff =
        "m2 2 20 20M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"
    const val logout = "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
    const val navigation = "m3 11 19-9-9 19-2-8-8-2z"
    const val send = "m22 2-7 20-4-9-9-4ZM22 2 11 13"
    const val languages = "m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"
    const val calculator =
        "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM8 6h8M16 14v4M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01"
    const val fuel =
        "M3 22h12M4 9h10M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"
    const val wrench =
        "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"
    const val tyre = "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
    const val parking = "M3 3h18v18H3zM9 17V7h4a3 3 0 0 1 0 6H9"
    const val food = "M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"
    const val hospital =
        "M12 6v4M14 14h-4M14 18h-4M14 8h-4M18 12h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2M18 22V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v18"
    const val scale = "M12 3v18M5 21h14M3 7h18M6 7l-3 7a3 3 0 0 0 6 0ZM18 7l-3 7a3 3 0 0 0 6 0Z"
    const val creditCard = "M2 7h20v10H2zM6 11h4"
    const val cpu = "M4 4h16v16H4zM8 8h8v8H8zM12 2v2M12 20v2M2 12h2M20 12h2"
    const val refresh =
        "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5"
    const val tyreCheck = "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v6M12 16v6M2 12h6M16 12h6"
    const val bulb = "M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z"
    const val clock = "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2"
    const val box =
        "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.3 7 12 12l8.7-5M12 22V12"
    const val person = "M8 8a4 4 0 1 0 8 0 4 4 0 1 0-8 0M4 21v-1a6 6 0 0 1 12 0v1"
    const val backspace = "M10 5a2 2 0 0 0-1.34.52l-6.34 5.74a1 1 0 0 0 0 1.48l6.34 5.74A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2ZM12 9l6 6M18 9l-6 6"

    // Manoeuvres, for the turn card.
    const val turnLeft = "M9 14 4 9l5-5M20 20v-7a4 4 0 0 0-4-4H4"
    const val turnRight = "m15 14 5-5-5-5M4 20v-7a4 4 0 0 1 4-4h12"
    const val slightLeft = "M7 17V7h10M17 17 7 7"
    const val slightRight = "M7 7h10v10M7 17 17 7"
    const val uTurn = "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"
    const val roundabout = "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5"
    const val fork = "M16 3h5v5M8 3H3v5M12 22v-8.3a4 4 0 0 0-1.17-2.87L3 3M15 9l6-6"
    const val flag = "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"
}
