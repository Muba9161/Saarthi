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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.data.AccountType
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.ui.design.AlwaysDark
import com.saarthi.owner.ui.design.BrandLockup
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
    api: OwnerApi,
    onCheckAgain: suspend () -> Unit,
    onSignOut: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var checking by remember { mutableStateOf(false) }
    GateScreen(
        eyebrow = account.organizationName.ifBlank { stringResource(R.string.people_your_account) },
        icon = Lucide.pause,
        title = stringResource(R.string.people_gate_paused_title),
        lead = stringResource(R.string.people_gate_paused_lead),
        kept = listOf(
            stringResource(R.string.people_gate_kept_vehicles),
            stringResource(R.string.people_gate_kept_trips),
            stringResource(R.string.people_gate_kept_drivers),
        ),
    ) {
        SaarthiButton(
            stringResource(R.string.people_gate_check_again),
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
        OtherBusinesses(account, api)
        SaarthiButton(stringResource(R.string.people_sign_out), onClick = onSignOut, tone = ButtonTone.SECONDARY)
    }
}

/** Another business on the same login: the way out of a paused or unsupported one. */
@Composable
private fun OtherBusinesses(account: SessionStore.Account, api: OwnerApi) {
    if (account.businesses.size <= 1) return
    Eyebrow(stringResource(R.string.people_gate_switch_business), modifier = Modifier.padding(top = 8.dp))
    BusinessSwitcher(account, api)
}

/** A driver, or platform staff, who signed in to the app made for businesses. */
@Composable
fun NotForThisAppScreen(account: SessionStore.Account, api: OwnerApi, onSignOut: () -> Unit) {
    val driver = account.accountType == AccountType.DRIVER_ONLY
    GateScreen(
        eyebrow = account.fullName,
        icon = if (driver) Lucide.truck else Lucide.briefcase,
        title = stringResource(if (driver) R.string.people_gate_drivers_title else R.string.people_gate_business_title),
        lead = if (driver) {
            stringResource(R.string.people_gate_drivers_lead)
        } else if (account.businesses.size > 1) {
            if (account.organizationName.isNotBlank()) {
                stringResource(R.string.people_gate_other_business_lead, account.organizationName)
            } else {
                stringResource(R.string.people_gate_this_business_lead)
            }
        } else {
            stringResource(R.string.people_gate_no_business_lead)
        },
        kept = emptyList(),
    ) {
        OtherBusinesses(account, api)
        SaarthiButton(stringResource(R.string.people_sign_out), onClick = onSignOut, tone = ButtonTone.SECONDARY)
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
