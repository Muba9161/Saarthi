package com.saarthi.driver.ui.start

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.keyframes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.driver.R
import com.saarthi.driver.data.DriverAccountStore
import com.saarthi.driver.data.DriverPreferences
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.design.AppName
import com.saarthi.driver.ui.design.Avatar
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.StepHeader
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.profile.ProfileSheet

/*
 * What the start screens share: "How are you travelling?", the scanner, and
 * asking to ride along all carry the same header, reach the same profile, and
 * show a refusal the same way.
 */

/** The mark, where the driver is, and their avatar — which opens the profile. */
@Composable
internal fun StartHeader(
    driver: DriverAccountStore.Account,
    title: String,
    onProfile: () -> Unit,
    modifier: Modifier = Modifier,
) {
    StepHeader(eyebrow = AppName.APP, title = title, modifier = modifier) {
        Avatar(
            driver.name,
            size = 44.dp,
            brand = true,
            fontSize = 15.sp,
            modifier = Modifier.pressable(scale = 0.94f, label = stringResource(R.string.profile_open), onClick = onProfile),
        )
    }
}

/** A step back to the question before — "‹ How are you travelling?". */
@Composable
internal fun StartBackLink(text: String, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Row(
        modifier
            .defaultMinSize(minHeight = 44.dp)
            .clip(RoundedCornerShape(12.dp))
            .pressable(label = text, onClick = onBack)
            .padding(end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        LineIcon(Lucide.chevronLeft, size = 18.dp, color = c.primary, stroke = 2.4f)
        Text(text, style = SType.smallStrong, color = c.primary)
    }
}

/**
 * Which of the start screens' sheets is open.
 *
 * Saved, so a phone turned on its side does not close a fleet code half typed.
 */
@Stable
internal class StartSheets(profile: Boolean = false, joinFleet: Boolean = false, licence: Boolean = false) {
    var profile by mutableStateOf(profile)
    var joinFleet by mutableStateOf(joinFleet)
    var licence by mutableStateOf(licence)

    val anyOpen: Boolean get() = profile || joinFleet || licence

    companion object {
        val Saver = listSaver<StartSheets, Boolean>(
            save = { listOf(it.profile, it.joinFleet, it.licence) },
            restore = { StartSheets(it[0], it[1], it[2]) },
        )
    }
}

@Composable
internal fun rememberStartSheets(): StartSheets = rememberSaveable(saver = StartSheets.Saver) { StartSheets() }

/** The profile, joining a fleet and adding a licence — over whichever start screen opened them. */
@Composable
internal fun StartSheetsHost(sheets: StartSheets, viewModel: DriverViewModel, preferences: DriverPreferences) {
    ProfileSheet(
        visible = sheets.profile,
        driver = viewModel,
        preferences = preferences,
        onJoinFleet = { sheets.joinFleet = true },
        onAddLicence = { sheets.licence = true },
        onClose = { sheets.profile = false },
    )
    JoinFleetSheet(
        visible = sheets.joinFleet,
        viewModel = viewModel,
        onDismiss = {
            sheets.joinFleet = false
            viewModel.clearError()
        },
    )
    AddLicenceSheet(
        visible = sheets.licence,
        viewModel = viewModel,
        onDismiss = {
            sheets.licence = false
            viewModel.clearError()
        },
    )
}

/**
 * A refusal, shaken into view — the wrong truck, a code from another fleet.
 *
 * Offers "Join" when the driver has no fleet yet, because that is what almost
 * every refusal means for them.
 */
@Composable
internal fun ErrorAlert(message: String, shakeKey: Int, onJoin: (() -> Unit)?, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val offset = remember { Animatable(0f) }
    LaunchedEffect(shakeKey) {
        if (shakeKey == 0) return@LaunchedEffect
        offset.animateTo(
            0f,
            keyframes {
                durationMillis = 500
                -2f at 50; 4f at 100; -6f at 150; 6f at 200; -6f at 250; 6f at 300; -6f at 350; 4f at 400; -2f at 450
            },
        )
    }
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier
            .graphicsLayer { translationX = offset.value * density }
            .fillMaxWidth()
            .clip(shape)
            .background(c.dangerWash)
            .border(1.dp, c.dangerRing, shape)
            .padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier
                .padding(top = 6.dp)
                .size(8.dp)
                .clip(CircleShape)
                .background(c.danger),
        )
        Text(message, style = SType.body, color = c.fg, modifier = Modifier.weight(1f))
        onJoin?.let {
            LinkButton(stringResource(R.string.join_link), it, style = SType.body, modifier = Modifier.height(32.dp))
        }
    }
}
