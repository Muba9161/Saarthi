package com.saarthi.driver.ui.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.driver.R
import com.saarthi.driver.data.DriverPreferences
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.common.LanguageRows
import com.saarthi.driver.ui.design.Aurora
import com.saarthi.driver.ui.design.Avatar
import com.saarthi.driver.ui.design.Brand
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.GroupLabel
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.LiveDot
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.SaarthiSwitch
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.bottomRule
import com.saarthi.driver.ui.design.brandGradient
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger

/** What the profile shows about the shift, when there is one. */
class ShiftDetails(val plate: String, val stateWord: String, val hoursToday: String)

/** What the profile can ask its host to do. */
class ProfileActions(
    val setPin: () -> Unit,
    val addLicence: () -> Unit,
    val joinFleet: () -> Unit,
    val fullMap: () -> Unit,
    val signOut: () -> Unit,
    val toast: (String) -> Unit,
)

/**
 * Profile and settings, as a column the host scrolls — the Profile tab on a
 * shift, and the sheet behind the avatar before one ([shift] null).
 */
@Composable
fun ProfileContent(
    driver: DriverViewModel,
    preferences: DriverPreferences,
    shift: ShiftDetails?,
    actions: ProfileActions,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    val account by driver.account.collectAsState()
    val fleet by driver.fleet.collectAsState()
    val licenceMissing by driver.licenceMissing.collectAsState()
    val instruments by preferences.instruments.collectAsState()
    val appearance by preferences.appearance.collectAsState()

    Column(modifier, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        BrandCard(
            name = account?.name.orEmpty(),
            email = account?.email.orEmpty(),
            status = shift?.let { stringResource(R.string.profile_on_vehicle, it.plate) } ?: stringResource(R.string.profile_not_signed_on),
            live = shift != null,
            modifier = Modifier.rise(),
        )

        if (shift == null && fleet?.joined == false) {
            JoinCard(actions.joinFleet, Modifier.rise(stagger(1)))
        }

        GroupLabel(stringResource(R.string.profile_work), Modifier.rise(stagger(2)))
        Column(Modifier.card().rise(stagger(2))) {
            val joined = fleet?.joined == true
            WorkRow(
                Lucide.users,
                stringResource(R.string.profile_fleet),
                fleet?.name?.takeIf { joined } ?: stringResource(R.string.profile_no_fleet),
                highlighted = joined,
            )
            WorkRow(
                Lucide.truck,
                stringResource(R.string.profile_vehicle),
                shift?.let { stringResource(R.string.profile_vehicle_value, it.plate, it.stateWord) }
                    ?: stringResource(R.string.profile_no_vehicle),
            )
            if (shift != null) {
                WorkRow(Lucide.timer, stringResource(R.string.profile_hours), stringResource(R.string.profile_hours_value, shift.hoursToday))
            }
            if (licenceMissing) {
                WorkRow(Lucide.creditCard, stringResource(R.string.field_licence), stringResource(R.string.profile_licence_missing)) {
                    LinkButton(stringResource(R.string.licence_add), actions.addLicence, style = SType.smallStrong)
                }
            }
        }

        GroupLabel(stringResource(R.string.profile_map), Modifier.rise(stagger(3)))
        Column(Modifier.card().rise(stagger(3))) {
            val label = stringResource(R.string.profile_instruments)
            val shownToast = stringResource(R.string.toast_instruments_on)
            val hiddenToast = stringResource(R.string.toast_instruments_off)
            SettingRow(
                icon = Lucide.gauge,
                accent = true,
                title = label,
                subtitle = stringResource(if (instruments) R.string.profile_instruments_on else R.string.profile_instruments_off),
                divider = shift != null,
            ) {
                SaarthiSwitch(instruments, { on ->
                    preferences.setInstruments(on)
                    actions.toast(if (on) shownToast else hiddenToast)
                }, label)
            }
            if (shift != null) {
                SettingRow(
                    icon = Lucide.maximize,
                    title = stringResource(R.string.map_full),
                    subtitle = stringResource(R.string.profile_full_map_sub),
                    divider = false,
                    onClick = actions.fullMap,
                ) {
                    LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
                }
            }
        }

        GroupLabel(stringResource(R.string.profile_appearance), Modifier.rise(stagger(4)))
        AppearancePicker(appearance, preferences::setAppearance, Modifier.rise(stagger(4)))

        GroupLabel(stringResource(R.string.profile_language), Modifier.rise(stagger(5)))
        LanguageRows(Modifier.card().rise(stagger(5)))

        GroupLabel(stringResource(R.string.profile_security), Modifier.rise(stagger(6)))
        SecurityCard(driver, actions, Modifier.rise(stagger(6)))

        SaarthiButton(
            stringResource(R.string.profile_sign_out),
            actions.signOut,
            Modifier
                .padding(top = 14.dp)
                .rise(stagger(7)),
            tone = ButtonTone.DANGER_OUTLINE,
            leading = Lucide.logout,
        )
        Text(
            stringResource(R.string.profile_sign_out_note),
            style = SType.small,
            color = c.subtle,
            modifier = Modifier
                .padding(horizontal = 4.dp)
                .rise(stagger(7)),
        )
    }
}

