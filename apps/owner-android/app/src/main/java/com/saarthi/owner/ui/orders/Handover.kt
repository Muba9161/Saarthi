package com.saarthi.owner.ui.orders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.owner.R
import com.saarthi.owner.network.HandoverApi
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.NotesField
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SaarthiField
import com.saarthi.owner.ui.design.brandGradient
import com.saarthi.owner.ui.design.card

/*
 * Handover codes on screen — the customer's 4-digit code the driver enters to
 * finish a delivery or start a ride, like a ride app's OTP.
 */

/**
 * The customer's own code, big enough to read out, while the driver still
 * needs it — and afterwards, how the handover was confirmed.
 */
@Composable
fun CustomerCodeCard(handover: HandoverApi.Handover, modifier: Modifier = Modifier) {
    val delivery = handover.purpose == HandoverApi.DELIVERY
    val code = handover.code
    when {
        handover.pending && code != null -> Column(
            modifier
                .fillMaxWidth()
                .brandGradient(RoundedCornerShape(24.dp))
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Eyebrow(if (delivery) stringResource(R.string.market_handover_your_delivery_code) else stringResource(R.string.market_handover_your_pickup_code), color = Color.White.copy(alpha = 0.78f))
            Text(
                code.toCharArray().joinToString(" "),
                style = SType.display.copy(fontSize = 40.sp, letterSpacing = 0.12.em),
                color = Color.White,
            )
            Text(
                if (delivery) {
                    stringResource(R.string.market_handover_delivery_give)
                } else {
                    stringResource(R.string.market_handover_pickup_tell)
                },
                style = SType.small,
                color = Color.White.copy(alpha = 0.85f),
            )
        }
        handover.status == "VERIFIED" -> NoticeCard(
            if (delivery) stringResource(R.string.market_handover_delivery_verified) else stringResource(R.string.market_handover_pickup_verified),
            NoticeTone.SUCCESS,
            modifier,
            icon = Lucide.check,
        )
        handover.status == "OVERRIDDEN" -> NoticeCard(
            listOfNotNull(
                if (delivery) stringResource(R.string.market_handover_delivery_overridden) else stringResource(R.string.market_handover_pickup_overridden),
                handover.overrideReason?.let { stringResource(R.string.market_handover_reason, it) },
            ).joinToString(" "),
            NoticeTone.WARNING,
            modifier,
            icon = Lucide.alertTriangle,
        )
    }
}

/**
 * Whether the customer's code was entered, as the fleet sees it — never the
 * code. The owner may confirm without it when the customer cannot give it.
 */
@Composable
fun FleetHandoverCard(
    handover: HandoverApi.Handover,
    canOverride: Boolean,
    onOverride: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    val delivery = handover.purpose == HandoverApi.DELIVERY
    val (icon, well, ink, line) = when (handover.status) {
        "VERIFIED" -> Look(Lucide.check, c.successSoft, c.success, stringResource(R.string.market_handover_code_entered))
        "OVERRIDDEN" -> Look(Lucide.alertTriangle, c.warningSoft, c.warning, stringResource(R.string.market_handover_confirmed_without))
        else -> Look(Lucide.key, c.primarySoft, c.primary, if (delivery) stringResource(R.string.market_handover_waiting_delivery) else stringResource(R.string.market_handover_waiting_pickup))
    }
    Column(modifier.fillMaxWidth().card(radius = 22.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            IconWell(icon, well = well, ink = ink, size = 40.dp, shape = CircleShape, iconSize = 18.dp)
            Column(Modifier.weight(1f)) {
                Eyebrow(if (delivery) stringResource(R.string.market_handover_delivery_code) else stringResource(R.string.market_handover_pickup_code))
                Text(line, style = SType.bodyStrong, color = c.fg)
                when {
                    handover.pending -> Text(
                        if (delivery) stringResource(R.string.market_handover_driver_enters_drop) else stringResource(R.string.market_handover_driver_enters_pickup),
                        style = SType.caption,
                        color = c.muted,
                    )
                    handover.overrideReason != null -> Text(stringResource(R.string.market_handover_reason, handover.overrideReason), style = SType.caption, color = c.muted)
                }
            }
        }
        if (handover.pending && canOverride) {
            LinkButton(stringResource(R.string.market_handover_override_link), onOverride, style = SType.smallStrong, color = c.warning)
        }
    }
}

