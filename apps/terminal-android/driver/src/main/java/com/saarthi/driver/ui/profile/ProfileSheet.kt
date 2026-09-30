package com.saarthi.driver.ui.profile

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.driver.R
import com.saarthi.driver.data.DriverPreferences
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.design.BrandMark
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.shift.ConfirmSheet
import com.saarthi.driver.ui.shift.ShellToast
import kotlinx.coroutines.delay

/**
 * Profile and settings before a shift — behind the avatar on "Choose your
 * vehicle". The same content as the Profile tab, with its own header, its own
 * PIN screen and its own confirmations, because there is no shell around it yet.
 */
@Composable
fun ProfileSheet(
    visible: Boolean,
    driver: DriverViewModel,
    preferences: DriverPreferences,
    onJoinFleet: () -> Unit,
    onAddLicence: () -> Unit,
    onClose: () -> Unit,
) {
    var pinOpen by remember { mutableStateOf(false) }
    var signOutOpen by remember { mutableStateOf(false) }
    var toast by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(toast) {
        if (toast == null) return@LaunchedEffect
        delay(TOAST_MS)
        toast = null
    }
    BackHandler(enabled = visible && !pinOpen && !signOutOpen, onBack = onClose)

    AnimatedVisibility(
        visible,
        enter = slideInVertically(tween(550, easing = Ease.out)) { it / 4 } + fadeIn(tween(400)),
        exit = slideOutVertically(tween(300)) { it / 4 } + fadeOut(tween(250)),
    ) {
        val c = Saarthi.colors
        val pinOn = stringResource(R.string.toast_pin_on)
        Box(
            Modifier
                .fillMaxSize()
                .background(c.canvas),
        ) {
            Column(
                Modifier
                    .fillMaxSize()
                    .windowInsetsPadding(WindowInsets.statusBars),
            ) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(56.dp)
                        .padding(horizontal = 20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    BrandMark(height = 36.dp)
                    Column(Modifier.weight(1f)) {
                        Eyebrow(stringResource(R.string.header_profile_eyebrow))
                        Text(stringResource(R.string.header_profile), style = SType.headerTitle, color = c.fg, maxLines = 1)
                    }
                    CircleButton(Lucide.close, stringResource(R.string.action_close), onClose)
                }
                ProfileContent(
                    driver = driver,
                    preferences = preferences,
                    shift = null,
                    actions = ProfileActions(
                        setPin = { pinOpen = true },
                        addLicence = onAddLicence,
                        joinFleet = onJoinFleet,
                        fullMap = {},
                        signOut = { signOutOpen = true },
                        toast = { toast = it },
                    ),
                    modifier = Modifier
                        .verticalScroll(rememberScrollState())
                        .windowInsetsPadding(WindowInsets.navigationBars)
                        .padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 32.dp),
                )
            }
            ShellToast(toast)
            PinSetupOverlay(
                visible = pinOpen,
                driver = driver,
                onClose = { pinOpen = false },
                onSaved = {
                    pinOpen = false
                    toast = pinOn
                },
            )
            ConfirmSheet(
                visible = signOutOpen,
                title = stringResource(R.string.sign_out_title),
                body = stringResource(R.string.sign_out_body),
                action = stringResource(R.string.profile_sign_out),
                onConfirm = {
                    signOutOpen = false
                    driver.signOut()
                },
                onDismiss = { signOutOpen = false },
            )
        }
    }
}

/** How long a confirmation stays on screen. */
internal const val TOAST_MS = 2_800L
