package com.saarthi.driver.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.saarthi.core.ui.Language
import com.saarthi.driver.R
import com.saarthi.driver.SaarthiDriverApp
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.Ember
import com.saarthi.driver.ui.design.FleetCard
import com.saarthi.driver.ui.design.FleetRule
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.IconChip
import com.saarthi.driver.ui.design.SectionHeader
import com.saarthi.driver.ui.design.Slate
import com.saarthi.driver.ui.design.pressable

/**
 * Which language Saarthi speaks.
 *
 * The native name leads on every row, and that is the whole point of the
 * control: somebody who reads only Hindi cannot find "Hindi" in a list of
 * English words, but they can find "हिन्दी" immediately.
 *
 * Changing it recreates the activity. That is the honest mechanism rather than a
 * compromise — Android resolves resources when a context is created, so a
 * running screen cannot change language halfway. Recreating takes a blink and
 * leaves nothing half-translated.
 */
@Composable
fun LanguageCard() {
    val context = LocalContext.current
    val app = context.applicationContext as SaarthiDriverApp
    var chosen by remember { mutableStateOf(app.settings.languageTag) }

    FleetCard(Modifier.fillMaxWidth()) {
        SectionHeader(stringResource(R.string.language_title))
        Spacer(Modifier.height(FleetSpace.tight))
        Text(
            stringResource(R.string.language_blurb),
            style = MaterialTheme.typography.bodyMedium,
            color = Ash,
        )
        Spacer(Modifier.height(FleetSpace.snug))

        Language.available.forEachIndexed { index, choice ->
            if (index > 0) {
                Spacer(Modifier.height(FleetSpace.tight))
                FleetRule()
                Spacer(Modifier.height(FleetSpace.tight))
            }

            val selected = choice.tag == chosen
            Row(
                Modifier
                    .fillMaxWidth()
                    .pressable {
                        if (choice.tag == chosen) return@pressable
                        chosen = choice.tag
                        app.settings.languageTag = choice.tag
                        // Resources are resolved when a context is created, so
                        // the screen has to be built again to speak the new
                        // language. Nothing is lost: the driver is signed in and
                        // every stage is derived from the server.
                        (context as? android.app.Activity)?.recreate()
                    },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        // The phone-default row has no language of its own, so
                        // it is the one entry that must be readable in whatever
                        // language is currently in force.
                        if (choice.tag.isEmpty()) {
                            stringResource(R.string.language_phone_default)
                        } else {
                            choice.nativeName
                        },
                        style = MaterialTheme.typography.titleSmall,
                        color = if (selected) Chalk else Ash,
                    )
                    if (choice.tag.isNotEmpty() && choice.nativeName != choice.englishName) {
                        Text(
                            choice.englishName,
                            style = MaterialTheme.typography.bodySmall,
                            color = Slate,
                        )
                    }
                }
                if (selected) {
                    IconChip(icon = Icons.Rounded.Check, tinted = true, size = 32.dp0())
                }
            }
        }

        Spacer(Modifier.height(FleetSpace.snug))
        Text(
            // Honest about the state of the work. A driver who picks Hindi and
            // finds the cockpit still in English should know that is unfinished
            // translation rather than a fault they should report.
            "Some screens are still being translated and will show English until they are done.",
            style = MaterialTheme.typography.bodySmall,
            color = Slate,
        )
    }
}

private fun Int.dp0() = androidx.compose.ui.unit.Dp(this.toFloat())
