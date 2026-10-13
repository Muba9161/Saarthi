package com.saarthi.owner.ui.account

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.data.AccountType
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.ui.design.AlwaysDark
import com.saarthi.owner.ui.design.BrandLockup
import com.saarthi.owner.ui.design.ButtonRow
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.bottomRule
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import kotlinx.coroutines.launch

/**
 * The business is paused — archived after its plan lapsed, or the person
 * suspended. Nothing is lost, and the screen says so before anything else.
 */
@Composable
fun PausedScreen(
    account: SessionStore.Account,
    onCheckAgain: suspend () -> Unit,
    onSignOut: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var checking by remember { mutableStateOf(false) }
    GateScreen(
        eyebrow = account.organizationName.ifBlank { "Your account" },
        icon = Lucide.pause,
        title = "This account is paused",
        lead = "Nothing has been lost. When the account is active again, everything opens exactly where you left it.",
        kept = listOf(
            "Vehicles and their papers",
            "Every trip, route and expense",
            "Drivers, orders and settlements",
        ),
    ) {
        SaarthiButton(
            "Check again",
            onClick = {
                checking = true
                scope.launch {
                    onCheckAgain()
                    checking = false
                }
            },
            busy = checking,
            leading = Lucide.refresh,
        )
        SaarthiButton("Sign out", onClick = onSignOut, tone = ButtonTone.SECONDARY)
    }
}

/** A driver, or platform staff, who signed in to the app made for businesses. */
@Composable
fun NotForThisAppScreen(account: SessionStore.Account, onSignOut: () -> Unit) {
    val driver = account.accountType == AccountType.DRIVER_ONLY
    GateScreen(
        eyebrow = account.fullName,
        icon = if (driver) Lucide.truck else Lucide.briefcase,
        title = if (driver) "Drivers have their own app" else "This app is for businesses",
        lead = if (driver) {
            "Humsafar by VorldX Saarthi is made for driving — trips, papers and the road. Sign in there with this same account."
        } else {
            "This account has no fleet, travel, customer, seller or association business to show here. Use Saarthi on the web."
        },
        kept = emptyList(),
    ) {
        SaarthiButton("Sign out", onClick = onSignOut, tone = ButtonTone.SECONDARY)
    }
}

/** A full-screen stop: a night photograph, a message, and what can be done. */
@Composable
private fun GateScreen(
    eyebrow: String,
    icon: String,
    title: String,
    lead: String,
    kept: List<String>,
    actions: @Composable () -> Unit,
) = AlwaysDark {
    val c = Saarthi.colors
    Box(
        Modifier
            .fillMaxSize()
            .background(c.canvas),
    ) {
        Image(
            painter = painterResource(R.drawable.photo_safety_night),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .fillMaxWidth()
                .height(340.dp),
        )
        Box(
            Modifier
                .fillMaxWidth()
                .height(340.dp)
                .background(Brush.verticalGradient(listOf(Color.Transparent, c.canvas))),
        )
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .windowInsetsPadding(WindowInsets.statusBars)
                .windowInsetsPadding(WindowInsets.navigationBars)
                .padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 24.dp),
        ) {
            BrandLockup(height = 56.dp, plated = true)
            Spacer(Modifier.height(200.dp))
            Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.rise()) {
                IconWell(icon, well = c.warningSoft, ink = c.warning, size = 64.dp, radius = 18.dp, iconSize = 26.dp)
                Eyebrow(eyebrow, color = c.accent, modifier = Modifier.padding(top = 6.dp))
                Text(title, style = SType.display, color = c.fg)
                Text(lead, style = SType.lead, color = c.muted)
            }
            if (kept.isNotEmpty()) {
                Spacer(Modifier.height(20.dp))
                Column(
                    Modifier
                        .fillMaxWidth()
                        .rise(stagger(1))
                        .card(radius = 22.dp),
                ) {
                    kept.forEachIndexed { index, line ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .bottomRule(c.border, show = index < kept.lastIndex)
                                .padding(horizontal = 16.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                        ) {
                            IconWell(Lucide.check, well = c.successSoft, ink = c.success, size = 32.dp, shape = CircleShape, iconSize = 16.dp)
                            Text(line, style = SType.bodyStrong, color = c.fg)
                        }
                    }
                }
            }
            Spacer(Modifier.height(28.dp))
            Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.rise(stagger(2))) {
                actions()
            }
        }
    }
}
