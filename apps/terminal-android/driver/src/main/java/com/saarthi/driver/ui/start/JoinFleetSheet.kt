package com.saarthi.driver.ui.start

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.saarthi.driver.R
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.auth.InfoNote
import com.saarthi.driver.ui.auth.JoiningCodeField
import com.saarthi.driver.ui.design.BottomSheet
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SuccessDisc
import com.saarthi.driver.ui.design.brandGradient
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger

/**
 * Join a fleet with the code its owner gave out.
 *
 * The code is the authorisation, and the server says in plain words when it is
 * wrong, when the fleet is full, or when the driver already belongs elsewhere —
 * that sentence is what appears here. On success the vehicles open up at once,
 * because the session itself has moved to the new fleet.
 */
@Composable
fun JoinFleetSheet(
    visible: Boolean,
    viewModel: DriverViewModel,
    onDismiss: () -> Unit,
) {
    val busy by viewModel.busy.collectAsState()
    val error by viewModel.error.collectAsState()
    var code by rememberSaveable { mutableStateOf("") }
    var joinedName by rememberSaveable { mutableStateOf<String?>(null) }
    var joining by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(busy) { if (!busy) joining = false }
    LaunchedEffect(visible) {
        if (visible) {
            joinedName = null
            code = ""
        }
    }

    BottomSheet(visible = visible, onDismiss = { if (!joining) onDismiss() }) {
        val done = joinedName
        if (done != null) {
            JoinedContent(done, onDismiss)
        } else {
            JoinForm(
                code = code,
                onCode = { code = it },
                busy = joining && busy,
                error = error,
                onJoin = {
                    joining = true
                    viewModel.joinFleet(code) { fleet -> joinedName = fleet.name.orEmpty() }
                },
                onDismiss = onDismiss,
            )
        }
    }
}

@Composable
private fun JoinForm(
    code: String,
    onCode: (String) -> Unit,
    busy: Boolean,
    error: String?,
    onJoin: () -> Unit,
    onDismiss: () -> Unit,
) {
    val c = Saarthi.colors
    val ready = code.trim().length >= 4
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(
            Modifier.rise(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(
                Modifier
                    .size(52.dp)
                    .brandGradient(RoundedCornerShape(16.dp)),
                contentAlignment = Alignment.Center,
            ) {
                LineIcon(Lucide.users, size = 24.dp, color = Color.White)
            }
            Column {
                Text(stringResource(R.string.join_title), style = SType.sheetTitle, color = c.fg)
                Text(stringResource(R.string.join_subtitle), style = SType.body, color = c.muted)
            }
        }
        Text(stringResource(R.string.join_lead), style = SType.lead, color = c.muted, modifier = Modifier.rise(stagger(1)))
        JoiningCodeField(
            value = code,
            onValueChange = onCode,
            onDone = { if (ready && !busy) onJoin() },
            modifier = Modifier.rise(stagger(2)),
        )
        InfoNote(stringResource(R.string.join_note), Modifier.rise(stagger(3)))
        error?.let { NoticeCard(it, NoticeTone.DANGER) }
        SaarthiButton(
            stringResource(R.string.join_action),
            onJoin,
            Modifier.rise(stagger(4)),
            enabled = ready,
            busy = busy,
            busyText = stringResource(R.string.join_working),
        )
        LinkButton(
            stringResource(R.string.action_not_now),
            onDismiss,
            Modifier
                .align(Alignment.CenterHorizontally)
                .rise(stagger(5)),
            color = c.muted,
            weight = FontWeight.Medium,
        )
    }
}

@Composable
private fun JoinedContent(fleetName: String, onDone: () -> Unit) {
    val c = Saarthi.colors
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 10.dp, bottom = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        SuccessDisc(size = 96.dp, disc = c.successSoft, tick = c.success, halo = c.successWash, haloWidth = 12.dp, tickSize = 46.dp)
        Text(
            if (fleetName.isBlank()) stringResource(R.string.joined_title_generic) else stringResource(R.string.joined_title, fleetName),
            style = SType.sheetTitle.copy(fontSize = SType.sheetTitle.fontSize * 1.09f),
            color = c.fg,
            textAlign = TextAlign.Center,
            modifier = Modifier.rise(stagger(2)),
        )
        Text(
            stringResource(R.string.joined_body),
            style = SType.lead,
            color = c.muted,
            textAlign = TextAlign.Center,
            modifier = Modifier.rise(stagger(3)),
        )
        SaarthiButton(
            stringResource(R.string.joined_action),
            onDone,
            Modifier
                .padding(top = 6.dp)
                .rise(stagger(4)),
        )
    }
}
