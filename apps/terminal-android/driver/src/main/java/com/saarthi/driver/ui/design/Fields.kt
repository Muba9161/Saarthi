package com.saarthi.driver.ui.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.driver.R

/**
 * The glow ring a focused field wears: `box-shadow: 0 0 0 4px glow`.
 *
 * Drawn outside the field's own bounds, which is what makes it read as focus
 * rather than as a thicker border.
 */
private fun Modifier.focusGlow(show: Boolean, color: Color, radius: Dp, spread: Dp = 4.dp): Modifier =
    if (!show) this else drawBehind {
        val grow = spread.toPx()
        drawRoundRect(
            color = color,
            topLeft = Offset(-grow, -grow),
            size = Size(size.width + grow * 2, size.height + grow * 2),
            cornerRadius = CornerRadius(radius.toPx() + grow),
        )
    }

/**
 * The design's `.field`: a 60-tall rounded box with an optional icon.
 *
 * Unfocused it has a 1px input border and a grey label; focused, a 2px primary
 * border, a glow ring and a primary label — the one place on a step the eye
 * should go.
 */
@Composable
fun SaarthiField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    leading: String? = null,
    placeholder: String? = null,
    supporting: String? = null,
    error: Boolean = false,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    textStyle: TextStyle = SType.field,
    height: Dp = 60.dp,
    radius: Dp = 16.dp,
    enabled: Boolean = true,
    focus: FocusRequester? = null,
    prefix: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val c = Saarthi.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(radius)
    val accent = if (error) c.danger else c.primary

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        label?.let {
            Text(it, style = SType.fieldLabel, color = if (focused || error) accent else c.muted)
        }
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = if (focus != null) Modifier.focusRequester(focus) else Modifier,
            enabled = enabled,
            singleLine = true,
            textStyle = textStyle.copy(color = c.fg),
            cursorBrush = SolidColor(c.primary),
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            visualTransformation = visualTransformation,
            interactionSource = interaction,
            decorationBox = { inner ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(height)
                        .focusGlow(focused || error, if (error) c.dangerBg else c.glow, radius)
                        .clip(shape)
                        .background(c.elevated)
                        .border(if (focused || error) 2.dp else 1.dp, if (focused || error) accent else c.input, shape)
                        .padding(start = if (prefix != null) 8.dp else 16.dp, end = if (trailing != null) 6.dp else 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    prefix?.invoke()
                    leading?.let { LineIcon(it, size = 20.dp, color = if (focused) c.primary else c.muted) }
                    Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                        if (value.isEmpty() && placeholder != null) {
                            Text(placeholder, style = textStyle, color = c.subtle, maxLines = 1)
                        }
                        inner()
                    }
                    trailing?.invoke()
                }
            },
        )
        supporting?.let {
            Text(it, style = SType.small, color = if (error) c.danger else c.subtle)
        }
    }
}

/** A password field whose eye button shows and hides what was typed. */
@Composable
fun PasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String = stringResource(R.string.field_password),
    supporting: String? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    focus: FocusRequester? = null,
) {
    var shown by remember { mutableStateOf(false) }
    val c = Saarthi.colors
    SaarthiField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        label = label,
        leading = Lucide.lock,
        supporting = supporting,
        focus = focus,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        visualTransformation = if (shown) VisualTransformation.None else PasswordVisualTransformation(),
        textStyle = if (shown) SType.field else SType.field.copy(letterSpacing = 0.12.em),
        trailing = {
            CircleButton(
                path = if (shown) Lucide.eyeOff else Lucide.eye,
                description = stringResource(if (shown) R.string.password_hide else R.string.password_show),
                onClick = { shown = !shown },
                background = Color.Transparent,
                ink = c.muted,
                elevated = false,
                iconSize = 20.dp,
                stroke = 2f,
            )
        },
    )
}

/**
 * The number-plate input: white plate, black edge, blue IND strip.
 *
 * Drawn as the real thing so a driver copying a registration off the truck in
 * front of them is comparing like with like.
 */
