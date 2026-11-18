package com.saarthi.driver.ui.splash

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.driver.R
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.design.AppName
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.StepHeader
import com.saarthi.driver.ui.design.StepScreen
import com.saarthi.driver.ui.design.popIn
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger

/**
 * Signed in, but Saarthi cannot be reached to pick the session back up.
 *
 * Says so plainly instead of showing a sign-in screen, which would tell a
 * driver whose session is fine to type a password that could not be checked
 * anyway. The root retries on its own while this is on screen; the button is
 * for a driver who has just found signal and does not want to wait.
 */
@Composable
fun UnreachableScreen(viewModel: DriverViewModel) {
    val c = Saarthi.colors
    val busy by viewModel.busy.collectAsState()
    StepScreen(scroll = true) {
        StepHeader(eyebrow = AppName.APP, title = stringResource(R.string.unreachable_title))
        IconWell(
            Lucide.cloudOff,
            well = c.warningSoft,
            ink = c.warning,
            size = 76.dp,
            radius = 26.dp,
            iconSize = 34.dp,
            modifier = Modifier
                .padding(top = 30.dp)
                .popIn(),
        )
        Text(
            stringResource(R.string.unreachable_body),
            style = SType.lead.copy(fontSize = 16.sp),
            color = c.muted,
            modifier = Modifier
                .padding(top = 20.dp)
                .rise(stagger(2)),
        )
        Spacer(Modifier.weight(1f).heightIn(min = 24.dp))
        SaarthiButton(
            stringResource(R.string.action_try_again),
            viewModel::retryConnection,
            Modifier.rise(stagger(3)),
            busy = busy,
            leading = Lucide.refresh,
        )
    }
}
