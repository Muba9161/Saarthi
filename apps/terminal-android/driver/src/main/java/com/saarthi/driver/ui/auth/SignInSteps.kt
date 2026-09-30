package com.saarthi.driver.ui.auth

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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Avatar
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.PasswordField
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.SaarthiField
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger

/**
 * The server's floor, so a refusal never arrives after typing.
 *
 * Ten, as `passwordSchema` says. The old sign-in screen held both modes to it
 * and so does this one.
 */
internal const val MIN_PASSWORD = 10

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
internal fun EmailStep(
    form: AuthForm,
    onBack: () -> Unit,
    onContinue: () -> Unit,
    onCreate: () -> Unit,
) {
    val focus = rememberAutoFocus()
    val ready = looksLikeEmail(form.email)
    AuthStepFrame(
        total = 2,
        current = 1,
        barLabel = stringResource(R.string.signin_bar, 1, 2),
        eyebrow = stringResource(R.string.signin_eyebrow, 1, 2),
        title = stringResource(R.string.signin_email_title),
        lead = stringResource(R.string.signin_email_lead),
        onBack = onBack,
        footer = {
            SaarthiButton(
                stringResource(R.string.action_continue),
                onContinue,
                Modifier.rise(stagger(5)),
                enabled = ready,
                trailing = Lucide.arrowRight,
            )
            OtherDoor(
                stringResource(R.string.signin_new_prompt),
                stringResource(R.string.welcome_create),
                onCreate,
                Modifier.rise(stagger(6)),
            )
        },
    ) {
        SaarthiField(
            value = form.email,
            onValueChange = { form.email = it },
            label = stringResource(R.string.field_email),
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
    onBack: () -> Unit,
    onSignIn: () -> Unit,
) {
    val c = Saarthi.colors
    val focus = rememberAutoFocus()
    val ready = form.password.length >= MIN_PASSWORD
    AuthStepFrame(
        total = 2,
        current = 2,
        barLabel = stringResource(R.string.signin_bar, 2, 2),
        eyebrow = stringResource(R.string.signin_eyebrow, 2, 2),
        title = stringResource(R.string.signin_password_title),
        onBack = onBack,
        footer = {
            SaarthiButton(
                stringResource(R.string.welcome_sign_in),
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
            LinkButton(stringResource(R.string.action_change), onBack, style = SType.body, weight = FontWeight.SemiBold)
        }
        PasswordField(
            value = form.password,
            onValueChange = { form.password = it },
            supporting = if (form.password.isNotEmpty() && !ready) {
                stringResource(R.string.password_rule, MIN_PASSWORD, form.password.length)
            } else {
                null
            },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (ready) onSignIn() }),
            focus = focus,
            modifier = Modifier
                .padding(top = 20.dp)
                .rise(stagger(4)),
        )
        AuthError(error)
    }
}
