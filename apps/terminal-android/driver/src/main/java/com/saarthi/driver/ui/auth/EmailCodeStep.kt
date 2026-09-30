package com.saarthi.driver.ui.auth

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.driver.BuildConfig
import com.saarthi.driver.R
import com.saarthi.driver.network.DriverApi
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.SaarthiField
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger
import kotlinx.coroutines.delay

/** Digits in the emailed code, as the server issues it. */
private const val CODE_LENGTH = 6

/**
 * "Check your email" — the code that proves the address, just before the
 * account is opened. The server will not create an account without it.
 */
@Composable
internal fun EmailCodeStep(
    form: AuthForm,
    sent: DriverApi.EmailCode,
    sending: Boolean,
    error: String?,
    onBack: () -> Unit,
    onResend: () -> Unit,
    onCreate: () -> Unit,
) {
    val c = Saarthi.colors
    val focus = rememberAutoFocus()
    val ready = form.emailCode.length == CODE_LENGTH
    var wait by remember(sent) { mutableIntStateOf(sent.resendIn) }
    LaunchedEffect(sent) {
        while (wait > 0) {
            delay(1_000)
            wait--
        }
    }

    AuthStepFrame(
        total = 6, current = 6,
        barLabel = stringResource(R.string.register_bar, 6, 6),
        eyebrow = stringResource(R.string.email_code_eyebrow),
        title = stringResource(R.string.email_code_title),
        lead = stringResource(R.string.email_code_lead, sent.sentTo),
        onBack = onBack,
        footer = {
            SaarthiButton(
                stringResource(R.string.review_create),
                onCreate,
                Modifier.rise(stagger(5)),
                tone = ButtonTone.BRAND,
                enabled = ready,
            )
            LinkButton(
                if (wait > 0) stringResource(R.string.email_code_resend_in, wait) else stringResource(R.string.email_code_resend),
                onResend,
                Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(top = 6.dp),
                color = c.muted,
                weight = FontWeight.Medium,
                enabled = wait == 0 && !sending,
            )
        },
    ) {
        SaarthiField(
            value = form.emailCode,
            onValueChange = { typed -> form.emailCode = typed.filter(Char::isDigit).take(CODE_LENGTH) },
            label = stringResource(R.string.field_email_code),
            focus = focus,
            textStyle = SType.mono(22.sp, FontWeight.SemiBold, 0.3.em),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (ready) onCreate() }),
            modifier = Modifier
                .padding(top = 26.dp)
                .rise(stagger(4)),
        )
        // A server with no mailbox hands the code back; only a debug build shows it.
        if (BuildConfig.DEBUG) {
            sent.devCode?.let {
                Text(
                    stringResource(R.string.email_code_dev, it),
                    style = SType.small,
                    color = c.subtle,
                    modifier = Modifier.padding(top = 12.dp),
                )
            }
        }
        AuthError(error)
    }
}
