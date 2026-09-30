package com.saarthi.driver.ui.design

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import com.saarthi.core.ui.LocalReducedMotion
import com.saarthi.driver.data.DriverPreferences

val LocalPalette = staticCompositionLocalOf { LightPalette }

/** The design's tokens, reachable from any composable as `Saarthi.colors`. */
object Saarthi {
    val colors: SaarthiPalette
        @Composable @ReadOnlyComposable get() = LocalPalette.current

    /**
     * Whether the driver has asked for less movement.
     *
     * Shared with `:core` on purpose — the map camera reads the same local, so
     * one switch stills the whole app rather than only the half written here.
     */
    val reducedMotion: Boolean
        @Composable @ReadOnlyComposable get() = LocalReducedMotion.current
}

/**
 * The driver app's theme.
 *
 * Material is still provided underneath, dressed in the same colours, for the
 * handful of platform pieces that read it — text selection handles, the
 * keyboard's cursor — so nothing in the app draws in Material's purple.
 */
@Composable
fun SaarthiTheme(
    appearance: DriverPreferences.Appearance,
    reducedMotion: Boolean,
    content: @Composable () -> Unit,
) {
    val dark = when (appearance) {
        DriverPreferences.Appearance.PHONE -> isSystemInDarkTheme()
        DriverPreferences.Appearance.LIGHT -> false
        DriverPreferences.Appearance.DARK -> true
    }
    val palette = if (dark) DarkPalette else LightPalette

    val scheme = if (dark) {
        darkColorScheme(
            primary = palette.primary,
            onPrimary = palette.onPrimary,
            background = palette.canvas,
            surface = palette.card,
            onBackground = palette.fg,
            onSurface = palette.fg,
            error = palette.danger,
        )
    } else {
        lightColorScheme(
            primary = palette.primary,
            onPrimary = palette.onPrimary,
            background = palette.canvas,
            surface = palette.card,
            onBackground = palette.fg,
            onSurface = palette.fg,
            error = palette.danger,
        )
    }

    MaterialTheme(colorScheme = scheme) {
        CompositionLocalProvider(
            LocalPalette provides palette,
            LocalReducedMotion provides reducedMotion,
            LocalTextSelectionColors provides TextSelectionColors(
                handleColor = palette.primary,
                backgroundColor = palette.glowStrong,
            ),
        ) {
            SystemBars(lightContent = dark)
            content()
        }
    }
}

/**
 * A part of the app that is dark whatever the appearance setting says — the
 * live map and everything floating on it, as the design paints them.
 */
@Composable
fun AlwaysDark(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalPalette provides DarkPalette) {
        SystemBars(lightContent = true)
        content()
    }
}

/**
 * Which colour the status and navigation bar icons are drawn in.
 *
 * A screen that is always dark regardless of theme — the live map, the SOS
 * confirmation, the welcome carousel — calls this with `lightContent = true`
 * so the clock stays readable; everything else inherits the theme's choice.
 * Restored when the screen leaves, so the next screen is not left with icons it
 * did not ask for.
 */
@Composable
fun SystemBars(lightContent: Boolean) {
    val view = LocalView.current
    if (view.isInEditMode) return
    DisposableEffect(lightContent) {
        val window = (view.context as? Activity)?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        val previousStatus = controller?.isAppearanceLightStatusBars
        val previousNavigation = controller?.isAppearanceLightNavigationBars
        controller?.isAppearanceLightStatusBars = !lightContent
        controller?.isAppearanceLightNavigationBars = !lightContent
        onDispose {
            if (controller != null && previousStatus != null && previousNavigation != null) {
                controller.isAppearanceLightStatusBars = previousStatus
                controller.isAppearanceLightNavigationBars = previousNavigation
            }
        }
    }
}
