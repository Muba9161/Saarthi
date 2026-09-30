package com.saarthi.driver.ui.auth

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.driver.R
import com.saarthi.driver.data.DriverAccountStore
import com.saarthi.driver.data.QuickLoginPolicy
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.design.BrandMark
import com.saarthi.driver.ui.design.Confetti
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.PinDots
import com.saarthi.driver.ui.design.PinKeypad
import com.saarthi.driver.ui.design.RippleRings
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.StepBar
import com.saarthi.driver.ui.design.StepScreen
import com.saarthi.driver.ui.design.SuccessDisc
import com.saarthi.driver.ui.design.brandGradient
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.popIn
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger
import kotlinx.coroutines.delay

private enum class OfferStep { SIGNED_IN, OFFER, SET_PIN, ALL_SET }

/**
 * Straight after a password sign-in: "you will not have to type that again".
 *
 * First a moment of confirmation — signed in, or account created — then the
 * offer, which is exactly that and never a gate: "Not now" is always on
 * screen. The two methods are the same calls the settings use, so there is one
 * implementation of "turn this on".
 */
@Composable
fun QuickLoginOfferFlow(
    viewModel: DriverViewModel,
    driver: DriverAccountStore.Account,
    creating: Boolean,
) {
    val firstName = driver.name.trim().substringBefore(' ').ifBlank { driver.name }
    var step by rememberSaveable { mutableStateOf(OfferStep.SIGNED_IN) }
    var forward by rememberSaveable { mutableStateOf(true) }
    var biometric by rememberSaveable { mutableStateOf(false) }

    fun go(next: OfferStep, ahead: Boolean = true) {
        forward = ahead
        step = next
    }

    LaunchedEffect(step) {
        if (step == OfferStep.SIGNED_IN) {
            delay(1_800)
            go(OfferStep.OFFER)
        }
    }
    BackHandler(enabled = step == OfferStep.SET_PIN) { go(OfferStep.OFFER, false) }

    val slide = with(LocalDensity.current) { 48.dp.roundToPx() }
    AnimatedContent(
        targetState = step,
        transitionSpec = {
            val direction = if (forward) 1 else -1
            (slideInHorizontally(tween(550, easing = Ease.out)) { slide * direction } + fadeIn(tween(550))) togetherWith
                fadeOut(tween(200))
        },
        label = "quick-login-offer",
    ) { shown ->
        when (shown) {
            OfferStep.SIGNED_IN -> SignedInScreen(firstName, creating)
            OfferStep.OFFER -> OfferScreen(
                viewModel = viewModel,
                onPin = { go(OfferStep.SET_PIN) },
                onBiometricOn = {
                    biometric = true
                    go(OfferStep.ALL_SET)
                },
                onSkip = viewModel::finishQuickLoginSetup,
            )
            OfferStep.SET_PIN -> SetPinScreen(
                viewModel = viewModel,
                onBack = { go(OfferStep.OFFER, false) },
                onSaved = {
                    biometric = false
                    go(OfferStep.ALL_SET)
                },
            )
            OfferStep.ALL_SET -> AllSetScreen(firstName, biometric, viewModel::finishQuickLoginSetup)
        }
    }
}

