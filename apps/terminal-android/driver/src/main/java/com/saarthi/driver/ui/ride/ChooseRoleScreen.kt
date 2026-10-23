package com.saarthi.driver.ui.ride

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.driver.R
import com.saarthi.driver.data.DriverAccountStore
import com.saarthi.driver.data.DriverPreferences
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.StepScreen
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger
import com.saarthi.driver.ui.start.StartHeader
import com.saarthi.driver.ui.start.StartSheetsHost
import com.saarthi.driver.ui.start.rememberStartSheets

/**
 * "How are you travelling?" — the first question once signed in.
 *
 * Two people use Humsafar, and they need different things from it. A driver
 * scans the vehicle and their fleet approves them onto it; a rider is somebody
 * travelling in a vehicle they are not driving, who names it and shares the
 * ride live with family. Asking first keeps the rider out of the scanner, which
 * would make them the vehicle's driver. Only asked when the server allows it.
 *
 * The same header and profile as the scanner, so nothing a driver reached from
 * there has moved.
 */
@Composable
fun ChooseRoleScreen(
    viewModel: DriverViewModel,
    driver: DriverAccountStore.Account,
    preferences: DriverPreferences,
) {
    val c = Saarthi.colors
    val sheets = rememberStartSheets()

    Box(Modifier.fillMaxSize()) {
        StepScreen(scroll = true) {
            StartHeader(driver, stringResource(R.string.role_header), { sheets.profile = true }, Modifier.rise())
            Column(Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.role_title), style = SType.display, color = c.fg, modifier = Modifier.rise(stagger(1)))
                Text(stringResource(R.string.role_lead), style = SType.lead, color = c.muted, modifier = Modifier.rise(stagger(2)))
            }
            Column(Modifier.padding(top = 22.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                RoleCard(
                    icon = Lucide.car,
                    well = c.primarySoft,
                    ink = c.primary,
                    title = stringResource(R.string.role_drive_title),
                    subtitle = stringResource(R.string.role_drive_sub),
                    onClick = viewModel::chooseDriving,
                    modifier = Modifier.rise(stagger(3)),
                )
                RoleCard(
                    icon = Lucide.users,
                    well = c.successSoft,
                    ink = c.success,
                    title = stringResource(R.string.role_ride_title),
                    subtitle = stringResource(R.string.role_ride_sub),
                    onClick = viewModel::chooseRiding,
                    modifier = Modifier.rise(stagger(4)),
                )
            }
        }
        StartSheetsHost(sheets, viewModel, preferences)
    }
}

/** One answer, as a card a thumb can find: its icon, what it means, and a chevron. */
@Composable
private fun RoleCard(
    icon: String,
    well: Color,
    ink: Color,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    Row(
        modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 88.dp)
            .card(radius = 20.dp)
            .pressable(label = title, onClick = onClick)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(icon, well = well, ink = ink, size = 52.dp, radius = 16.dp, iconSize = 24.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = SType.cardTitle, color = c.fg)
            Text(subtitle, style = SType.small, color = c.muted)
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}
