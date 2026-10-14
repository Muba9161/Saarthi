package com.saarthi.driver.ui.shift.trips

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.BottomSheet
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.SaarthiField

/** What the code is for: finishing a delivery, or starting a booked ride. */
enum class HandoverKind { DELIVERY, PICKUP }

/**
 * The customer's 4-digit code, asked for at the handover — like a ride app's
 * OTP. The driver gets it from the customer in person; the server checks it.
 * A wrong code stays on the sheet with what the server said, so the driver
 * can ask again without starting over.
 */
@Composable
fun HandoverCodeSheet(
    kind: HandoverKind?,
    busy: Boolean,
    error: String?,
    onSubmit: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val c = Saarthi.colors
    var code by remember(kind) { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    val ready = code.length == CODE_LENGTH && !busy
    LaunchedEffect(kind) { if (kind != null) runCatching { focus.requestFocus() } }

    BackHandler(enabled = kind != null, onBack = onDismiss)
    BottomSheet(visible = kind != null, onDismiss = onDismiss) {
        val delivery = kind == HandoverKind.DELIVERY
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                stringResource(if (delivery) R.string.handover_delivery_title else R.string.handover_pickup_title),
                style = SType.sheetTitle,
                color = c.fg,
            )
            Text(
                stringResource(if (delivery) R.string.handover_delivery_lead else R.string.handover_pickup_lead),
                style = SType.lead,
                color = c.muted,
            )
            SaarthiField(
                value = code,
                onValueChange = { typed -> code = typed.filter(Char::isDigit).take(CODE_LENGTH) },
                label = stringResource(R.string.handover_field),
                leading = Lucide.key,
                error = error != null,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (ready) onSubmit(code) }),
                textStyle = SType.field.copy(fontSize = 26.sp, letterSpacing = 0.5.em, fontWeight = FontWeight.SemiBold),
                height = 68.dp,
                focus = focus,
            )
            error?.let { Text(it, style = SType.small, color = c.danger) }
            SaarthiButton(
                stringResource(if (delivery) R.string.handover_confirm_delivery else R.string.handover_confirm_pickup),
                onClick = { onSubmit(code) },
                modifier = Modifier.padding(top = 4.dp),
                tone = ButtonTone.BRAND,
                enabled = ready,
                busy = busy,
            )
            Text(
                stringResource(R.string.handover_no_code),
                style = SType.caption,
                color = c.subtle,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
            LinkButton(
                stringResource(R.string.action_cancel),
                onDismiss,
                Modifier.align(Alignment.CenterHorizontally),
                color = c.muted,
                weight = FontWeight.Medium,
            )
        }
    }
}

/** Digits in a handover code, as the server issues it. */
private const val CODE_LENGTH = 4