/** "Welcome back, Ravi" / "Account created", over a brand disc with rings. */
@Composable
private fun SignedInScreen(firstName: String, creating: Boolean) {
    val c = Saarthi.colors
    StepScreen {
        Column(
            Modifier
                .fillMaxSize()
                .padding(horizontal = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(22.dp, Alignment.CenterVertically),
        ) {
            Box(Modifier.size(124.dp), contentAlignment = Alignment.Center) {
                RippleRings(color = c.successGlow, startAlpha = 1f)
                SuccessDisc(size = 124.dp, disc = Color.Transparent, tick = Color.White, haloWidth = 0.dp, brand = true, tickStroke = 2.6f)
            }
            Text(
                if (creating) stringResource(R.string.signed_in_created) else stringResource(R.string.signed_in_title, firstName),
                style = SType.display,
                color = c.fg,
                textAlign = TextAlign.Center,
                modifier = Modifier.rise(stagger(3)),
            )
            Text(
                stringResource(if (creating) R.string.signed_in_created_body else R.string.signed_in_body),
                style = SType.lead,
                color = c.muted,
                textAlign = TextAlign.Center,
                modifier = Modifier.rise(stagger(4)),
            )
        }
    }
}

/** The offer itself: fingerprint (when the phone has one) or a PIN. */
@Composable
private fun OfferScreen(
    viewModel: DriverViewModel,
    onPin: () -> Unit,
    onBiometricOn: () -> Unit,
    onSkip: () -> Unit,
) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val hasSensor = remember { biometricsAvailable(context) }
    var notice by remember { mutableStateOf<String?>(null) }

    StepScreen(padding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 28.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(48.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BrandMark(height = 32.dp)
            Spacer(Modifier.weight(1f))
            LinkButton(stringResource(R.string.action_not_now), onSkip, color = c.muted, weight = androidx.compose.ui.text.font.FontWeight.Medium)
        }
        Box(
            Modifier
                .fillMaxWidth()
                .padding(top = 22.dp),
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(120.dp).popIn(), contentAlignment = Alignment.Center) {
                RippleRings(color = c.glowStrong, startAlpha = 1f, count = 3)
                Box(
                    Modifier
                        .size(120.dp)
                        .brandGradient(CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    LineIcon(Lucide.fingerprintFull, size = 56.dp, color = Color.White, stroke = 1.7f)
                }
            }
        }
        Column(
            Modifier
                .fillMaxWidth()
                .padding(top = 30.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Eyebrow(stringResource(R.string.quick_login), Modifier.rise(stagger(1)), color = c.primary)
            Text(
                stringResource(R.string.offer_title),
                style = SType.display.copy(fontSize = 30.sp),
                color = c.fg,
                textAlign = TextAlign.Center,
                modifier = Modifier.rise(stagger(2)),
            )
            Text(
                stringResource(R.string.offer_lead),
                style = SType.lead,
                color = c.muted,
                textAlign = TextAlign.Center,
                modifier = Modifier.rise(stagger(3)),
            )
        }
        Spacer(Modifier.weight(1f))
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            notice?.let { NoticeCard(it, NoticeTone.WARNING) }
            if (hasSensor) {
                OfferOption(
                    icon = Lucide.fingerprint,
                    title = stringResource(R.string.offer_biometric_title),
                    subtitle = stringResource(R.string.offer_biometric_sub),
                    badge = stringResource(R.string.offer_fastest),
                    highlighted = true,
                    modifier = Modifier.rise(stagger(4)),
                ) {
                    notice = null
                    enrolBiometric(context, viewModel) { enabled, message ->
                        if (enabled) onBiometricOn() else notice = context.getString(message)
                    }
                }
            }
            OfferOption(
                icon = Lucide.lock,
                title = stringResource(R.string.pin_title),
                subtitle = stringResource(R.string.offer_pin_sub),
                badge = null,
                highlighted = false,
                modifier = Modifier.rise(stagger(5)),
                onClick = onPin,
            )
            Text(
                stringResource(R.string.offer_footnote),
                style = SType.small,
                color = c.subtle,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp)
                    .rise(stagger(6)),
            )
        }
    }
}

/** One of the two Quick Login choices, as a tappable card. */
@Composable
private fun OfferOption(
    icon: String,
    title: String,
    subtitle: String,
    badge: String?,
    highlighted: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val c = Saarthi.colors
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 20.dp)
            .then(if (highlighted) Modifier.border(2.dp, c.primary, RoundedCornerShape(20.dp)) else Modifier)
            .pressable(scale = 0.985f, onClick = onClick)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(
            icon,
            well = if (highlighted) c.primarySoft else c.sunken,
            ink = if (highlighted) c.primary else c.muted,
            iconSize = 22.dp,
        )
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(title, style = SType.cardTitle, color = c.fg)
                badge?.let {
                    Text(
                        it,
                        style = SType.microStrong,
                        color = c.primary,
                        modifier = Modifier
                            .background(c.primarySoft, CircleShape)
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                    )
                }
            }
            Text(subtitle, style = SType.small, color = c.muted, modifier = Modifier.padding(top = 2.dp))
        }
    }
}

/**
 * Choosing a PIN: once, then once more.
 *
 * Confirmed before it is stored, because a PIN mistyped at setup is one nobody
 * can ever enter. The weak-PIN rules are `QuickLoginPolicy`'s, enforced by the
 * store as well, so this screen is never the only thing standing between a
 * driver and 0000.
 */
