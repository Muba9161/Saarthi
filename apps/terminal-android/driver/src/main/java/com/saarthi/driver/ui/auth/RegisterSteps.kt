package com.saarthi.driver.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.PasswordField
import com.saarthi.driver.ui.design.PlateMono
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.SaarthiField
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.bottomRule
import com.saarthi.driver.ui.design.brandGradient
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.popIn
import com.saarthi.driver.ui.design.rememberLoop
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger

/**
 * The same expression `phoneSchema` uses, minus the +91 the field shows itself.
 *
 * Kept in step with `packages/shared/src/validation/common.ts`; the server
 * stays the authority, this only puts the rejection under the field.
 */
private val MOBILE = Regex("""^[6-9]\d{9}$""")

/** Ten digits, however the driver typed them — spaces, a pasted +91, a leading 0. */
internal fun mobileDigits(raw: String): String {
    val digits = raw.filter(Char::isDigit)
    return when {
        digits.length == 12 && digits.startsWith("91") -> digits.drop(2)
        digits.length == 11 && digits.startsWith("0") -> digits.drop(1)
        else -> digits
    }.take(10)
}

private fun nameReady(form: AuthForm) = form.firstName.trim().length >= 2 && form.lastName.isNotBlank()
private fun mobileReady(form: AuthForm) = MOBILE.matches(form.phone)
private fun licenceReady(form: AuthForm) = form.licence.trim().length >= 4

/** A licence typed in full, or none at all — "I'll do it later" leaves it blank. */
private fun licenceSettled(form: AuthForm) = form.licence.isBlank() || licenceReady(form)
private fun accountReady(form: AuthForm) = looksLikeEmail(form.email) && form.password.length >= MIN_PASSWORD
private fun codeReady(form: AuthForm) = form.joiningCode.isBlank() || form.joiningCode.trim().length >= 4

