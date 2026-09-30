package com.saarthi.driver.ui.auth

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.driver.R
import com.saarthi.driver.network.DriverApi
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.common.LanguageSheetContent
import com.saarthi.driver.ui.design.BottomSheet
import com.saarthi.driver.ui.design.BrandSpinner
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.StepBar
import com.saarthi.driver.ui.design.StepScreen
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger

/** Where a signed-out driver is: the welcome, a sign-in step, or a registration step. */
internal enum class AuthStep {
    WELCOME, EMAIL, PASSWORD, NAME, MOBILE, LICENCE, ACCOUNT, FLEET, REVIEW, EMAIL_CODE;

    /** Where Back goes from here. */
    val previous: AuthStep
        get() = when (this) {
            WELCOME, EMAIL, NAME -> WELCOME
            PASSWORD -> EMAIL
            MOBILE -> NAME
            LICENCE -> MOBILE
            ACCOUNT -> LICENCE
            FLEET -> ACCOUNT
            REVIEW -> FLEET
            EMAIL_CODE -> REVIEW
        }
}

/**
 * What the driver has typed so far, kept across steps and rotations.
 *
 * Held above the steps so going back never loses anything — a driver who
 * returns to fix their surname finds their licence number still there.
 */
internal class AuthForm {
    var email by mutableStateOf("")
    var password by mutableStateOf("")
    var firstName by mutableStateOf("")
    var lastName by mutableStateOf("")
    var phone by mutableStateOf("")
    var licence by mutableStateOf("")
    var joiningCode by mutableStateOf("")
    var emailCode by mutableStateOf("")
}

/**
 * Everything a driver can do before they are signed in.
 *
 * One step per screen, as the design lays it out, with the step machine kept
 * here and the view model left exactly as it was: sign-in and registration
 * are still the same two calls, and the server is still the authority on both.
 *
 * [onCreating] tells the root which of the two just succeeded, so the screen
 * after this one can say "Account created" or "Welcome back" correctly.
 */
@Composable
fun SignedOutFlow(viewModel: DriverViewModel, onCreating: (Boolean) -> Unit) {
    val busy by viewModel.busy.collectAsState()
    val error by viewModel.error.collectAsState()
    var step by rememberSaveable { mutableStateOf(AuthStep.WELCOME) }
    var forward by rememberSaveable { mutableStateOf(true) }
    var creating by rememberSaveable { mutableStateOf(false) }
    var languageOpen by rememberSaveable { mutableStateOf(false) }
    val form = remember { AuthForm() }
    var codeSent by remember { mutableStateOf<DriverApi.EmailCode?>(null) }
    var sendingCode by remember { mutableStateOf(false) }

    fun go(next: AuthStep, ahead: Boolean = true) {
        viewModel.clearError()
        forward = ahead
        step = next
    }

    BackHandler(enabled = step != AuthStep.WELCOME && !busy && !languageOpen) {
        go(step.previous, ahead = false)
    }
    BackHandler(enabled = languageOpen) { languageOpen = false }

    val slide = with(LocalDensity.current) { 48.dp.roundToPx() }
    Box(Modifier.fillMaxSize()) {
        AnimatedContent(
            targetState = if (busy) null else step,
            transitionSpec = {
                val direction = if (forward) 1 else -1
                (slideInHorizontally(tween(550, easing = Ease.out)) { slide * direction } + fadeIn(tween(550, easing = Ease.out))) togetherWith
                    fadeOut(tween(200))
            },
            label = "auth-step",
        ) { shown ->
            when (shown) {
                null -> WorkingScreen(creating)
                AuthStep.WELCOME -> WelcomeScreen(
                    onSignIn = {
                        creating = false
                        go(AuthStep.EMAIL)
                    },
                    onCreate = {
                        creating = true
                        go(AuthStep.NAME)
                    },
                    onLanguage = { languageOpen = true },
                )
                AuthStep.EMAIL -> EmailStep(
                    form = form,
                    onBack = { go(AuthStep.WELCOME, false) },
                    onContinue = { go(AuthStep.PASSWORD) },
                    onCreate = {
                        creating = true
                        go(AuthStep.NAME)
                    },
                )
                AuthStep.PASSWORD -> PasswordStep(
                    form = form,
                    error = error,
                    onBack = { go(AuthStep.EMAIL, false) },
                    onSignIn = {
                        creating = false
                        onCreating(false)
                        viewModel.signIn(form.email, form.password)
                    },
                )
                AuthStep.EMAIL_CODE -> codeSent?.let { sent ->
                    EmailCodeStep(
                        form = form,
                        sent = sent,
                        sending = sendingCode,
                        error = error,
                        onBack = { go(AuthStep.REVIEW, false) },
                        onResend = {
                            sendingCode = true
                            viewModel.sendRegistrationCode(form.email, form.firstName) { next ->
                                sendingCode = false
                                if (next != null) codeSent = next
                            }
                        },
                        onCreate = {
                            onCreating(true)
                            viewModel.register(
                                DriverApi.RegisterRequest(
                                    email = form.email.trim(),
                                    password = form.password,
                                    firstName = form.firstName.trim(),
                                    lastName = form.lastName.trim(),
                                    emailCode = form.emailCode,
                                    phone = form.phone.filter(Char::isDigit),
                                    licenseNumber = form.licence.trim().ifBlank { null },
                                    fleetInviteCode = form.joiningCode.trim().uppercase().ifBlank { null },
                                ),
                            )
                        },
                    )
                }
                else -> RegisterStep(
                    step = shown,
                    form = form,
                    error = error,
                    sendingCode = sendingCode,
                    onGo = { next, ahead -> go(next, ahead) },
                    onSignIn = {
                        creating = false
                        go(AuthStep.EMAIL)
                    },
                    onCreate = {
                        sendingCode = true
                        viewModel.sendRegistrationCode(form.email, form.firstName) { sent ->
                            sendingCode = false
                            if (sent != null) {
                                codeSent = sent
                                form.emailCode = ""
                                go(AuthStep.EMAIL_CODE)
                            }
                        }
                    },
                )
            }
        }

        BottomSheet(visible = languageOpen, onDismiss = { languageOpen = false }) {
            LanguageSheetContent()
        }
    }
}

