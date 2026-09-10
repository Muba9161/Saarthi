package com.saarthi.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.dp

/**
 * A page frame with the system-bar padding every screen needs.
 *
 * Scrolls by default, and that default is the fix for a real bug: this was a
 * plain `Column`, so on a phone — where the vehicle QR and the detail panel
 * stack rather than sitting side by side — everything below the fold was simply
 * unreachable. On a 10-inch tablet in landscape the same screens fit and the
 * scroll never engages, which is why it went unnoticed.
 *
 * `scrollable = false` is for the screens that manage their own scrolling: a
 * `LazyColumn` inside a scrolling parent has infinite height available and
 * throws, and a full-bleed map must not scroll at all.
 */
@Composable
fun TerminalPage(
    modifier: Modifier = Modifier,
    scrollable: Boolean = true,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    /*
     * A tinted ground rather than a flat fill.
     *
     * Every panel in this app is a translucent card, and glass over one uniform
     * colour does not read as glass — it reads as a slightly different grey. The
     * gradient is what the frost has something to refract, and it is barely
     * perceptible on its own, which is the point.
     */
    val scheme = MaterialTheme.colorScheme
    val ground = Brush.linearGradient(
        listOf(
            scheme.background,
            scheme.surfaceVariant,
            scheme.background,
        ),
    )

    val base = modifier
        .fillMaxSize()
        .background(ground)
        .systemBarsPadding()

    /*
     * The page says what colour its text is.
     *
     * The ground above is painted with `Modifier.background`, and a modifier is
     * not a `Surface` — it fills pixels without telling anything inside it what
     * to write on them. So `LocalContentColor` stayed at Compose's default of
     * black, and every `Text` on a terminal screen that did not name a colour
     * of its own was drawn in black on a near-black gradient. The checklist
     * heading was the visible one: "Pre-trip safety check" was there all along
     * and simply could not be read, while the line under it — which does set
     * `onSurfaceVariant` — looked fine and made the screen appear to work.
     *
     * Set once here rather than colour by colour at each call site, because the
     * next unstyled `Text` anybody adds should be legible without them having
     * to know this.
     */
    CompositionLocalProvider(LocalContentColor provides scheme.onBackground) {
        Column(
            if (scrollable) {
                base.verticalScroll(rememberScrollState()).padding(Gutter)
            } else {
                base.padding(Gutter)
            },
            content = content,
        )
    }
}