/** One registration step, chosen by [step]. */
@Composable
internal fun RegisterStep(
    step: AuthStep,
    form: AuthForm,
    error: String?,
    sendingCode: Boolean,
    onGo: (AuthStep, Boolean) -> Unit,
    onSignIn: () -> Unit,
    onCreate: () -> Unit,
) {
    val number = when (step) {
        AuthStep.NAME -> 1
        AuthStep.MOBILE -> 2
        AuthStep.LICENCE -> 3
        AuthStep.ACCOUNT -> 4
        AuthStep.FLEET -> 5
        else -> 6
    }
    val back = { onGo(step.previous, false) }
    val eyebrow = if (step == AuthStep.FLEET) {
        stringResource(R.string.register_eyebrow_optional, number, 6)
    } else {
        stringResource(R.string.register_eyebrow, number, 6)
    }
    val bar = stringResource(R.string.register_bar, number, 6)

    when (step) {
        AuthStep.NAME -> {
            val focus = rememberAutoFocus()
            AuthStepFrame(
                total = 6, current = 1, barLabel = bar, eyebrow = eyebrow,
                title = stringResource(R.string.register_name_title),
                lead = stringResource(R.string.register_name_lead),
                onBack = back,
                footer = {
                    ContinueButton(nameReady(form)) { onGo(AuthStep.MOBILE, true) }
                    OtherDoor(
                        stringResource(R.string.register_have_prompt),
                        stringResource(R.string.welcome_sign_in),
                        onSignIn,
                        Modifier.rise(stagger(6)),
                    )
                },
            ) {
                Column(
                    Modifier
                        .padding(top = 26.dp)
                        .rise(stagger(4)),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    SaarthiField(
                        value = form.firstName,
                        onValueChange = { form.firstName = it },
                        label = stringResource(R.string.field_first_name),
                        focus = focus,
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Words,
                            imeAction = ImeAction.Next,
                        ),
                    )
                    SaarthiField(
                        value = form.lastName,
                        onValueChange = { form.lastName = it },
                        label = stringResource(R.string.field_last_name),
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Words,
                            imeAction = ImeAction.Done,
                        ),
                        keyboardActions = KeyboardActions(onDone = {
                            if (nameReady(form)) onGo(AuthStep.MOBILE, true)
                        }),
                    )
                }
            }
        }

        AuthStep.MOBILE -> {
            val focus = rememberAutoFocus()
            val c = Saarthi.colors
            val typed = form.phone.isNotEmpty()
            val valid = mobileReady(form)
            AuthStepFrame(
                total = 6, current = 2, barLabel = bar, eyebrow = eyebrow,
                title = stringResource(R.string.register_mobile_title),
                lead = stringResource(R.string.register_mobile_lead),
                onBack = back,
                footer = { ContinueButton(valid) { onGo(AuthStep.LICENCE, true) } },
            ) {
                SaarthiField(
                    value = form.phone,
                    onValueChange = { form.phone = mobileDigits(it) },
                    label = stringResource(R.string.field_mobile),
                    supporting = stringResource(R.string.mobile_rule),
                    error = typed && form.phone.length == 10 && !valid,
                    focus = focus,
                    textStyle = SType.field.copy(letterSpacing = 0.04.em),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { if (valid) onGo(AuthStep.LICENCE, true) }),
                    prefix = {
                        Box(
                            Modifier
                                .height(42.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(c.sunken)
                                .padding(horizontal = 12.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("+91", style = SType.bodyStrong.copy(fontSize = 16.sp), color = c.fg)
                        }
                    },
                    trailing = if (valid) {
                        {
                            IconWell(
                                Lucide.check,
                                well = c.success,
                                ink = Color.White,
                                size = 28.dp,
                                shape = CircleShape,
                                iconSize = 14.dp,
                                stroke = 3f,
                                modifier = Modifier.padding(end = 10.dp).popIn(),
                            )
                        }
                    } else {
                        null
                    },
                    modifier = Modifier
                        .padding(top = 26.dp)
                        .rise(stagger(4)),
                )
            }
        }

        AuthStep.LICENCE -> {
            val focus = rememberAutoFocus()
            AuthStepFrame(
                total = 6, current = 3, barLabel = bar, eyebrow = eyebrow,
                title = stringResource(R.string.register_licence_title),
                lead = stringResource(R.string.register_licence_lead),
                onBack = back,
                footer = {
                    ContinueButton(licenceReady(form), delay = 6) { onGo(AuthStep.ACCOUNT, true) }
                    // Not every driver has the card in their pocket at sign-up.
                    // They add it later from Profile; the fleet sees it as not
                    // added until then.
                    LinkButton(
                        stringResource(R.string.licence_later),
                        {
                            form.licence = ""
                            onGo(AuthStep.ACCOUNT, true)
                        },
                        Modifier
                            .align(Alignment.CenterHorizontally)
                            .padding(top = 6.dp)
                            .rise(stagger(6)),
                        color = Saarthi.colors.muted,
                        weight = FontWeight.Medium,
                    )
                },
            ) {
                LicenceCard(form.licence, Modifier.padding(top = 22.dp).rise(stagger(4)))
                LicenceField(
                    value = form.licence,
                    onValueChange = { form.licence = it },
                    onDone = { if (licenceReady(form)) onGo(AuthStep.ACCOUNT, true) },
                    focus = focus,
                    modifier = Modifier
                        .padding(top = 20.dp)
                        .rise(stagger(5)),
                )
            }
        }

        AuthStep.ACCOUNT -> {
            val focus = rememberAutoFocus()
            AuthStepFrame(
                total = 6, current = 4, barLabel = bar, eyebrow = eyebrow,
                title = stringResource(R.string.register_account_title),
                lead = stringResource(R.string.register_account_lead),
                onBack = back,
                footer = { ContinueButton(accountReady(form)) { onGo(AuthStep.FLEET, true) } },
            ) {
                Column(
                    Modifier
                        .padding(top = 24.dp)
                        .rise(stagger(4)),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    SaarthiField(
                        value = form.email,
                        onValueChange = { form.email = it },
                        label = stringResource(R.string.field_email),
                        leading = Lucide.atSign,
                        focus = focus,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Email,
                            autoCorrectEnabled = false,
                            imeAction = ImeAction.Next,
                        ),
                    )
                    PasswordField(
                        value = form.password,
                        onValueChange = { form.password = it },
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            imeAction = ImeAction.Done,
                        ),
                        keyboardActions = KeyboardActions(onDone = {
                            if (accountReady(form)) onGo(AuthStep.FLEET, true)
                        }),
                    )
                    StrengthMeter(form.password)
                }
            }
        }

        AuthStep.FLEET -> {
            val c = Saarthi.colors
            AuthStepFrame(
                total = 6, current = 5, barLabel = bar, eyebrow = eyebrow,
                title = stringResource(R.string.register_fleet_title),
                lead = stringResource(R.string.register_fleet_lead),
                onBack = back,
                footer = {
                    ContinueButton(codeReady(form), delay = 5) { onGo(AuthStep.REVIEW, true) }
                    LinkButton(
                        stringResource(R.string.action_skip),
                        {
                            form.joiningCode = ""
                            onGo(AuthStep.REVIEW, true)
                        },
                        Modifier
                            .align(Alignment.CenterHorizontally)
                            .padding(top = 6.dp)
                            .rise(stagger(6)),
                        color = c.muted,
                        weight = FontWeight.Medium,
                    )
                },
            ) {
                JoiningCodeField(
                    value = form.joiningCode,
                    onValueChange = { form.joiningCode = it },
                    modifier = Modifier
                        .padding(top = 24.dp)
                        .rise(stagger(4)),
                )
                InfoNote(
                    stringResource(R.string.register_fleet_note),
                    Modifier
                        .padding(top = 16.dp)
                        .rise(stagger(5)),
                )
            }
        }

        else -> ReviewStep(form, error, sendingCode, bar, eyebrow, back, onGo, onCreate)
    }
}

