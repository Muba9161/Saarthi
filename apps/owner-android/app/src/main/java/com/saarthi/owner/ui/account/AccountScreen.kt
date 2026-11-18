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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.saarthi.owner.BuildConfig
import com.saarthi.owner.R
import com.saarthi.owner.data.OwnerPreferences
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.AccountApi
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.network.PlacesApi
import com.saarthi.owner.ui.common.Language
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.design.Appearance
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SegmentedControl
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.lock.AppLockSession
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
    places: PlacesApi,
    onSignOut: () -> Unit,
) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val accountApi = remember(api) { AccountApi(api) }
    val appearance by preferences.appearance.collectAsStateWithLifecycle()
    var signingOut by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }

    // The photo and cover may have changed on the web since the session was read.
    LaunchedEffect(Unit) { runCatching { api.refreshSession() } }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = headerClearance(), bottom = tabBarClearance()),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        ProfileHeader(account, Modifier.rise())

        AccountDetails(account, api, places, reload, onReload = { reload++ })

        GroupLabel(stringResource(R.string.people_account_appearance))
        SegmentedControl(
            options = listOf(
                stringResource(R.string.people_account_appearance_phone),
                stringResource(R.string.people_account_appearance_light),
                stringResource(R.string.people_account_appearance_dark),
            ),
            selected = appearance.ordinal,
            onSelect = { preferences.setAppearance(Appearance.entries[it]) },
            modifier = Modifier.rise(stagger(1)),
        )

        GroupLabel(stringResource(R.string.people_account_language))
        ActionRow(
            Lucide.languages,
            Language.current(LocalContext.current)?.nativeName ?: stringResource(R.string.people_account_language_phone_default),
            stringResource(R.string.people_account_language_detail),
        ) {
            navigator.push("language") { LanguageScreen() }
        }

        if (account.businesses.size > 1) {
            GroupLabel(stringResource(R.string.people_account_businesses))
            BusinessSwitcher(account, api)
        }

        GroupLabel(stringResource(R.string.people_account_security))
        ActionRow(Lucide.lock, stringResource(R.string.people_account_change_password), stringResource(R.string.people_account_change_password_detail)) {
            navigator.push("change-password") { PasswordScreen(accountApi) {} }
        }
        AppLockRow(preferences)

        HelpLinks()

        GroupLabel(stringResource(R.string.people_account_session))
        SaarthiButton(
            stringResource(R.string.people_sign_out),
            onClick = {
                signingOut = true
                onSignOut()
            },
            busy = signingOut,
            busyText = stringResource(R.string.people_account_signing_out),
            tone = ButtonTone.DANGER_OUTLINE,
            leading = Lucide.logout,
            modifier = Modifier.rise(stagger(2)),
        )

        Text(
            "${stringResource(R.string.app_name)} ${BuildConfig.VERSION_NAME}",
            style = SType.caption,
            color = c.subtle,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
        )
    }
}

@Composable
private fun ActionRow(icon: String, title: String, detail: String, onOpen: () -> Unit) {
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 22.dp)
            .pressable(scale = 0.99f, label = title, onClick = onOpen)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(icon, well = c.primarySoft, ink = c.primary, size = 40.dp, radius = 12.dp, iconSize = 18.dp)
        Column(Modifier.weight(1f)) {
            Text(title, style = SType.bodyStrong, color = c.fg)
            Text(detail, style = SType.caption, color = c.muted)
        }
        LineIcon(Lucide.chevronRight, size = 16.dp, color = c.subtle)
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
    val promptTitle = stringResource(R.string.people_account_app_lock_prompt_title)
    val promptSubtitle = stringResource(R.string.people_account_app_lock_prompt_subtitle)
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
            Text(stringResource(R.string.people_account_app_lock), style = SType.bodyStrong, color = c.fg)
            Text(
                stringResource(if (available) R.string.people_account_app_lock_detail else R.string.people_account_app_lock_unavailable),
                style = SType.caption,
                color = c.muted,
            )
        }
        SaarthiSwitch(
            checked = on,
            enabled = available,
            label = stringResource(R.string.people_account_app_lock),
            onCheckedChange = { wanted ->
                if (!wanted) {
                    preferences.setAppLock(false)
                } else {
                    confirmPerson(context, promptTitle, promptSubtitle) { ok ->
                        if (ok) {
                            // Just confirmed: do not ask again until the app is away or restarted.
                            AppLockSession.unlocked = true
                            preferences.setAppLock(true)
                        }
                    }
                }
            },
        )
    }
}