private data class Look(val icon: String, val well: Color, val ink: Color, val line: String)

/**
 * The owner confirming a handover without the code. Never without a reason:
 * it is kept on record and the customer is told.
 */
@Composable
fun OverrideHandoverSheet(
    purpose: String?,
    busy: Boolean,
    error: String?,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val c = Saarthi.colors
    var reason by remember(purpose) { mutableStateOf("") }
    BottomSheet(visible = purpose != null, onDismiss = { if (!busy) onDismiss() }) {
        val delivery = purpose == HandoverApi.DELIVERY
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(
                if (delivery) stringResource(R.string.market_handover_override_delivery_title) else stringResource(R.string.market_handover_override_pickup_title),
                style = SType.sheetTitle,
                color = c.fg,
            )
            Text(
                stringResource(R.string.market_handover_override_body),
                style = SType.body,
                color = c.muted,
            )
            NotesField(reason, { reason = it.take(500) }, label = stringResource(R.string.market_handover_override_reason_label), minHeight = 90.dp)
            error?.let { NoticeCard(it, NoticeTone.DANGER) }
            SaarthiButton(
                if (delivery) stringResource(R.string.market_handover_override_delivery_button) else stringResource(R.string.market_handover_override_pickup_button),
                onClick = { onConfirm(reason.trim()) },
                tone = ButtonTone.DANGER_OUTLINE,
                enabled = reason.trim().length >= 10 && !busy,
                busy = busy,
            )
        }
    }
}

/**
 * The customer's code as the driver would enter it, typed in this app instead:
 * the passenger's pickup code to start a booked ride, or the customer's
 * delivery code to finish a delivery — or, when they cannot give it, the
 * owner's override.
 */
@Composable
fun HandoverCodeSheet(
    purpose: String,
    visible: Boolean,
    busy: Boolean,
    error: String?,
    canOverride: Boolean,
    onSubmit: (String) -> Unit,
    onNoCode: () -> Unit,
    onDismiss: () -> Unit,
) {
    val c = Saarthi.colors
    val delivery = purpose == HandoverApi.DELIVERY
    var code by remember(visible) { mutableStateOf("") }
    BottomSheet(visible = visible, onDismiss = { if (!busy) onDismiss() }) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(if (delivery) stringResource(R.string.market_handover_customer_delivery_code) else stringResource(R.string.market_handover_passenger_pickup_code), style = SType.sheetTitle, color = c.fg)
            Text(
                if (delivery) {
                    stringResource(R.string.market_handover_ask_customer)
                } else {
                    stringResource(R.string.market_handover_ask_passenger)
                },
                style = SType.body,
                color = c.muted,
            )
            SaarthiField(
                value = code,
                onValueChange = { typed -> code = typed.filter(Char::isDigit).take(4) },
                label = stringResource(R.string.market_handover_code_label),
                leading = Lucide.key,
                error = error != null,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                textStyle = SType.field.copy(fontSize = 26.sp, letterSpacing = 0.5.em, fontWeight = FontWeight.SemiBold),
                height = 68.dp,
            )
            error?.let { Text(it, style = SType.small, color = c.danger) }
            SaarthiButton(
                if (delivery) stringResource(R.string.market_handover_complete_delivery) else stringResource(R.string.market_handover_start_ride),
                onClick = { onSubmit(code) },
                enabled = code.length == 4 && !busy,
                busy = busy,
                leading = if (delivery) Lucide.check else Lucide.play,
            )
            if (canOverride) {
                LinkButton(
                    if (delivery) stringResource(R.string.market_handover_customer_cant) else stringResource(R.string.market_handover_passenger_cant),
                    onNoCode,
                    Modifier.align(Alignment.CenterHorizontally),
                    style = SType.smallStrong,
                    color = c.warning,
                )
            }
        }
    }
}