/** The design's step button: "Continue →". */
@Composable
private fun ContinueButton(enabled: Boolean, delay: Int = 5, onClick: () -> Unit) {
    SaarthiButton(
        stringResource(R.string.action_continue),
        onClick,
        Modifier.rise(stagger(delay)),
        enabled = enabled,
        trailing = Lucide.arrowRight,
    )
}

/** The joining code, in monospace with a key icon — used here and in the join sheet. */
@Composable
internal fun JoiningCodeField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    onDone: () -> Unit = {},
) {
    val c = Saarthi.colors
    SaarthiField(
        value = value,
        onValueChange = { onValueChange(it.uppercase().take(32)) },
        label = stringResource(R.string.field_joining_code),
        placeholder = "SR-7K4M2Q",
        textStyle = SType.mono(19.sp, FontWeight.SemiBold, 0.1.em),
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.Characters,
            autoCorrectEnabled = false,
            imeAction = ImeAction.Done,
        ),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        prefix = {
            LineIcon(
                Lucide.key,
                size = 20.dp,
                color = c.primary,
                fill = Lucide.keyDot,
                modifier = Modifier.padding(start = 8.dp),
            )
        },
        modifier = modifier,
    )
}

/** A sunken grey note with an info icon — "No code yet? Skip this". */
/** The licence number field: monospaced, capitals, and no autocorrect. */
@Composable
internal fun LicenceField(
    value: String,
    onValueChange: (String) -> Unit,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
    focus: FocusRequester? = null,
) {
    SaarthiField(
        value = value,
        onValueChange = { onValueChange(it.uppercase()) },
        label = stringResource(R.string.field_licence),
        supporting = stringResource(R.string.licence_hint),
        focus = focus,
        textStyle = SType.mono(17.sp, FontWeight.SemiBold, 0.06.em),
        // A licence number is not a word, and a keyboard that corrects one
        // stops a driver working.
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.Characters,
            autoCorrectEnabled = false,
            imeAction = ImeAction.Done,
        ),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        modifier = modifier,
    )
}

@Composable
internal fun InfoNote(text: String, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(c.sunken)
            .padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        LineIcon(Lucide.info, size = 18.dp, color = c.muted, modifier = Modifier.padding(top = 2.dp))
        Text(text, style = SType.small, color = c.muted)
    }
}

/**
 * A drawn driving licence with the number picked out, so a driver knows which
 * line of the card they are being asked to copy.
 */
@Composable
internal fun LicenceCard(typed: String, modifier: Modifier = Modifier) {
    val pulse by rememberLoop(900, Ease.standard, reverse = true, rest = 0f, label = "licence-highlight")
    val shape = RoundedCornerShape(22.dp)
    Column(
        modifier
            .fillMaxWidth()
            .shadow(16.dp, shape, spotColor = Color(0xFF021D40), ambientColor = Color.Transparent)
            .brandGradient(shape)
            .padding(18.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Eyebrow(stringResource(R.string.licence_card_label), Modifier.weight(1f), color = Color.White.copy(alpha = 0.75f))
            Box(
                Modifier
                    .size(width = 30.dp, height = 22.dp)
                    .clip(RoundedCornerShape(5.dp))
                    .background(Brush.linearGradient(listOf(Color(0xFFF7D57A), Color(0xFFC9A23F)))),
            )
        }
        Row(Modifier.padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(
                Modifier
                    .size(width = 58.dp, height = 70.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color.White.copy(alpha = 0.16f)),
                contentAlignment = Alignment.Center,
            ) {
                LineIcon(Lucide.person, size = 28.dp, color = Color.White.copy(alpha = 0.8f), stroke = 1.8f)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    Modifier
                        .fillMaxWidth(0.72f)
                        .height(8.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(Color.White.copy(alpha = 0.32f)),
                )
                Box(
                    Modifier
                        .fillMaxWidth(0.48f)
                        .height(8.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(Color.White.copy(alpha = 0.22f)),
                )
                Text(
                    typed.ifBlank { "UP32 20190012345" },
                    style = SType.mono(14.sp, FontWeight.SemiBold, 0.04.em),
                    color = Color.White,
                    maxLines = 1,
                    modifier = Modifier
                        .padding(top = 6.dp)
                        .drawBehind {
                            val grow = (2f + 3f * pulse).dp.toPx()
                            drawRoundRect(
                                Color(0xFFFE5D09).copy(alpha = 1f - 0.65f * pulse),
                                topLeft = Offset(-grow, -grow),
                                size = Size(size.width + grow * 2, size.height + grow * 2),
                                cornerRadius = CornerRadius(8.dp.toPx() + grow),
                            )
                            drawRoundRect(
                                Color(0xFF022A59),
                                cornerRadius = CornerRadius(8.dp.toPx()),
                            )
                        }
                        .padding(horizontal = 9.dp, vertical = 6.dp),
                )
            }
        }
    }
}

/**
 * How good the password is, as the design draws it: four bars and a sentence.
 *
 * Only the length is a rule — the server's ten characters. The other bars
 * reward what makes a password harder to guess, and never block anything.
 */
@Composable
private fun StrengthMeter(password: String) {
    val c = Saarthi.colors
    val long = password.length >= MIN_PASSWORD
    val score = listOf(
        long,
        password.any(Char::isDigit) || password.any { !it.isLetterOrDigit() },
        password.any(Char::isUpperCase) && password.any(Char::isLowerCase),
        password.length >= 14,
    ).count { it }
    val fill = if (long) c.success else c.warning
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            repeat(4) { index ->
                Box(
                    Modifier
                        .weight(1f)
                        .height(5.dp)
                        .clip(CircleShape)
                        .background(if (password.isNotEmpty() && index < score) fill else c.track),
                )
            }
        }
        Row(Modifier.fillMaxWidth()) {
            Text(
                stringResource(if (long) R.string.password_good else R.string.password_short),
                style = SType.smallStrong,
                color = if (long) c.success else if (password.isEmpty()) c.subtle else c.warning,
                modifier = Modifier.weight(1f),
            )
            Text(
                stringResource(R.string.password_rule, MIN_PASSWORD, password.length),
                style = SType.small,
                color = c.subtle,
            )
        }
    }
}

