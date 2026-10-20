package com.saarthi.owner.ui.signin

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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import com.saarthi.owner.R
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.design.BrandSpinner
import com.saarthi.owner.ui.design.Ease
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StepBar
import com.saarthi.owner.ui.design.StepScreen
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.welcome.WelcomeScreen
import kotlinx.coroutines.launch

/** Where a signed-out person is. */
private enum class AuthStep { WELCOME, EMAIL, PASSWORD }

/** What has been typed so far, kept across steps so going back loses nothing. */
internal class AuthForm {
    var email by mutableStateOf("")
    var password by mutableStateOf("")
}

/**
 * Everything before an account is open — the driver app's sign-in flow,
 * without registration: welcome, email, password.
 *
 * Success needs no navigation here: the session store publishes the account
 * and the root moves inside on its own.
 */
@Composable
fun SignedOutFlow(api: OwnerApi) {
    val scope = rememberCoroutineScope()
    var step by rememberSaveable { mutableStateOf(AuthStep.WELCOME) }
    var forward by rememberSaveable { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    val form = remember { AuthForm() }

    fun go(next: AuthStep, ahead: Boolean = true) {
        error = null
        notice = null
        forward = ahead
        step = next
    }

    fun signIn() {
        busy = true
        error = null
        scope.launch {
            try {
                api.signIn(form.email, form.password)
            } catch (failure: OwnerApi.Failure) {
                error = failure.message
                busy = false
            }
        }
    }

    fun forgot() {
        error = null
        scope.launch {
            notice = try {
                api.forgotPassword(form.email)
            } catch (failure: OwnerApi.Failure) {
                error = failure.message
                null
            }
        }
    }

    BackHandler(enabled = step != AuthStep.WELCOME && !busy) {
        go(if (step == AuthStep.PASSWORD) AuthStep.EMAIL else AuthStep.WELCOME, ahead = false)
    }

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
                null -> WorkingScreen()
                AuthStep.WELCOME -> WelcomeScreen(onSignIn = { go(AuthStep.EMAIL) })
                AuthStep.EMAIL -> EmailStep(
                    form = form,
                    onBack = { go(AuthStep.WELCOME, false) },
                    onContinue = { go(AuthStep.PASSWORD) },
                )
                AuthStep.PASSWORD -> PasswordStep(
                    form = form,
                    error = error,
                    notice = notice,
                    onBack = { go(AuthStep.EMAIL, false) },
                    onForgot = ::forgot,
                    onSignIn = ::signIn,
                )
            }
        }
    }
}

/**
 * The frame every sign-in step shares: the step bar, an eyebrow, a big
 * heading, a sentence, the step's own fields — and the primary action held at
 * the foot of the screen, riding up with the keyboard.
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

/**
 * A sign-in error, in the server's words, on the step it belongs to — scrolled
 * into sight once the keyboard settles, so it never hides behind it.
 */
@Composable
internal fun AuthError(message: String?, modifier: Modifier = Modifier) {
    if (message.isNullOrBlank()) return
    RevealedNotice(message, NoticeTone.DANGER, modifier.padding(top = 16.dp))
}

/** "Signing you in…" — the spinning brand ring while the request is out. */
@Composable
private fun WorkingScreen() {
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
            stringResource(R.string.people_signin_working_title),
            style = SType.sheetTitle.copy(fontSize = 20.sp, letterSpacing = (-0.02).em),
            color = c.fg,
            modifier = Modifier.rise(stagger(2)),
        )
        Text(
            stringResource(R.string.people_signin_working_body),
            style = SType.body,
            color = c.muted,
            textAlign = TextAlign.Center,
            modifier = Modifier.rise(stagger(3)),
        )
    }
}
