package com.saarthi.driver.ui.shift.fuel

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.core.ui.LocalReducedMotion
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.ButtonRow
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.CompactField
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.EqualRow
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.shift.flow.FlowOutcome
import com.saarthi.driver.ui.shift.flow.OutcomeTone

/**
 * Step two: the photo just taken, the figures printed largest on the slip, and
 * Save.
 *
 * Litres and the amount are what the server requires; the pump name and the
 * odometer are optional, the odometer already filled in when the vehicle
 * reports one. The price per litre is shown, not asked — it is exactly
 * amount ÷ litres, and a wrong-looking rate is how a mistyped figure is caught
 * before it becomes a fuel-economy number the fleet acts on.
 */
@Composable
internal fun FuelFiguresStep(
    draft: FuelSlipDraft,
    saving: Boolean,
    problem: String?,
    onRetake: () -> Unit,
    onSave: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            SlipPhoto(draft, onRetake = { if (!saving) onRetake() })
            FiguresCard(draft)
            problem?.let { NoticeCard(it, NoticeTone.DANGER) }
        }
        SaarthiButton(
            stringResource(R.string.fuel_save),
            onSave,
            Modifier.padding(top = 14.dp),
            enabled = draft.complete,
            busy = saving,
            busyText = stringResource(R.string.fuel_saving),
        )
    }
}

/** The slip as photographed, dropped onto a dark tray, with the way to take it again. */
@Composable
private fun SlipPhoto(draft: FuelSlipDraft, onRetake: () -> Unit) {
    val retake = stringResource(R.string.fuel_retake)
    Box(
        Modifier
            .fillMaxWidth()
            .height(170.dp)
            .clip(RoundedCornerShape(22.dp))
            .background(Tray),
        contentAlignment = Alignment.Center,
    ) {
        draft.photo?.let { photo ->
            Image(
                bitmap = photo,
                contentDescription = stringResource(R.string.fuel_photo_alt),
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .size(width = 150.dp, height = 140.dp)
                    .dropIn()
                    .shadow(12.dp, RoundedCornerShape(4.dp), spotColor = Color.Black.copy(alpha = 0.6f))
                    .clip(RoundedCornerShape(4.dp)),
            )
        }
        Box(
            Modifier
                .align(Alignment.BottomEnd)
                .padding(10.dp)
                .pressable(scale = 0.94f, label = retake, onClick = onRetake)
                .height(38.dp)
                .clip(CircleShape)
                .background(Color.Black.copy(alpha = 0.55f))
                .padding(horizontal = 12.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(retake, style = SType.captionStrong, color = Color.White)
        }
    }
}

/** The design's tray behind the photo — a warm near-black no theme token carries. */
private val Tray = Color(0xFF2A2724)

/**
 * `.fs-drop`: the slip falls in from above, turning, and settles at a slight
 * angle — as a till roll dropped on a counter does.
 */
private fun Modifier.dropIn(): Modifier = composed {
    val reduced = LocalReducedMotion.current
    val progress = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) { if (!reduced) progress.animateTo(1f, tween(700, easing = Ease.out)) }
    val fall = with(LocalDensity.current) { 30.dp.toPx() }
    graphicsLayer {
        val p = progress.value
        alpha = p.coerceIn(0f, 1f)
        translationY = -(1f - p) * fall
        rotationZ = -8f + 5f * p
        val scale = 0.9f + 0.1f * p
        scaleX = scale
        scaleY = scale
    }
}

/** Litres and amount side by side, then the pump and the odometer, then the rate they make. */
@Composable
private fun FiguresCard(draft: FuelSlipDraft) {
    val c = Saarthi.colors
    val figures = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Next)
    val optional = stringResource(R.string.fuel_optional)
    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 20.dp)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        EqualRow {
            CompactField(
                value = draft.litres,
                onValueChange = { draft.litres = it.asFigure() },
                label = stringResource(R.string.fuel_litres),
                modifier = Modifier.weight(1f),
                keyboardOptions = figures,
            )
            CompactField(
                value = draft.amount,
                onValueChange = { draft.amount = it.asFigure() },
                label = stringResource(R.string.fuel_amount),
                modifier = Modifier.weight(1f),
                keyboardOptions = figures,
            )
        }
        CompactField(
            value = draft.pump,
            onValueChange = { draft.pump = it.take(PUMP_LIMIT) },
            label = stringResource(R.string.fuel_pump),
            placeholder = optional,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next),
            textStyle = SType.field.copy(fontSize = 16.sp, fontWeight = FontWeight.Normal),
        )
        CompactField(
            value = draft.odometer,
            onValueChange = { draft.odometer = it.asFigure() },
            label = stringResource(R.string.fuel_odometer),
            placeholder = optional,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
        )
        val litres = draft.litresValue
        val amount = draft.amountValue
        if (litres != null && amount != null) {
            val rate = stringResource(R.string.fuel_rate, amount / litres)
            val sentence = stringResource(R.string.fuel_per_litre, rate)
            val at = sentence.indexOf(rate)
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(c.primaryWash)
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                LineIcon(Lucide.calculator, size = 18.dp, color = c.primary)
                Text(
                    buildAnnotatedString {
                        append(sentence)
                        if (at >= 0) addStyle(SpanStyle(fontWeight = FontWeight.SemiBold), at, at + rate.length)
                    },
                    style = SType.body,
                    color = c.fg,
                )
            }
        }
    }
}

/** Digits and one kind of decimal mark only, and no longer than any real figure. */
private fun String.asFigure(): String = filter { it.isDigit() || it == '.' || it == ',' }.take(FIGURE_LIMIT)

/** A pump name longer than this is refused by the server. */
private const val PUMP_LIMIT = 120

/** Ten characters covers ₹10,00,000.00 and a seven-figure odometer. */
private const val FIGURE_LIMIT = 10

/** Step three: saved, with a second slip one tap away. */
@Composable
internal fun FuelSavedStep(onAnother: () -> Unit, onDone: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier) {
        FlowOutcome(
            tone = OutcomeTone.SUCCESS,
            title = stringResource(R.string.fuel_saved_title),
            body = stringResource(R.string.fuel_saved_body),
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 12.dp),
        )
        ButtonRow {
            SaarthiButton(
                stringResource(R.string.fuel_add_another),
                onAnother,
                Modifier.weight(1f),
                tone = ButtonTone.SECONDARY,
            )
            SaarthiButton(stringResource(R.string.action_done), onDone, Modifier.weight(1f))
        }
    }
}