/** Step 6: every answer on one card, each with a way back to change it. */
@Composable
private fun ReviewStep(
    form: AuthForm,
    error: String?,
    sendingCode: Boolean,
    bar: String,
    eyebrow: String,
    onBack: () -> Unit,
    onGo: (AuthStep, Boolean) -> Unit,
    onCreate: () -> Unit,
) {
    val c = Saarthi.colors
    val mono = SType.rowTitle.copy(fontFamily = PlateMono, fontWeight = FontWeight.Medium)
    val rows = listOf(
        Triple(stringResource(R.string.review_name), "${form.firstName.trim()} ${form.lastName.trim()}", AuthStep.NAME),
        Triple(stringResource(R.string.field_mobile), "+91 ${form.phone.take(5)} ${form.phone.drop(5)}", AuthStep.MOBILE),
        Triple(
            stringResource(R.string.field_licence),
            form.licence.trim().ifBlank { stringResource(R.string.review_licence_later) },
            AuthStep.LICENCE,
        ),
        Triple(stringResource(R.string.field_email), form.email.trim(), AuthStep.ACCOUNT),
        Triple(
            stringResource(R.string.field_joining_code),
            form.joiningCode.trim().ifBlank { stringResource(R.string.review_no_code) },
            AuthStep.FLEET,
        ),
    )
    val ready = nameReady(form) && mobileReady(form) && licenceSettled(form) && accountReady(form) && codeReady(form)
    AuthStepFrame(
        total = 6, current = 6, barLabel = bar, eyebrow = eyebrow,
        title = stringResource(R.string.review_title),
        onBack = onBack,
        footer = {
            SaarthiButton(
                stringResource(R.string.review_create),
                onCreate,
                Modifier.rise(stagger(5)),
                tone = ButtonTone.BRAND,
                enabled = ready,
                busy = sendingCode,
                busyText = stringResource(R.string.review_sending_code),
            )
        },
    ) {
        Column(
            Modifier
                .padding(top = 18.dp)
                .rise(stagger(3))
                .card(),
        ) {
            rows.forEachIndexed { index, (label, value, target) ->
                val monospaced = (target == AuthStep.LICENCE && form.licence.isNotBlank()) ||
                    (target == AuthStep.FLEET && form.joiningCode.isNotBlank())
                Row(
                    Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 60.dp)
                        .bottomRule(c.border, show = index < rows.lastIndex)
                        .padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(label, style = SType.caption, color = c.muted)
                        Text(value, style = if (monospaced) mono else SType.rowTitle, color = c.fg)
                    }
                    LinkButton(stringResource(R.string.action_edit), { onGo(target, false) }, style = SType.body)
                }
            }
        }
        Text(
            stringResource(R.string.review_terms),
            style = SType.small,
            color = c.subtle,
            modifier = Modifier
                .padding(start = 4.dp, end = 4.dp, top = 16.dp)
                .rise(stagger(4)),
        )
        AuthError(error)
    }
}
