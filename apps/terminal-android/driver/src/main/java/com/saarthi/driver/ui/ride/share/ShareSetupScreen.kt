package com.saarthi.driver.ui.ride.share

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.driver.R
import com.saarthi.driver.ride.RideSharePolicy
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.design.AppName
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.SaarthiCard
import com.saarthi.driver.ui.design.StepHeader
import com.saarthi.driver.ui.design.StepScreen
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger
import com.saarthi.driver.ui.start.ErrorAlert
import com.saarthi.driver.ui.start.StartBackLink

/**
 * Riding along, step two: "Who should see where you are?"
 *
 * Up to five family numbers. Those who use Saarthi are told at once, and
 * everybody else gets the link the next screen offers to send — so a share
 * with no number at all is still worth starting. Every number is checked here,
 * before anything is sent, because one wrong number refuses the whole list.
 *
 * A login that also holds an owner account is offered its own owner app too,
 * switched on to begin with: one person driving and owning with one login is
 * the person most likely to want the ride on their own map.
 */
@Composable
fun ShareSetupScreen(viewModel: DriverViewModel, plate: String) {
    val c = Saarthi.colors
    val busy by viewModel.busy.collectAsState()
    val error by viewModel.error.collectAsState()
    val ownerAccount by viewModel.sharing.hasOwnerAccount.collectAsState()

    var withSelf by rememberSaveable { mutableStateOf(true) }
    val numbers = rememberSaveable(saver = NumbersSaver) { mutableStateListOf("") }
    // Raised by the first try, so half-typed numbers are marked from then on.
    var checked by rememberSaveable { mutableStateOf(false) }
    var shake by remember { mutableIntStateOf(0) }
    LaunchedEffect(error) { if (error != null) shake++ }

    // A field just added takes the cursor, so "+ Add another" is one tap, not two.
    val newest = remember { FocusRequester() }
    var added by remember { mutableIntStateOf(0) }
    LaunchedEffect(added) { if (added > 0) runCatching { newest.requestFocus() } }

    val back = { viewModel.sharing.backToVehicle(plate) }
    BackHandler(enabled = !busy, onBack = back)

    val start: () -> Unit = {
        checked = true
        val contacts = RideSharePolicy.contactsOf(numbers)
        if (contacts != null && !busy) viewModel.sharing.start(plate, contacts, withSelf)
    }

    StepScreen(scroll = true) {
        StepHeader(eyebrow = AppName.APP, title = stringResource(R.string.ride_header), modifier = Modifier.rise())
        StartBackLink(
            stringResource(R.string.ride_request_title),
            back,
            Modifier
                .padding(top = 8.dp)
                .rise(stagger(1)),
        )
        Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.share_title), style = SType.display, color = c.fg, modifier = Modifier.rise(stagger(1)))
            Text(stringResource(R.string.share_lead), style = SType.lead, color = c.muted, modifier = Modifier.rise(stagger(2)))
        }

        VehicleLine(
            plate = plate,
            onChange = back,
            modifier = Modifier
                .padding(top = 18.dp)
                .rise(stagger(3)),
        )

        Column(
            Modifier
                .padding(top = 18.dp)
                .rise(stagger(4)),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            numbers.forEachIndexed { index, number ->
                FamilyMobileField(
                    value = number,
                    onValueChange = {
                        numbers[index] = it
                        if (error != null) viewModel.clearError()
                    },
                    checked = checked,
                    onRemove = if (numbers.size > 1) ({ numbers.removeAt(index) }) else null,
                    focus = if (index == numbers.lastIndex) newest else null,
                )
            }
            if (numbers.size < RideSharePolicy.MAX_CONTACTS) {
                LinkButton(
                    stringResource(R.string.share_contact_add),
                    {
                        numbers.add("")
                        added++
                    },
                )
            }
        }

        if (ownerAccount) {
            OwnerAppSwitch(
                checked = withSelf,
                onCheckedChange = { withSelf = it },
                modifier = Modifier
                    .padding(top = 14.dp)
                    .rise(stagger(5)),
            )
        }

        NoticeCard(
            stringResource(R.string.share_note),
            NoticeTone.INFO,
            Modifier
                .padding(top = 14.dp)
                .rise(stagger(5)),
            icon = Lucide.users,
        )

        error?.let { message ->
            ErrorAlert(message = message, shakeKey = shake, onJoin = null, modifier = Modifier.padding(top = 14.dp))
        }

        SaarthiButton(
            stringResource(R.string.share_start),
            start,
            Modifier
                .padding(top = 18.dp)
                .rise(stagger(6)),
            busy = busy,
            busyText = stringResource(R.string.share_starting),
            leading = Lucide.mapPin,
        )
    }
}

/** The vehicle named in step one, and the way back to change it. */
@Composable
private fun VehicleLine(plate: String, onChange: () -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    SaarthiCard(modifier, padding = PaddingValues(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Eyebrow(stringResource(R.string.label_vehicle))
                Text(plate, style = SType.plate(20.sp, 0.04.em), color = c.fg, maxLines = 1)
            }
            LinkButton(stringResource(R.string.action_change), onChange, style = SType.smallStrong)
        }
    }
}

/** The typed numbers, kept through a turn of the phone. */
private val NumbersSaver = listSaver<SnapshotStateList<String>, String>(
    save = { it.toList() },
    restore = { it.toMutableStateList() },
)
