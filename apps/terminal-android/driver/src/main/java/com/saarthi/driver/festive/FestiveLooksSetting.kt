package com.saarthi.driver.festive

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.saarthi.driver.R
import com.saarthi.driver.SaarthiDriverApp
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SaarthiSwitch
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.profile.SettingRow

/**
 * The "Festive looks" switch, as a card of its own beside the language.
 *
 * [toast] says so when a change could not be saved to the account; the switch
 * has already gone back by then.
 */
@Composable
fun FestiveLooksSetting(toast: (String) -> Unit, modifier: Modifier = Modifier) {
    val looks = (LocalContext.current.applicationContext as SaarthiDriverApp).festiveLooks
    val on by looks.on.collectAsState()
    val label = stringResource(R.string.festive_looks)
    val notSaved = stringResource(R.string.festive_looks_not_saved)

    Column(modifier.card()) {
        SettingRow(
            icon = Lucide.sparkles,
            accent = true,
            title = label,
            subtitle = stringResource(R.string.festive_looks_help),
            divider = false,
        ) {
            SaarthiSwitch(on, { looks.set(it) { toast(notSaved) } }, label)
        }
    }
}
