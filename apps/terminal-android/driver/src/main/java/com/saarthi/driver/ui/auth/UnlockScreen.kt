package com.saarthi.driver.ui.auth

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.driver.R
import com.saarthi.driver.data.QuickLoginPolicy
import com.saarthi.driver.data.QuickLoginStore
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.design.Aurora
import com.saarthi.driver.ui.design.Avatar
import com.saarthi.driver.ui.design.BrandMark
import com.saarthi.driver.ui.design.BrandSpinner
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.PinDots
import com.saarthi.driver.ui.design.PinKeypad
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SystemBars
import com.saarthi.driver.ui.design.brandGradient
import com.saarthi.driver.ui.design.popIn
import com.saarthi.driver.ui.design.rememberLoop
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger

/**
 * Getting back in with Quick Login.
 *
 * The session is intact — this is not a sign-in — but its credential is sealed
 * behind a Keystore key that a PIN or a fingerprint opens. The fingerprint is
 * offered without being asked, once; the PIN pad is always underneath, because
 * sensors fail in the wet and in gloves. "Use password instead" is always on
 * screen: a forgotten PIN must never cost a shift.
 */
@Composable
fun UnlockScreen(viewModel: DriverViewModel, methods: QuickLoginStore.Enabled) {
    val context = LocalContext.current
    val c = Saarthi.colors
    val busy by viewModel.busy.collectAsState()
    val error by viewModel.error.collectAsState()
    val account by viewModel.account.collectAsState()
    val live by viewModel.quickLoginMethods.collectAsState()

    // Believe the store once it has spoken — including when it says a method
    // has just been switched off because its key was invalidated.
    var heard by remember { mutableStateOf(false) }
    LaunchedEffect(live) { heard = true }
    val current = if (heard) live else methods
    val biometricUsable = current.biometrics && biometricsAvailable(context)

    var pin by remember { mutableStateOf("") }
    var shake by remember { mutableIntStateOf(0) }
    var prompted by remember { mutableStateOf(false) }

    LaunchedEffect(biometricUsable) {
        if (biometricUsable && !prompted) {
            prompted = true
            promptForBiometric(context, viewModel)
        }
    }
    // A refusal shakes the dots, the way a wrong PIN feels on any phone.
    LaunchedEffect(error) { if (error != null) shake++ }

    if (busy) {
        RestoringScreen()
        return
    }

    val name = account?.name.orEmpty()
    val firstName = name.trim().substringBefore(' ').ifBlank { name }

    Column(
        Modifier
            .fillMaxSize()
            .background(c.canvas)
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(bottom = 20.dp),
    ) {
        SystemBars(lightContent = true)
        Box(
            Modifier
                .fillMaxWidth()
                .brandGradient(RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp))
                .rise(),
        ) {
            Aurora()
            Column(
                Modifier
                    .fillMaxWidth()
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 26.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                BrandMark(height = 32.dp, plated = true, modifier = Modifier.align(Alignment.Start))
                Box(
                    Modifier
                        .padding(top = 4.dp)
                        .size(84.dp)
                        .popIn(stagger(2)),
                    contentAlignment = Alignment.Center,
                ) {
                    OrbitRing(Modifier.size(100.dp))
                    Avatar(name.ifBlank { "S" }, size = 84.dp, fontSize = 28.sp)
                }
                Column(
                    Modifier.rise(stagger(3)),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        stringResource(R.string.unlock_title, firstName),
                        style = SType.title.copy(letterSpacing = (-0.03).em),
                        color = Color.White,
                        textAlign = TextAlign.Center,
                    )
                    Text(
                        stringResource(R.string.unlock_lead),
                        style = SType.body,
                        color = Color.White.copy(alpha = 0.78f),
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }

        Column(
            Modifier
                .weight(1f)
                .padding(horizontal = 20.dp),
        ) {
            if (current.pin) {
                PinDots(
                    entered = pin.length,
                    shakeKey = shake,
                    modifier = Modifier
                        .padding(top = 26.dp, bottom = 22.dp)
                        .rise(stagger(4)),
                )
                PinKeypad(
                    onDigit = { digit ->
                        if (pin.length < QuickLoginPolicy.PIN_LENGTH) {
                            pin += digit
                            if (pin.length == QuickLoginPolicy.PIN_LENGTH) {
                                viewModel.unlockWithPin(pin)
                                pin = ""
                            }
                        }
                    },
                    onBackspace = { pin = pin.dropLast(1) },
                    modifier = Modifier.rise(stagger(5)),
                )
            }
            error?.let {
                NoticeCard(it, NoticeTone.DANGER, Modifier.padding(top = 16.dp))
            }
            Spacer(Modifier.weight(1f))
            if (biometricUsable) {
                SaarthiButton(
                    stringResource(R.string.unlock_biometric),
                    { promptForBiometric(context, viewModel) },
                    Modifier.rise(stagger(6)),
                    tone = ButtonTone.SECONDARY,
                    leading = Lucide.fingerprint,
                    leadingTint = c.primary,
                )
            }
            LinkButton(
                stringResource(R.string.unlock_password),
                viewModel::signOut,
                Modifier
                    .align(Alignment.CenterHorizontally)
                    .rise(stagger(7)),
                weight = FontWeight.SemiBold,
            )
        }
    }
}

/**
 * The ring that turns around the driver's initials on the unlock header —
 * white into saffron into green, as the design's `.orbit` does.
 */
@Composable
private fun OrbitRing(modifier: Modifier) {
    val turn by rememberLoop(3_200, label = "orbit", rest = 0f)
    Canvas(modifier) {
        rotate(turn * 360f) {
            drawCircle(
                Brush.sweepGradient(
                    0f to Color.White.copy(alpha = 0f),
                    0.25f to Color.White.copy(alpha = 0.9f),
                    0.5f to Color(0xFFFE5D09),
                    0.75f to Color(0xE6028C48),
                    1f to Color.White.copy(alpha = 0f),
                ),
                radius = size.minDimension / 2f - 1.5.dp.toPx(),
                style = Stroke(3.dp.toPx()),
            )
        }
    }
}

/** "Restoring your session…" while an unlocked credential is checked with the server. */
@Composable
internal fun RestoringScreen() {
    val c = Saarthi.colors
    Column(
        Modifier
            .fillMaxSize()
            .background(c.canvas),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(26.dp, Alignment.CenterVertically),
    ) {
        BrandSpinner(size = 132.dp, modifier = Modifier.popIn())
        Text(
            stringResource(R.string.unlock_restoring),
            style = SType.headerTitle.copy(fontSize = 19.sp),
            color = c.fg,
            modifier = Modifier.rise(stagger(2)),
        )
    }
}