/**
 * The frame every sign-in and registration step shares: the step bar, an
 * eyebrow, a big heading, a sentence, then the step's own fields, with the
 * primary action held at the bottom of the screen.
 */
@Composable
internal fun AuthStepFrame(
    total: Int,
    current: Int,
    barLabel: String,
    eyebrow: String,
    title: String,
    onBack: () -> Unit,
    lead: String? = null,
    footer: @Composable ColumnScope.() -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = Saarthi.colors
    StepScreen(padding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 28.dp)) {
        StepBar(total = total, current = current, label = barLabel, onBack = onBack)
        // The middle scrolls, so a small phone with the keyboard open still
        // reaches every field; the button stays pinned beneath it.
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState()),
        ) {
            Column(
                Modifier.padding(top = 32.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Eyebrow(eyebrow, Modifier.rise(stagger(1)), color = c.primary)
                Text(title, style = SType.display, color = c.fg, modifier = Modifier.rise(stagger(2)))
                lead?.let {
                    Text(it, style = SType.lead, color = c.muted, modifier = Modifier.rise(stagger(3)))
                }
            }
            content()
        }
        footer()
    }
}

/** A sign-in or registration error, in the server's words, on the step it belongs to. */
@Composable
internal fun AuthError(message: String?, modifier: Modifier = Modifier) {
    if (message.isNullOrBlank()) return
    NoticeCard(message, NoticeTone.DANGER, modifier.padding(top = 16.dp))
}

/** "Signing you in…" — the spinning brand ring while the request is out. */
@Composable
private fun WorkingScreen(creating: Boolean) {
    val c = Saarthi.colors
    Column(
        Modifier
            .fillMaxSize()
            .background(c.canvas)
            .padding(horizontal = 32.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(28.dp, Alignment.CenterVertically),
    ) {
        BrandSpinner(size = 136.dp)
        Text(
            stringResource(if (creating) R.string.auth_working_create else R.string.auth_working_sign_in),
            style = SType.sheetTitle.copy(fontSize = 20.sp, letterSpacing = (-0.02).em),
            color = c.fg,
            modifier = Modifier.rise(stagger(2)),
        )
        Text(
            stringResource(R.string.auth_working_body),
            style = SType.body,
            color = c.muted,
            textAlign = TextAlign.Center,
            modifier = Modifier.rise(stagger(3)),
        )
    }
}

/** "New to Humsafar? Create an account" — the other door, as a sentence. */
@Composable
internal fun OtherDoor(prompt: String, action: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(top = 8.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(prompt, style = SType.body, color = Saarthi.colors.muted)
        LinkButton(action, onClick, style = SType.body)
    }
}
