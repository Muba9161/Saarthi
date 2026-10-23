package com.saarthi.driver.ui.ride.share

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.driver.R
import com.saarthi.driver.ride.RideSharePolicy
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.MapInk
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SaarthiCard
import com.saarthi.driver.ui.design.SaarthiSwitch

/**
 * "Also show it on my Saarthi owner app" — for a person who drives and owns
 * with one login. Only drawn when the login holds an owner account.
 */
@Composable
internal fun OwnerAppSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val title = stringResource(R.string.share_self_title)
    SaarthiCard(modifier, spacing = 0.dp) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            IconWell(Lucide.map, well = c.primarySoft, ink = c.primary, size = 40.dp, radius = 13.dp, iconSize = 20.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = SType.bodyStrong, color = c.fg)
                Text(stringResource(R.string.share_self_sub), style = SType.small, color = c.muted)
            }
            SaarthiSwitch(checked, onCheckedChange, title)
        }
    }
}

/**
 * The rider's own owner app, on the Sharing card: "Show on my owner app" while
 * the ride is not there yet, "Showing on your owner app" once it is, and
 * nothing for a login with no owner account.
 */
@Composable
internal fun OwnerAppLine(
    state: RideSharePolicy.SelfShare,
    busy: Boolean,
    onShow: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (state) {
        RideSharePolicy.SelfShare.HIDDEN -> Unit
        RideSharePolicy.SelfShare.OFFERED -> LinkButton(
            stringResource(R.string.sharing_self_action),
            onShow,
            modifier,
            color = MapInk.primary,
            style = SType.smallStrong,
            enabled = !busy,
        )
        RideSharePolicy.SelfShare.SHOWING -> Row(
            modifier,
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            LineIcon(Lucide.check, size = 14.dp, color = MapInk.success, stroke = 2.6f)
            Text(stringResource(R.string.sharing_self_on), style = SType.small, color = MapInk.muted)
        }
    }
}
