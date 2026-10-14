package com.saarthi.owner.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.ui.design.BrandLockup
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Ease
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.brandGradient
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.rememberLoop
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger

/** Height of the header's own content, under the status bar — room for the full logo. */
val HeaderContentHeight: Dp = 76.dp

/** Space between the header and the first thing in a tab, so the two never touch. */
private val HeaderGap: Dp = 8.dp

/** What a scrolling tab leaves clear at its top: the status bar, the header and a gap. */
@Composable
fun headerClearance(): Dp =
    WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + HeaderContentHeight + HeaderGap

/** What a scrolling tab leaves clear at its foot: the floating tab bar. */
@Composable
fun tabBarClearance(): Dp = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + 110.dp

/**
 * The header over every tab: the logo, where you are, and the bell.
 *
 * It fades into the canvas below rather than ending in a line, so content
 * scrolling underneath slides away instead of being cut off.
 */
@Composable
fun OwnerHeader(
    eyebrow: String,
    title: String,
    unread: Int,
    onBell: () -> Unit,
    modifier: Modifier = Modifier,
    onAssistant: (() -> Unit)? = null,
) {
    val c = Saarthi.colors
    Row(
        modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    0f to c.canvas,
                    0.72f to c.canvas,
                    1f to c.canvas.copy(alpha = 0f),
                ),
            )
            .windowInsetsPadding(WindowInsets.statusBars)
            .height(HeaderContentHeight)
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        BrandLockup(height = 56.dp)
        Column(Modifier.weight(1f)) {
            Eyebrow(eyebrow, Modifier.rise(), maxLines = 1)
            Text(
                title,
                style = SType.headerTitle,
                color = c.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.rise(stagger(1)),
            )
        }
        CircleButton(
            Lucide.bell,
            if (unread > 0) "Alerts, $unread new" else "Alerts",
            onBell,
            iconSize = 20.dp,
            stroke = 2f,
        ) {
            if (unread > 0) UnreadBadge(unread)
        }
        onAssistant?.let { open ->
            Box(
                Modifier
                    .size(44.dp)
                    .brandGradient(CircleShape)
                    .pressable(scale = 0.92f, label = "Ask Saarthi", onClick = open),
                contentAlignment = Alignment.Center,
            ) {
                LineIcon(Lucide.sparkles, size = 20.dp, color = Color.White, stroke = 1.8f, description = "Ask Saarthi")
            }
        }
    }
}

/** The orange count on the bell, with a soft pulse so it is noticed. */
@Composable
private fun UnreadBadge(count: Int) {
    val c = Saarthi.colors
    val pulse by rememberLoop(1_100, Ease.standard, reverse = true, rest = 0f, label = "badge")
    Box(Modifier.fillMaxWidth().fillMaxHeight()) {
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .offset(x = (-5).dp, y = 6.dp)
                .drawBehind {
                    val grow = 5.dp.toPx() * pulse
                    drawRoundRect(
                        Color(0xFFFE5D09).copy(alpha = 0.5f * (1f - pulse)),
                        topLeft = Offset(-grow, -grow),
                        size = Size(size.width + grow * 2, size.height + grow * 2),
                        cornerRadius = CornerRadius(size.height),
                    )
                }
                .defaultMinSize(minWidth = 18.dp)
                .height(18.dp)
                .clip(CircleShape)
                .background(Color(0xFFFE5D09))
                .border(2.dp, c.card, CircleShape)
                .padding(horizontal = 5.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (count > 9) "9+" else count.toString(),
                style = SType.microStrong.copy(fontWeight = FontWeight.Bold, fontSize = 11.sp),
                color = Color.White,
            )
        }
    }
}

/** A registration as it is painted on the vehicle: yellow commercial plate, black mono letters. */
@Composable
fun PlateChip(registration: String, modifier: Modifier = Modifier, size: TextUnit = 13.sp) {
    Box(
        modifier
            .clip(RoundedCornerShape(6.dp))
            .background(Color(0xFFFACC15))
            .border(1.dp, Color(0x33000000), RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    ) {
        Text(formatPlate(registration), style = SType.plate(size), color = Color(0xFF18181B), maxLines = 1, softWrap = false)
    }
}
