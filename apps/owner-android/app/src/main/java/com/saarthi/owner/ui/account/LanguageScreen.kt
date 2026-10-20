package com.saarthi.owner.ui.account

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.saarthi.owner.R
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.LanguageRows
import com.saarthi.owner.ui.design.Hint

/** The language the app speaks, chosen from those it is translated into. */
@Composable
internal fun LanguageScreen() {
    DetailScreen(eyebrow = stringResource(R.string.people_account), title = stringResource(R.string.people_account_language)) {
        Hint(stringResource(R.string.people_language_hint))
        LanguageRows()
    }
}