/** The driver on the brand panel: initials, name, email and where they are. */
@Composable
private fun BrandCard(name: String, email: String, status: String, live: Boolean, modifier: Modifier) {
    val shape = RoundedCornerShape(28.dp)
    Box(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .brandGradient(shape),
    ) {
        Aurora()
        Row(
            Modifier.padding(22.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Avatar(name.ifBlank { "S" }, size = 64.dp, fontSize = 22.sp)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(name, style = SType.sheetTitle.copy(letterSpacing = (-0.03).em), color = Color.White, maxLines = 1)
                if (email.isNotBlank()) {
                    Text(email, style = SType.small, color = Color.White.copy(alpha = 0.75f), maxLines = 1)
                }
                Row(
                    Modifier
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.14f))
                        .border(1.dp, Color.White.copy(alpha = 0.18f), CircleShape)
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    LiveDot(
                        if (live) Brand.live else Color.White.copy(alpha = 0.55f),
                        size = 7.dp,
                        breathing = live,
                    )
                    Text(status, style = SType.captionStrong, color = Color.White)
                }
            }
        }
    }
}

/** "You are not in a fleet yet" — the way into a fleet before any vehicle can be found. */
@Composable
private fun JoinCard(onJoin: () -> Unit, modifier: Modifier) {
    val c = Saarthi.colors
    val shape = RoundedCornerShape(20.dp)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.joinWash)
            .border(1.dp, c.primaryRing, shape)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(
                Modifier
                    .clip(RoundedCornerShape(14.dp))
                    .brandGradient(RoundedCornerShape(14.dp))
                    .padding(12.dp),
            ) {
                LineIcon(Lucide.users, size = 20.dp, color = Color.White)
            }
            Column {
                Text(stringResource(R.string.profile_join_title), style = SType.cardTitle, color = c.fg)
                Text(stringResource(R.string.profile_join_body), style = SType.small, color = c.muted)
            }
        }
        SaarthiButton(stringResource(R.string.profile_join_action), onJoin, height = 52.dp)
    }
}

/** One fact about the driver's work, as a row of the card. */
@Composable
private fun WorkRow(
    icon: String,
    label: String,
    value: String,
    highlighted: Boolean = false,
    trailing: (@Composable () -> Unit)? = null,
) {
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 64.dp)
            .bottomRule(c.border)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(
            icon,
            well = if (highlighted) c.successSoft else c.sunken,
            ink = if (highlighted) c.success else c.muted,
            size = 36.dp,
            radius = 12.dp,
            iconSize = 18.dp,
        )
        Column(Modifier.weight(1f)) {
            Text(label, style = SType.small, color = c.muted)
            Text(value, style = SType.rowTitle, color = c.fg)
        }
        trailing?.invoke()
    }
}

/** A setting: icon, what it is, how it is set now, and its control. */
@Composable
internal fun SettingRow(
    icon: String?,
    title: String,
    subtitle: String?,
    divider: Boolean,
    accent: Boolean = false,
    onClick: (() -> Unit)? = null,
    control: @Composable () -> Unit,
) {
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = if (subtitle != null) 72.dp else 60.dp)
            .bottomRule(c.border, show = divider)
            .then(if (onClick != null) Modifier.pressable(label = title, scale = 0.99f, onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (icon != null) {
            IconWell(
                icon,
                well = if (accent) c.primarySoft else c.sunken,
                ink = if (accent) c.primary else c.muted,
                size = 36.dp,
                radius = 12.dp,
                iconSize = 18.dp,
            )
        } else {
            Spacer(Modifier.width(36.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = SType.rowTitle, color = c.fg)
            if (subtitle != null) Text(subtitle, style = SType.small, color = c.muted)
        }
        control()
    }
}

/** Phone, Light or Dark — with a swatch of each, and a word on why the map stays dark. */
@Composable
private fun AppearancePicker(
    current: DriverPreferences.Appearance,
    onPick: (DriverPreferences.Appearance) -> Unit,
    modifier: Modifier,
) {
    val c = Saarthi.colors
    Column(
        modifier
            .card()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DriverPreferences.Appearance.entries.forEach { option ->
                val on = option == current
                val shape = RoundedCornerShape(16.dp)
                Column(
                    Modifier
                        .weight(1f)
                        .height(92.dp)
                        .clip(shape)
                        .background(if (on) c.primaryWash else c.sunken)
                        .then(if (on) Modifier.border(2.dp, c.primary, shape) else Modifier)
                        .pressable(role = Role.RadioButton, scale = 0.96f) { onPick(option) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
                ) {
                    Swatch(option)
                    Text(
                        stringResource(
                            when (option) {
                                DriverPreferences.Appearance.PHONE -> R.string.appearance_phone
                                DriverPreferences.Appearance.LIGHT -> R.string.appearance_light
                                DriverPreferences.Appearance.DARK -> R.string.appearance_dark
                            },
                        ),
                        style = SType.small.copy(fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium),
                        color = if (on) c.fg else c.muted,
                    )
                }
            }
        }
        Text(stringResource(R.string.profile_appearance_note), style = SType.small, color = c.subtle)
    }
}

@Composable
private fun Swatch(option: DriverPreferences.Appearance) {
    val shape = RoundedCornerShape(9.dp)
    val light = Color.White
    val dark = Color(0xFF161618)
    Box(
        Modifier
            .clip(shape)
            .border(1.dp, Saarthi.colors.borderStrong, shape)
            .then(
                when (option) {
                    DriverPreferences.Appearance.LIGHT -> Modifier.background(light)
                    DriverPreferences.Appearance.DARK -> Modifier.background(dark)
                    DriverPreferences.Appearance.PHONE -> Modifier.background(
                        Brush.linearGradient(
                            0.5f to light,
                            0.5f to dark,
                        ),
                    )
                },
            )
            .padding(horizontal = 23.dp, vertical = 16.dp),
    )
}
