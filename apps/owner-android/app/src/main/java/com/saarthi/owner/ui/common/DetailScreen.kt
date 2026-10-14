package com.saarthi.owner.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.shell.LocalNavigator

/**
 * A screen opened over a tab: back, two lines saying what it is, the content
 * scrolling beneath — and an optional action held at the foot, riding up with
 * the keyboard the way the sign-in steps do.
 *
 * Back closes it through the shell's navigator unless [onBack] says otherwise.
 */
@Composable
fun DetailScreen(
    eyebrow: String,
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    eyebrowColor: androidx.compose.ui.graphics.Color = Saarthi.colors.muted,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    spacing: Dp = 14.dp,
    footer: (@Composable ColumnScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val back = onBack ?: navigator::pop
    Column(
        modifier
            .fillMaxSize()
            .background(c.canvas)
            .windowInsetsPadding(WindowInsets.statusBars)
            .windowInsetsPadding(WindowInsets.navigationBars)
            .imePadding(),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(HeaderContentHeight)
                .padding(horizontal = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            CircleButton(Lucide.chevronLeft, "Back", back, size = 44.dp)
            Column(Modifier.weight(1f)) {
                Eyebrow(eyebrow, Modifier.rise(), color = eyebrowColor, maxLines = 1)
                Text(
                    title,
                    style = SType.headerTitle,
                    color = c.fg,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.rise(stagger(1)),
                )
            }
            trailing?.invoke(this)
        }
        Box(Modifier.weight(1f)) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(spacing),
                content = content,
            )
            // The content fades under the foot rather than ending on a hard line.
            if (footer != null) {
                Box(
                    Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .height(20.dp)
                        .background(Brush.verticalGradient(listOf(c.canvas.copy(alpha = 0f), c.canvas))),
                )
            }
        }
        if (footer != null) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(c.canvas)
                    .padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                content = footer,
            )
        }
    }
}
