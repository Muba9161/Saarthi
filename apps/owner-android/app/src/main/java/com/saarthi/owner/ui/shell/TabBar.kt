package com.saarthi.owner.ui.shell

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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.ui.design.Ease
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.pressable

/**
 * The floating tab bar, with a highlight that glides to the chosen tab — the
 * driver app's bar, carrying whichever tabs this account has.
 *
 * The chosen tab's icon pops a little as it lands.
 */
@Composable
fun OwnerTabBar(
    tabs: List<Tab>,
    active: Tab,
    onSelect: (Tab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val dark = Saarthi.colors.dark
    val reduced = Saarthi.reducedMotion
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
            val cell = maxWidth / tabs.size
            val x by animateDpAsState(
                cell * tabs.indexOf(active).coerceAtLeast(0),
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
                tabs.forEach { tab ->
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
                            tab.label,
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
