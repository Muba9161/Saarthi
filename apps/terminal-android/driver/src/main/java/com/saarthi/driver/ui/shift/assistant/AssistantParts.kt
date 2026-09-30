@file:OptIn(ExperimentalLayoutApi::class)

package com.saarthi.driver.ui.shift.assistant

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.MapInk
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.shift.humanised

/** What the driver asked, in their own words, on the right. */
@Composable
internal fun TranscriptBubble(text: String, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    BoxWithConstraints(modifier.fillMaxWidth(), contentAlignment = Alignment.TopEnd) {
        Text(
            stringResource(R.string.assistant_quote, text),
            style = SType.rowTitle,
            color = c.onPrimary,
            modifier = Modifier
                .widthIn(max = maxWidth * 0.8f)
                .clip(TranscriptShape)
                .background(c.primary)
                .padding(horizontal = 16.dp, vertical = 12.dp),
        )
    }
}

/**
 * Saarthi's answer, with its caveats and where it came from.
 *
 * The sources are shown rather than implied: a driver deciding whether to
 * trust "your fitness certificate expires in six days" should see that it came
 * from a records lookup and not from a model's impression.
 */
@Composable
internal fun AnswerBubble(answer: String, caveats: List<String>, sources: List<String>, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(
        modifier
            .fillMaxWidth()
            .clip(AnswerShape)
            .background(c.elevated)
            .border(1.dp, MapInk.lineStrong, AnswerShape)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(answer, style = SType.lead, color = c.fg)
        caveats.forEach { Text(it, style = SType.small, color = c.warning) }
        if (sources.isNotEmpty()) {
            Text(
                stringResource(R.string.assistant_from, sources.joinToString(", ") { it.humanised() }),
                style = SType.caption,
                color = c.subtle,
            )
        }
    }
}

/** "Try asking" and the four questions the design offers, each asked with one tap. */
@Composable
internal fun Suggestions(onAsk: (String) -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val questions = listOf(
        R.string.assistant_suggest_vehicle,
        R.string.assistant_suggest_fuel,
        R.string.assistant_suggest_service,
        R.string.assistant_suggest_parking,
    ).map { stringResource(it) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Eyebrow(stringResource(R.string.assistant_try_asking))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            questions.forEach { question ->
                Box(
                    Modifier
                        .defaultMinSize(minHeight = 40.dp)
                        .clip(CircleShape)
                        .background(MapInk.lineStrong)
                        .border(1.dp, ChipRing, CircleShape)
                        .pressable { onAsk(question) }
                        .padding(horizontal = 14.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(question, style = SType.chip.copy(fontWeight = FontWeight.Medium), color = c.fg)
                }
            }
        }
    }
}

/** The typed route to Saarthi — always there, and the only one when the microphone is not. */
@Composable
internal fun AskField(
    value: String,
    onValueChange: (String) -> Unit,
    canSend: Boolean,
    onSend: () -> Unit,
    focus: FocusRequester,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    val shape = RoundedCornerShape(18.dp)
    Row(
        modifier
            .fillMaxWidth()
            .height(56.dp)
            .clip(shape)
            .background(c.elevated)
            .border(1.dp, c.input, shape)
            .padding(start = 16.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier
                .weight(1f)
                .focusRequester(focus),
            singleLine = true,
            textStyle = SType.lead.copy(color = c.fg),
            cursorBrush = SolidColor(c.primary),
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Sentences,
                imeAction = ImeAction.Send,
            ),
            keyboardActions = KeyboardActions(onSend = { onSend() }),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) {
                        Text(stringResource(R.string.assistant_ask_hint), style = SType.lead, color = c.subtle, maxLines = 1)
                    }
                    inner()
                }
            },
        )
        CircleButton(
            Lucide.send,
            stringResource(R.string.assistant_send),
            onSend,
            Modifier.alpha(if (canSend) 1f else 0.45f),
            background = c.primary,
            ink = c.onPrimary,
            elevated = false,
            shape = RoundedCornerShape(14.dp),
        )
    }
}

private val TranscriptShape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = 4.dp, bottomStart = 18.dp)
private val AnswerShape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = 18.dp, bottomStart = 4.dp)

/** The chips' hairline: white at 10%, which no palette token carries. */
private val ChipRing = Color.White.copy(alpha = 0.1f)