@Composable
internal fun SetPinScreen(
    viewModel: DriverViewModel,
    onBack: () -> Unit,
    onSaved: () -> Unit,
) {
    val c = Saarthi.colors
    var first by rememberSaveable { mutableStateOf<String?>(null) }
    var pin by remember { mutableStateOf("") }
    var shake by remember { mutableIntStateOf(0) }
    var problem by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    val confirming = first != null

    val tooWeak = stringResource(R.string.pin_too_weak)
    val malformed = stringResource(R.string.pin_malformed)
    val mismatch = stringResource(R.string.pin_mismatch)
    val notSaved = stringResource(R.string.pin_not_saved)

    LaunchedEffect(pin) {
        if (pin.length < QuickLoginPolicy.PIN_LENGTH) return@LaunchedEffect
        delay(340)
        val chosen = first
        if (chosen == null) {
            when (QuickLoginPolicy.evaluate(pin)) {
                QuickLoginPolicy.PinVerdict.Acceptable -> {
                    problem = null
                    first = pin
                }
                is QuickLoginPolicy.PinVerdict.TooWeak -> {
                    problem = tooWeak
                    shake++
                }
                is QuickLoginPolicy.PinVerdict.Malformed -> {
                    problem = malformed
                    shake++
                }
            }
            pin = ""
        } else if (chosen != pin) {
            problem = mismatch
            shake++
            first = null
            pin = ""
        } else {
            saving = true
            viewModel.enableQuickLoginPin(pin) { ok ->
                saving = false
                if (ok) {
                    onSaved()
                } else {
                    problem = notSaved
                    first = null
                    pin = ""
                    shake++
                }
            }
        }
    }

    StepScreen {
        StepBar(
            total = 2,
            current = if (confirming) 2 else 1,
            label = stringResource(R.string.pin_bar),
            onBack = {
                if (confirming) {
                    first = null
                    pin = ""
                } else {
                    onBack()
                }
            },
        )
        Column(
            Modifier.padding(top = 28.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Eyebrow(stringResource(R.string.pin_eyebrow), Modifier.rise(stagger(1)), color = c.primary)
            Text(
                stringResource(if (confirming) R.string.pin_confirm_title else R.string.pin_choose_title),
                style = SType.display,
                color = c.fg,
                modifier = Modifier.rise(stagger(2)),
            )
            Text(
                problem ?: stringResource(if (confirming) R.string.pin_confirm_body else R.string.pin_choose_body),
                style = SType.lead,
                color = if (problem != null) c.danger else c.muted,
                modifier = Modifier.rise(stagger(3)),
            )
        }
        PinDots(
            entered = pin.length,
            shakeKey = shake,
            modifier = Modifier
                .padding(top = 30.dp, bottom = 26.dp)
                .rise(stagger(4)),
        )
        PinKeypad(
            onDigit = { if (pin.length < QuickLoginPolicy.PIN_LENGTH && !saving) pin += it },
            onBackspace = { pin = pin.dropLast(1) },
            keyHeight = 64.dp,
            enabled = !saving,
            modifier = Modifier.rise(stagger(5)),
        )
    }
}

/** Quick Login is on: confetti, a tick, and the way on to the vehicle. */
@Composable
private fun AllSetScreen(firstName: String, biometric: Boolean, onContinue: () -> Unit) {
    val c = Saarthi.colors
    Box(Modifier.fillMaxSize()) {
        StepScreen(padding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 28.dp)) {
            Row(Modifier.height(48.dp), verticalAlignment = Alignment.CenterVertically) {
                BrandMark(height = 32.dp)
            }
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(22.dp, Alignment.CenterVertically),
            ) {
                Box(Modifier.size(132.dp), contentAlignment = Alignment.Center) {
                    RippleRings(color = c.glowStrong, startAlpha = 1f)
                    SuccessDisc(size = 132.dp, disc = Color.Transparent, tick = Color.White, haloWidth = 0.dp, brand = true, tickStroke = 2.6f)
                }
                Eyebrow(stringResource(R.string.all_set_eyebrow), Modifier.rise(stagger(2)), color = c.success)
                Text(
                    stringResource(R.string.all_set_title, firstName),
                    style = SType.display,
                    color = c.fg,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.rise(stagger(3)),
                )
                Text(
                    stringResource(if (biometric) R.string.all_set_body_biometric else R.string.all_set_body_pin),
                    style = SType.lead,
                    color = c.muted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.rise(stagger(4)),
                )
            }
            SaarthiButton(
                stringResource(R.string.all_set_action),
                onContinue,
                Modifier.rise(stagger(5)),
                trailing = Lucide.arrowRight,
            )
        }
        Confetti(
            colors = listOf(Color(0xFFFE5D09), Color(0xFF02783F), Color(0xFF022A59), Color(0xFF3B47BA), Color(0xFFF49434), Color(0xFF3DAE79)),
            lefts = listOf(0.06f, 0.14f, 0.22f, 0.31f, 0.39f, 0.47f, 0.55f, 0.63f, 0.71f, 0.79f, 0.87f, 0.93f, 0.18f, 0.68f),
            fallHeight = 560.dp,
        )
    }
}
