package com.saarthi.driver.ui.ride.share

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.driver.R
import com.saarthi.driver.ride.RideSharePolicy
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.design.AppName
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.PlateField
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.StepHeader
import com.saarthi.driver.ui.design.StepScreen
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger
import com.saarthi.driver.ui.start.StartBackLink

/**
 * Riding along, step one: "Which vehicle are you in?"
 *
 * Typed only, never scanned — the code on the door is how a driver claims a
 * vehicle, and a rider must never become its driver. Nothing is looked up and
 * nobody approves it: the number only tells family which vehicle to look for,
 * which the note under the plate says before the rider moves on.
 */
@Composable
fun ShareVehicleScreen(viewModel: DriverViewModel, typed: String) {
    val c = Saarthi.colors
    var plate by rememberSaveable { mutableStateOf(typed) }

    BackHandler(onBack = viewModel::chooseAgain)

    val ready = RideSharePolicy.plateOf(plate) != null
    val next: () -> Unit = { if (ready) viewModel.sharing.chooseFamily(plate) }

    StepScreen(scroll = true) {
        StepHeader(eyebrow = AppName.APP, title = stringResource(R.string.ride_header), modifier = Modifier.rise())
        StartBackLink(
            stringResource(R.string.role_title),
            viewModel::chooseAgain,
            Modifier
                .padding(top = 8.dp)
                .rise(stagger(1)),
        )
        Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.ride_request_title), style = SType.display, color = c.fg, modifier = Modifier.rise(stagger(1)))
            Text(stringResource(R.string.ride_request_lead), style = SType.lead, color = c.muted, modifier = Modifier.rise(stagger(2)))
        }

        PlateField(
            value = plate,
            // Capped at the server's own limit, so a number that fits is never refused.
            onValueChange = { plate = it.take(RideSharePolicy.PLATE_MAX) },
            keyboardActions = KeyboardActions(onDone = { next() }),
            modifier = Modifier
                .padding(top = 18.dp)
                .rise(stagger(3)),
        )

        NoticeCard(
            stringResource(R.string.ride_request_note),
            NoticeTone.INFO,
            Modifier
                .padding(top = 14.dp)
                .rise(stagger(4)),
            icon = Lucide.users,
        )

        SaarthiButton(
            stringResource(R.string.ride_request_action),
            next,
            Modifier
                .padding(top = 18.dp)
                .rise(stagger(5)),
            enabled = ready,
            trailing = Lucide.arrowRight,
        )
    }
}
