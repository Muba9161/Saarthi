package com.saarthi.device.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * The device app's palette.
 *
 * Dark by default rather than as an option. This app is used in a cab, often at
 * night, and a white screen on a windscreen mount is both a distraction and a
 * reflection in the glass. It borrows Saarthi's slate and sky rather than
 * inventing its own identity — it is the same product, wearing work clothes.
 *
 * Dynamic colour is deliberately not used: the status colours below have to mean
 * the same thing on every phone, and a device wallpaper that recoloured "GPS
 * active" green into something else would undo that.
 */

private val SaarthiSky = Color(0xFF38BDF8)
private val SaarthiSlate = Color(0xFF0F172A)
private val SaarthiSlateLight = Color(0xFF1E293B)

/** Status colours, fixed so they read identically on every device. */
val StatusOk = Color(0xFF22C55E)
val StatusWarn = Color(0xFFF59E0B)
val StatusBad = Color(0xFFEF4444)
val StatusIdle = Color(0xFF64748B)

private val DarkColors = darkColorScheme(
    primary = SaarthiSky,
    onPrimary = SaarthiSlate,
    secondary = Color(0xFF7DD3FC),
    background = SaarthiSlate,
    onBackground = Color(0xFFF1F5F9),
    surface = SaarthiSlateLight,
    onSurface = Color(0xFFE2E8F0),
    surfaceVariant = Color(0xFF334155),
    onSurfaceVariant = Color(0xFFCBD5E1),
    error = StatusBad,
    outline = Color(0xFF475569),
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF0284C7),
    onPrimary = Color.White,
    secondary = Color(0xFF0EA5E9),
    background = Color(0xFFF8FAFC),
    onBackground = SaarthiSlate,
    surface = Color.White,
    onSurface = SaarthiSlate,
    surfaceVariant = Color(0xFFE2E8F0),
    onSurfaceVariant = Color(0xFF475569),
    error = StatusBad,
    outline = Color(0xFFCBD5E1),
)

@Composable
fun SaarthiDeviceTheme(
    // Defaults to dark whatever the system says, for the reason above. The
    // parameter exists so a preview can show the light variant.
    darkTheme: Boolean = true,
    followSystem: Boolean = false,
    content: @Composable () -> Unit,
) {
    val useDark = if (followSystem) isSystemInDarkTheme() else darkTheme
    MaterialTheme(
        colorScheme = if (useDark) DarkColors else LightColors,
        content = content,
    )
}
