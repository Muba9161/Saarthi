package com.saarthi.owner.ui.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.saarthi.owner.BuildConfig
import com.saarthi.owner.data.OwnerPreferences
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.data.roleLabel
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.design.Appearance
import com.saarthi.owner.ui.design.Avatar
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SegmentedControl
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.lock.confirmPerson
import com.saarthi.owner.ui.lock.canLockApp
import com.saarthi.owner.ui.design.SaarthiSwitch
import com.saarthi.owner.ui.design.IconWell
import androidx.compose.ui.platform.LocalContext

/**
 * Who is signed in, the plan, verification and profile the web holds for
 * them, how the app looks, where to get help, and the way out.
 *
 * The plan is named so the owner can see what the business is on; changing
 * it happens on the web, and this screen does not offer it.
 */
@Composable
fun AccountScreen(
    account: SessionStore.Account,
    preferences: OwnerPreferences,
    api: OwnerApi,
    onSignOut: () -> Unit,
) {
    val c = Saarthi.colors
    val appearance by preferences.appearance.collectAsStateWithLifecycle()
    var signingOut by remember { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = headerClearance(), bottom = tabBarClearance()),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .rise()
                .card(radius = 24.dp)
                .padding(18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Avatar(account.fullName, size = 64.dp, background = c.primarySoft, ink = c.primary)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(account.fullName, style = SType.cardTitle.copy(fontSize = SType.headerTitle.fontSize), color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    listOf(roleLabel(account.membershipRole), account.organizationName)
                        .filter { it.isNotBlank() }
                        .joinToString(" · "),
                    style = SType.small,
                    color = c.muted,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                account.planName?.let {
                    // The plan's real status is in the Plan card below; this only names it.
                    StatusPill(
                        it.replace("Supplier", "Seller"),
                        background = c.successBg,
                        ink = c.success,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                Text(account.email, style = SType.caption, color = c.subtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }

        AccountDetails(account, api)

        GroupLabel("Appearance")
        SegmentedControl(
            options = listOf("Phone", "Light", "Dark"),
            selected = appearance.ordinal,
            onSelect = { preferences.setAppearance(Appearance.entries[it]) },
            modifier = Modifier.rise(stagger(1)),
        )

        if (account.businesses.size > 1) {
            GroupLabel("Your businesses")
            BusinessSwitcher(account, api)
        }

        GroupLabel("Security")
        AppLockRow(preferences)

        HelpLinks()

        GroupLabel("Session")
        SaarthiButton(
            "Sign out",
            onClick = {
                signingOut = true
                onSignOut()
            },
            busy = signingOut,
            busyText = "Signing out…",
            tone = ButtonTone.DANGER_OUTLINE,
            leading = Lucide.logout,
            modifier = Modifier.rise(stagger(2)),
        )

        Text(
            "VorldX Saarthi ${BuildConfig.VERSION_NAME}",
            style = SType.caption,
            color = c.subtle,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
        )
    }
}

/**
 * App lock: fingerprint, face or the phone's screen lock before the app opens.
 *
 * Switching it on asks once first — a switch that says the app is locked
 * should not be believable until the phone has recognised its owner.
 */
@Composable
private fun AppLockRow(preferences: OwnerPreferences) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val on by preferences.appLock.collectAsStateWithLifecycle()
    val available = remember { canLockApp(context) }
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(Lucide.fingerprint, well = c.primarySoft, ink = c.primary, size = 40.dp, radius = 12.dp, iconSize = 18.dp)
        Column(Modifier.weight(1f)) {
            Text("App lock", style = SType.bodyStrong, color = c.fg)
            Text(
                if (available) "Fingerprint, face or screen lock to open" else "Set up a screen lock on this phone first",
                style = SType.caption,
                color = c.muted,
            )
        }
        SaarthiSwitch(
            checked = on,
            enabled = available,
            label = "App lock",
            onCheckedChange = { wanted ->
                if (!wanted) {
                    preferences.setAppLock(false)
                } else {
                    confirmPerson(context, "Turn on App lock", "Confirm it's you") { ok ->
                        if (ok) preferences.setAppLock(true)
                    }
                }
            },
        )
    }
}
