package com.saarthi.driver.ui.shift.expense

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
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
import com.saarthi.driver.ui.design.Eyebrow
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
 * Step two: the photo just taken, what the slip was for, its figures, and Save.
 *
 * A fuel slip asks for litres and the amount, with the pump and the odometer
 * optional and the price per litre shown rather than asked — a wrong-looking
 * rate is how a mistyped figure is caught before it becomes a fuel-economy
 * number the fleet acts on. Every other kind asks only for the amount, with
 * who was paid and a note optional: the photograph carries the rest.
 */
@Composable
internal fun SlipDetailsStep(
    draft: ExpenseSlipDraft,
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
            KindPicker(draft.kind, onPick = { if (!saving) draft.kind = it })
            if (draft.kind == ExpenseKind.FUEL) FuelFigures(draft) else ExpenseFigures(draft)
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

/** What the slip was for, as chips — one tap, no menu to open beside a running engine. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun KindPicker(kind: ExpenseKind, onPick: (ExpenseKind) -> Unit) {
    val c = Saarthi.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Eyebrow(stringResource(R.string.expense_kind_label), color = c.muted)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ExpenseKind.entries.forEach { option ->
                val on = option == kind
                val label = stringResource(option.label)
                Row(
                    Modifier
                        .height(40.dp)
                        .clip(CircleShape)
                        .background(if (on) c.primary else c.card)
                        .border(1.dp, if (on) c.primary else c.border, CircleShape)
                        .semantics { selected = on }
                        .pressable(role = Role.RadioButton, scale = 0.96f, label = label) { onPick(option) }
                        .padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    LineIcon(option.icon, size = 16.dp, color = if (on) c.onPrimary else c.muted)
                    Text(label, style = SType.smallStrong, color = if (on) c.onPrimary else c.fg)
                }
            }
        }
    }
}

/** The slip as photographed, dropped onto a dark tray, with the way to take it again. */
@Composable
private fun SlipPhoto(draft: ExpenseSlipDraft, onRetake: () -> Unit) {
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
 * The slip falls in from above, turning, and settles at a slight angle — as a
 * till roll dropped on a counter does.
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

private val Figures = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Next)

/** Litres and amount side by side, then the pump and the odometer, then the rate they make. */
@Composable
private fun FuelFigures(draft: ExpenseSlipDraft) {
    val c = Saarthi.colors
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
                keyboardOptions = Figures,
            )
            CompactField(
                value = draft.amount,
                onValueChange = { draft.amount = it.asFigure() },
                label = stringResource(R.string.fuel_amount),
                modifier = Modifier.weight(1f),
                keyboardOptions = Figures,
            )
        }
        CompactField(
            value = draft.pump,
            onValueChange = { draft.pump = it.take(NAME_LIMIT) },
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

/** The amount, who was paid, and a note — for a toll, parking, a repair and the rest. */
@Composable
private fun ExpenseFigures(draft: ExpenseSlipDraft) {
    val optional = stringResource(R.string.fuel_optional)
    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 20.dp)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CompactField(
            value = draft.amount,
            onValueChange = { draft.amount = it.asFigure() },
            label = stringResource(R.string.fuel_amount),
            keyboardOptions = Figures,
        )
        CompactField(
            value = draft.vendor,
            onValueChange = { draft.vendor = it.take(NAME_LIMIT) },
            label = stringResource(R.string.expense_vendor),
            placeholder = optional,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next),
            textStyle = SType.field.copy(fontSize = 16.sp, fontWeight = FontWeight.Normal),
        )
        CompactField(
            value = draft.notes,
            onValueChange = { draft.notes = it.take(NOTES_LIMIT) },
            label = stringResource(R.string.expense_note),
            placeholder = optional,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
            textStyle = SType.field.copy(fontSize = 16.sp, fontWeight = FontWeight.Normal),
        )
    }
}

/** Digits and one kind of decimal mark only, and no longer than any real figure. */
private fun String.asFigure(): String = filter { it.isDigit() || it == '.' || it == ',' }.take(FIGURE_LIMIT)

/** A pump or payee name longer than this is refused by the server. */
private const val NAME_LIMIT = 120

/** The server keeps a note to this length. */
private const val NOTES_LIMIT = 300

/** Ten characters covers ₹10,00,000.00 and a seven-figure odometer. */
private const val FIGURE_LIMIT = 10

/** Step three: saved, with a second slip one tap away. */
@Composable
internal fun SlipSavedStep(onAnother: () -> Unit, onDone: () -> Unit, modifier: Modifier = Modifier) {
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
