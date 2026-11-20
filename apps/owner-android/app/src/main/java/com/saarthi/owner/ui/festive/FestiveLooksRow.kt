package com.saarthi.owner.ui.festive

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.saarthi.owner.R
import com.saarthi.owner.festive.FestiveStore
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiSwitch
import com.saarthi.owner.ui.design.card
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Festive looks: the garland, the greeting and their colours on festival days,
 * or none of it anywhere in the app.
 *
 * Saved to the account, so the web and the other apps follow the same choice;
 * the switch shows the new position while that is saved and goes back, with
 * the reason, if it could not be.
 */
@Composable
fun FestiveLooksRow(festive: FestiveStore, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    val wanted by festive.wanted.collectAsStateWithLifecycle()
    // The position asked for, held until the saved choice reaches `wanted`, so the switch never flickers back.
    var saving by remember { mutableStateOf<Boolean?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val label = stringResource(R.string.people_account_festive_looks)
    LaunchedEffect(wanted) { if (saving == wanted) saving = null }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .card(radius = 22.dp)
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            IconWell(Lucide.sparkles, well = c.primarySoft, ink = c.primary, size = 40.dp, radius = 12.dp, iconSize = 18.dp)
            Column(Modifier.weight(1f)) {
                Text(label, style = SType.bodyStrong, color = c.fg)
                Text(stringResource(R.string.people_account_festive_looks_detail), style = SType.caption, color = c.muted)
            }
            SaarthiSwitch(
                checked = saving ?: wanted,
                enabled = saving == null,
                label = label,
                onCheckedChange = { on ->
                    saving = on
                    error = null
                    scope.launch {
                        try {
                            festive.setLooks(on)
                        } catch (failure: CancellationException) {
                            saving = null
                            throw failure
                        } catch (failure: Exception) {
                            error = failure.readable()
                            saving = null
                        }
                    }
                },
            )
        }
        error?.let { RevealedNotice(it, NoticeTone.DANGER) }
    }
}