@Composable
fun PlateField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "DL 01 AB 1234",
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    val c = Saarthi.colors
    val shape = RoundedCornerShape(14.dp)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.field_vehicle_number), style = SType.fieldLabel, color = c.primary)
        Row(
            Modifier
                .fillMaxWidth()
                .height(76.dp)
                .focusGlow(true, c.glow, 14.dp, spread = 7.dp)
                .focusGlow(true, Color(0xFF18181B), 14.dp, spread = 3.dp)
                .clip(shape)
                .background(Color.White),
        ) {
            Box(
                Modifier
                    .width(38.dp)
                    .fillMaxHeight()
                    .background(Color(0xFF1E3A8A))
                    .padding(bottom = 8.dp),
                contentAlignment = Alignment.BottomCenter,
            ) {
                Text("IND", style = SType.microStrong.copy(fontWeight = FontWeight.Bold), color = Color.White)
            }
            BasicTextField(
                value = value,
                onValueChange = { onValueChange(it.uppercase()) },
                singleLine = true,
                textStyle = SType.plate(28.sp).copy(color = Color(0xFF18181B), textAlign = TextAlign.Center),
                cursorBrush = SolidColor(Color(0xFF18181B)),
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    autoCorrectEnabled = false,
                    imeAction = androidx.compose.ui.text.input.ImeAction.Done,
                ),
                keyboardActions = keyboardActions,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight(),
                decorationBox = { inner ->
                    Box(Modifier.fillMaxWidth().fillMaxHeight(), contentAlignment = Alignment.Center) {
                        if (value.isEmpty()) {
                            Text(
                                placeholder,
                                style = SType.plate(28.sp),
                                color = Color(0xFFB4B4BC),
                                textAlign = TextAlign.Center,
                            )
                        }
                        inner()
                    }
                },
            )
        }
    }
}

/**
 * The compact field on the fuel slip: a small label, 54 tall, 18/600 figures.
 */
@Composable
fun CompactField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    textStyle: TextStyle = SType.field.copy(fontSize = 18.sp, fontWeight = FontWeight.SemiBold),
) {
    val c = Saarthi.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(14.dp)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = SType.small.copy(fontWeight = FontWeight.Medium), color = c.muted)
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = textStyle.copy(color = c.fg),
            cursorBrush = SolidColor(c.primary),
            keyboardOptions = keyboardOptions,
            interactionSource = interaction,
            decorationBox = { inner ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(54.dp)
                        .focusGlow(focused, c.glow, 14.dp)
                        .clip(shape)
                        .background(c.elevated)
                        .border(if (focused) 2.dp else 1.dp, if (focused) c.primary else c.input, shape)
                        .padding(horizontal = 12.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    if (value.isEmpty() && placeholder != null) {
                        Text(placeholder, style = SType.lead, color = c.subtle)
                    }
                    inner()
                }
            },
        )
    }
}

/** A multi-line box for notes and problem reports. */
@Composable
fun NotesField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    background: Color = Saarthi.colors.elevated,
    border: Color = Saarthi.colors.input,
    ink: Color = Saarthi.colors.fg,
    labelColor: Color = Saarthi.colors.muted,
    minHeight: Dp = 104.dp,
    placeholder: String? = null,
) {
    val shape = RoundedCornerShape(16.dp)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = SType.small.copy(fontWeight = FontWeight.Medium), color = labelColor)
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            textStyle = SType.lead.copy(color = ink),
            cursorBrush = SolidColor(Saarthi.colors.primary),
            decorationBox = { inner ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = minHeight)
                        .clip(shape)
                        .background(background)
                        .border(1.dp, border, shape)
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                ) {
                    if (value.isEmpty() && placeholder != null) {
                        Text(placeholder, style = SType.lead, color = labelColor)
                    }
                    inner()
                }
            },
        )
    }
}
