package com.saarthi.driver.ui.profile

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.saarthi.driver.R
import com.saarthi.driver.data.DriverPreferences
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SaarthiSwitch
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.lock.AppLockSession
import com.saarthi.driver.ui.lock.canLockApp
import com.saarthi.driver.ui.lock.confirmPerson

/**
 * Sign-in and security: App lock, the same switch the owner app has.
 *
 * Turning it on asks Android to confirm the driver first, so the switch never
 * claims a lock the phone cannot actually apply. Turning it off needs no
 * prompt; the driver is already inside the app. Unavailable until the phone
 * itself has a screen lock, fingerprint or face set up.
 */
@Composable
internal fun SecurityCard(preferences: DriverPreferences, modifier: Modifier) {
    val context = LocalContext.current
    val on by preferences.appLock.collectAsState()
    val available = remember { canLockApp(context) }
    val label = stringResource(R.string.app_lock)
    val promptTitle = stringResource(R.string.app_lock_prompt_title)
    val promptSubtitle = stringResource(R.string.app_lock_prompt_subtitle)

    Column(modifier.card()) {
        SettingRow(
            icon = Lucide.fingerprint,
            accent = true,
            title = label,
            subtitle = stringResource(if (available) R.string.app_lock_detail else R.string.app_lock_unavailable),
            divider = false,
        ) {
            SaarthiSwitch(
                on,
                { wanted ->
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
                label,
                // Always possible to turn off; only possible to turn on with a lock set up.
                enabled = available || on,
            )
        }
    }
}
