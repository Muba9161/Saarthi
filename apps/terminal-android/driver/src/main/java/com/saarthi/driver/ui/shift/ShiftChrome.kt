package com.saarthi.driver.ui.shift

import androidx.annotation.StringRes
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.BrandMark
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SosButton
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.rememberLoop
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger
import com.saarthi.core.ui.LocalReducedMotion

/** The five tabs, in the order the bar shows them. */
enum class ShiftTab(@StringRes val label: Int, val icon: String) {
    HOME(R.string.tab_home, Lucide.home),
    MAP(R.string.tab_map, Lucide.map),
    TRIPS(R.string.tab_trips, Lucide.route),
    PAPERS(R.string.tab_papers, Lucide.fileText),
    PROFILE(R.string.tab_profile, Lucide.user),
}

/** Height of the header's own content, under the status bar. */
val HeaderContentHeight: Dp = 64.dp

/** What a scrolling tab leaves clear at its top: the status bar and the header. */
@Composable
fun headerClearance(): Dp = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + HeaderContentHeight

/** What a scrolling tab leaves clear at its foot: the floating tab bar. */
@Composable
fun tabBarClearance(): Dp = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + 110.dp

/**
 * The header on Home, Trips, Papers and Profile: mark, where you are, notices, SOS.
 *
 * It fades into the canvas below rather than ending in a line, so content
 * scrolling underneath slides away instead of being cut off.
 */
@Composable
fun ShiftHeader(
    eyebrow: String,
    title: String,
    unread: Int,
    onBell: () -> Unit,
    onSos: () -> Unit,
    modifier: Modifier = Modifier,
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
        BrandMark(height = 36.dp)
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
        val bellLabel = if (unread > 0) {
            pluralStringResource(R.plurals.notices_new_label, unread, unread)
        } else {
            stringResource(R.string.notices_title)
        }
        CircleButton(Lucide.bell, bellLabel, onBell, iconSize = 20.dp, stroke = 2f) {
            if (unread > 0) UnreadBadge(unread)
        }
        SosButton(onSos)
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
                    val grow = (5.dp.toPx() * pulse)
                    drawRoundRect(
                        Color(0xFFFE5D09).copy(alpha = 0.5f * (1f - pulse)),
                        topLeft = androidx.compose.ui.geometry.Offset(-grow, -grow),
                        size = androidx.compose.ui.geometry.Size(size.width + grow * 2, size.height + grow * 2),
                        cornerRadius = androidx.compose.ui.geometry.CornerRadius(size.height),
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

/**
 * The floating tab bar, with a highlight that glides to the chosen tab.
 *
 * Dark over the map and in the dark theme; light otherwise — exactly as the
 * design paints it. The chosen tab's icon pops a little as it lands.
 */
@Composable
fun ShiftTabBar(
    active: ShiftTab,
    dark: Boolean,
    onSelect: (ShiftTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val reduced = LocalReducedMotion.current
    val bar by animateColorAsState(if (dark) Color(0xF01D1D20) else Color(0xF7FFFFFF), tween(400), label = "bar")
    val ring = if (dark) Color(0x14FFFFFF) else Color(0x0F18181B)
    val primary = if (dark) Color(0xFF8E98F5) else Color(0xFF3B47BA)
    val soft by animateColorAsState(if (dark) Color(0x2E727FF3) else Color(0xFFE5E7F5), tween(400), label = "soft")
    val muted = if (dark) Color(0xFF9F9FA8) else Color(0xFF71717A)
    val fade = if (dark) Color(0xEB0E0E10) else Color(0xEBEFEFF1)

    Box(
        modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(0f to fade.copy(alpha = 0f), 0.55f to fade))
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(start = 16.dp, end = 16.dp, bottom = 20.dp, top = 8.dp),
    ) {
        BoxWithConstraints(
            Modifier
                .fillMaxWidth()
                .height(68.dp)
                .shadow(14.dp, RoundedCornerShape(24.dp), spotColor = Color.Black.copy(alpha = if (dark) 0.75f else 0.3f))
                .clip(RoundedCornerShape(24.dp))
                .background(bar)
                .border(1.dp, ring, RoundedCornerShape(24.dp))
                .padding(6.dp),
        ) {
            val cell = maxWidth / ShiftTab.entries.size
            val x by animateDpAsState(
                cell * active.ordinal,
                if (reduced) tween(0) else tween(550, easing = Ease.out),
                label = "tab-indicator",
            )
            Box(
                Modifier
                    .offset(x = x)
                    .width(cell)
                    .height(56.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(soft),
            )
            Row(Modifier.fillMaxWidth()) {
                ShiftTab.entries.forEach { tab ->
                    val on = tab == active
                    val ink by animateColorAsState(if (on) primary else muted, tween(300), label = "tab-ink")
                    val pop = remember { Animatable(1f) }
                    LaunchedEffect(on) {
                        if (on && !reduced) {
                            pop.snapTo(0.7f)
                            pop.animateTo(1f, tween(500, easing = Ease.pop))
                        }
                    }
                    Column(
                        Modifier
                            .weight(1f)
                            .height(56.dp)
                            .clip(RoundedCornerShape(18.dp))
                            .semantics { selected = on }
                            .pressable(role = Role.Tab, scale = 1f) { onSelect(tab) },
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
                    ) {
                        LineIcon(
                            tab.icon,
                            size = 21.dp,
                            color = ink,
                            modifier = Modifier.graphicsLayer {
                                scaleX = pop.value
                                scaleY = pop.value
                                translationY = (1f - pop.value) * 6f
                            },
                        )
                        Text(
                            stringResource(tab.label),
                            style = SType.micro.copy(
                                fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium,
                                letterSpacing = 0.1.sp,
                            ),
                            color = ink,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}
