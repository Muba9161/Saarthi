package com.saarthi.driver.ui.ride.share

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.driver.R
import com.saarthi.driver.network.RideSharesApi
import com.saarthi.driver.ui.DriverViewModel
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
 * The share is over — it ran out of time, or was stopped from elsewhere —
 * said once, so the rider is never left wondering whether family can still
 * see them. The only way on is back to the first question.
 */
@Composable
fun ShareOverScreen(viewModel: DriverViewModel, share: RideSharesApi.ShareView) {
    val c = Saarthi.colors
    StepScreen(scroll = true) {
        StepHeader(eyebrow = stringResource(R.string.sharing_eyebrow), title = stringResource(R.string.share_over_title))
        IconWell(
            Lucide.flag,
            well = c.primarySoft,
            ink = c.primary,
            size = 76.dp,
            radius = 26.dp,
            iconSize = 34.dp,
            modifier = Modifier
                .padding(top = 30.dp)
                .popIn(),
        )
        Column(
            Modifier
                .padding(top = 20.dp)
                .rise(stagger(2)),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            share.registrationNumber?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = SType.plate(30.sp), color = c.fg)
            }
            Text(stringResource(R.string.share_over_body), style = SType.lead.copy(fontSize = 16.sp), color = c.muted)
        }
        Spacer(Modifier.weight(1f).heightIn(min = 24.dp))
        SaarthiButton(stringResource(R.string.action_done), viewModel::chooseAgain, Modifier.rise(stagger(4)))
    }
}
