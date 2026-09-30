package com.saarthi.driver.ui.profile

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.driver.R
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.auth.SetPinScreen
import com.saarthi.driver.ui.auth.biometricsAvailable
import com.saarthi.driver.ui.auth.enrolBiometric
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SaarthiSwitch
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.card

/**
 * Sign-in and security: the PIN, the fingerprint and changing the PIN.
 *
 * Each switch does the real thing — turning the PIN on opens the PIN screen,
 * turning the fingerprint on asks the sensor first — so a switch never claims
 * a protection the phone is not actually applying.
 */
@Composable
internal fun SecurityCard(driver: DriverViewModel, actions: ProfileActions, modifier: Modifier) {
    val context = LocalContext.current
    val methods by driver.quickLoginMethods.collectAsState()
    val sensor = remember { biometricsAvailable(context) }
    val pinLabel = stringResource(R.string.pin_title)
    val biometricLabel = stringResource(R.string.offer_biometric_title)
    val pinOff = stringResource(R.string.toast_pin_off)
    val biometricOff = stringResource(R.string.toast_biometric_off)

    Column(modifier.card()) {
        SettingRow(
            icon = Lucide.lock,
            accent = true,
            title = pinLabel,
            subtitle = stringResource(if (methods.pin) R.string.profile_on else R.string.profile_off),
            divider = true,
        ) {
            SaarthiSwitch(methods.pin, { on ->
                if (on) {
                    actions.setPin()
                } else {
                    driver.disableQuickLoginPin()
                    actions.toast(pinOff)
                }
            }, pinLabel)
        }
        SettingRow(
            icon = Lucide.fingerprint,
            title = biometricLabel,
            subtitle = stringResource(
                when {
                    methods.biometrics -> R.string.profile_on
                    sensor -> R.string.profile_off
                    else -> R.string.profile_biometric_unavailable
                },
            ),
            divider = methods.pin,
        ) {
            SaarthiSwitch(
                methods.biometrics,
                { on ->
                    if (on) {
                        enrolBiometric(context, driver) { _, message -> actions.toast(context.getString(message)) }
                    } else {
                        driver.disableQuickLoginBiometrics()
                        actions.toast(biometricOff)
                    }
                },
                biometricLabel,
                // Always possible to turn off; only possible to turn on with a sensor.
                enabled = sensor || methods.biometrics,
            )
        }
        if (methods.pin) {
            SettingRow(
                icon = null,
                title = stringResource(R.string.profile_change_pin),
                subtitle = null,
                divider = false,
                onClick = actions.setPin,
            ) {
                LineIcon(Lucide.chevronRight, size = 18.dp, color = Saarthi.colors.subtle)
            }
        }
    }
}

/** The PIN screen, sliding over whatever opened it. */
@Composable
fun PinSetupOverlay(visible: Boolean, driver: DriverViewModel, onClose: () -> Unit, onSaved: () -> Unit) {
    BackHandler(enabled = visible, onBack = onClose)
    AnimatedVisibility(
        visible,
        enter = slideInHorizontally(tween(500, easing = Ease.out)) { it / 3 } + fadeIn(tween(400)),
        exit = slideOutHorizontally(tween(300)) { it / 3 } + fadeOut(tween(250)),
    ) {
        SetPinScreen(driver, onBack = onClose, onSaved = onSaved)
    }
}
