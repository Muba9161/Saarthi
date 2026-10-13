package com.saarthi.owner.ui.signin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.ui.design.Avatar
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.PasswordField
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SaarthiField
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger

/** Loose, deliberately: the server decides what an email is; this only stops an empty send. */
internal fun looksLikeEmail(value: String): Boolean {
    val trimmed = value.trim()
    val at = trimmed.indexOf('@')
    return at > 0 && trimmed.indexOf('.', at) > at + 1 && !trimmed.endsWith('.')
}

/** Put the cursor in a step's field as it arrives, so the keyboard is already up. */
@Composable
internal fun rememberAutoFocus(): FocusRequester {
    val requester = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { requester.requestFocus() } }
    return requester
}

/** Sign in, step 1: the email. */
@Composable
internal fun EmailStep(form: AuthForm, onBack: () -> Unit, onContinue: () -> Unit) {
    val focus = rememberAutoFocus()
    val ready = looksLikeEmail(form.email)
    AuthStepFrame(
        total = 2,
        current = 1,
        barLabel = "Step 1 of 2",
        eyebrow = "Sign in · 1 of 2",
        title = "Welcome back",
        lead = "Use the email address your Saarthi account is on.",
        onBack = onBack,
        footer = {
            SaarthiButton(
                "Continue",
                onContinue,
                Modifier.rise(stagger(5)),
                enabled = ready,
                trailing = Lucide.arrowRight,
            )
            Text(
                "Use the Saarthi account you already have.",
                style = SType.caption,
                color = Saarthi.colors.subtle,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 14.dp)
                    .rise(stagger(6)),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        },
    ) {
        SaarthiField(
            value = form.email,
            onValueChange = { form.email = it },
            label = "Email address",
            leading = Lucide.atSign,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Next,
            ),
            keyboardActions = KeyboardActions(onNext = { if (ready) onContinue() }),
            focus = focus,
            modifier = Modifier
                .padding(top = 28.dp)
                .rise(stagger(4)),
        )
    }
}

/** Sign in, step 2: the password, under the email it belongs to. */
@Composable
internal fun PasswordStep(
    form: AuthForm,
    error: String?,
    notice: String?,
    onBack: () -> Unit,
    onForgot: () -> Unit,
    onSignIn: () -> Unit,
) {
    val c = Saarthi.colors
    val focus = rememberAutoFocus()
    val ready = form.password.isNotEmpty()
    AuthStepFrame(
        total = 2,
        current = 2,
        barLabel = "Step 2 of 2",
        eyebrow = "Sign in · 2 of 2",
        title = "Your password",
        onBack = onBack,
        footer = {
            SaarthiButton(
                "Sign in",
                onSignIn,
                Modifier.rise(stagger(5)),
                enabled = ready,
            )
        },
    ) {
        Row(
            Modifier
                .padding(top = 16.dp)
                .rise(stagger(3))
                .fillMaxWidth()
                .card(radius = 16.dp)
                .padding(start = 12.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Avatar(form.email.take(1), size = 36.dp, brand = true, fontSize = 14.sp)
            Text(
                form.email.trim(),
                style = SType.rowTitle,
                color = c.fg,
                maxLines = 1,
                modifier = Modifier.weight(1f),
            )
            LinkButton("Change", onBack, style = SType.body, weight = FontWeight.SemiBold)
        }
        PasswordField(
            value = form.password,
            onValueChange = { form.password = it },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (ready) onSignIn() }),
            focus = focus,
            modifier = Modifier
                .padding(top = 20.dp)
                .rise(stagger(4)),
        )
        LinkButton(
            "Forgot password?",
            onForgot,
            style = SType.body,
            modifier = Modifier
                .padding(top = 6.dp)
                .rise(stagger(4)),
        )
        AuthError(error)
        notice?.let { NoticeCard(it, NoticeTone.INFO, Modifier.padding(top = 16.dp), icon = Lucide.mail) }
    }
}
