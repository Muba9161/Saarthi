package com.saarthi.driver.ui.design

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The things a driver presses and types into.
 *
 * There is exactly one primary action per screen and it is [FleetButton], full
 * width, orange, at the bottom of the reading order. Everything secondary is
 * quieter by a clear step — an outline, or plain text — because a screen with
 * two equally loud buttons is a screen where a driver in a hurry presses the
 * wrong one.
 *
 * Every control here clears the 56dp touch floor without being told to.
 */

/**
 * The action.
 *
 * Orange, wide, and the only thing on the screen that looks like this. It
 * carries its own busy state rather than being disabled while a caller shows a
 * spinner somewhere else: the button the driver pressed is where they are
 * looking, and it is where the answer belongs.
 *
 * White type at 17sp Bold clears WCAG's 3:1 for large text against this
 * orange — which is why the label is bold rather than merely heavy-looking.
 */
@Composable
fun FleetButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
    busyLabel: String? = null,
    icon: ImageVector? = null,
    height: Dp = 58.dp,
) {
    val live = enabled && !busy
    val shape = RoundedCornerShape(18.dp)

    val fill: Brush = if (live) EmberGradient else SolidColor(OnyxDeep)
    val ink = if (live) Color.White else Slate

    Row(
        modifier
            .fillMaxWidth()
            .height(height)
            .clip(shape)
            .background(fill)
            .pressable(enabled = live, scaleTo = 0.975f, onClick = onClick)
            .padding(horizontal = FleetSpace.roomy),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (busy) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = Color.White,
            )
            Spacer(Modifier.width(FleetSpace.snug))
        } else if (icon != null) {
            Icon(icon, contentDescription = null, tint = ink, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(FleetSpace.tight))
        }

        Text(
            text = if (busy) busyLabel ?: label else label,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = if (busy) Color.White else ink,
            textAlign = TextAlign.Center,
            maxLines = 1,
        )
    }
}

/**
 * A second choice, said quietly.
 *
 * An outline rather than a fill. It is a real option and it looks like one —
 * this is not a disabled button — but it cannot be confused with the primary
 * action by somebody glancing at the screen.
 */
@Composable
fun FleetOutlineButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    tint: Color = Chalk,
    height: Dp = 56.dp,
) {
    val shape = RoundedCornerShape(18.dp)
    val ink = if (enabled) tint else Slate

    Row(
        modifier
            .fillMaxWidth()
            .height(height)
            .clip(shape)
            .background(Onyx)
            .border(1.dp, if (enabled) Hairline else Hairline.copy(alpha = 0.5f), shape)
            .pressable(enabled = enabled, scaleTo = 0.975f, onClick = onClick)
            .padding(horizontal = FleetSpace.roomy),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = ink, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(FleetSpace.tight))
        }
        Text(
            label,
            style = MaterialTheme.typography.titleMedium,
            color = ink,
            maxLines = 1,
        )
    }
}

/**
 * The quietest way out of a screen.
 *
 * Still 56dp tall and still full width where it is used as a row, because
 * "quiet" is about visual weight and never about how hard something is to hit.
 */
@Composable
fun FleetTextButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tint: Color = EmberBright,
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(FleetTouchTarget)
            .clip(RoundedCornerShape(FleetRadius.field))
            .pressable(enabled = enabled, scaleTo = 0.98f, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            color = if (enabled) tint else Slate,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * A field.
 *
 * Material's `OutlinedTextField` underneath, deliberately: it already knows
 * about autofill, IME actions, selection handles, accessibility and every
 * keyboard quirk on every handset a fleet might issue. What is changed is the
 * paint — a filled dark well with a hairline that lights orange on focus.
 *
 * The label stays visible above the value once there is one, rather than being
 * a placeholder that vanishes. A driver who has typed half a registration and
 * looked up at the truck needs to know which box they are in.
 */
@Composable
fun FleetField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    isError: Boolean = false,
    supportingText: String? = null,
    leadingIcon: ImageVector? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    textStyle: TextStyle? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        enabled = enabled,
        singleLine = singleLine,
        isError = isError,
        label = { Text(label) },
        placeholder = placeholder?.let { { Text(it, color = Slate) } },
        leadingIcon = leadingIcon?.let {
            { Icon(it, contentDescription = null, tint = Ash, modifier = Modifier.size(20.dp)) }
        },
        trailingIcon = trailingIcon,
        supportingText = supportingText?.let {
            { Text(it, style = MaterialTheme.typography.bodySmall) }
        },
        visualTransformation = visualTransformation,
        keyboardOptions = keyboardOptions,
        textStyle = textStyle ?: MaterialTheme.typography.bodyLarge.copy(color = Chalk),
        shape = RoundedCornerShape(FleetRadius.field),
        colors = OutlinedTextFieldDefaults.colors(
            focusedTextColor = Chalk,
            unfocusedTextColor = Chalk,
            disabledTextColor = Slate,
            focusedContainerColor = OnyxRaised,
            unfocusedContainerColor = OnyxRaised,
            disabledContainerColor = Onyx,
            errorContainerColor = OnyxRaised,
            cursorColor = EmberBright,
            focusedBorderColor = Ember,
            unfocusedBorderColor = Hairline,
            disabledBorderColor = Hairline.copy(alpha = 0.5f),
            errorBorderColor = AlertRed,
            focusedLabelColor = EmberBright,
            unfocusedLabelColor = Ash,
            disabledLabelColor = Slate,
            errorLabelColor = AlertRed,
            focusedPlaceholderColor = Slate,
            unfocusedPlaceholderColor = Slate,
            focusedSupportingTextColor = Ash,
            unfocusedSupportingTextColor = Ash,
            errorSupportingTextColor = AlertRed,
            focusedLeadingIconColor = EmberBright,
            unfocusedLeadingIconColor = Ash,
        ),
    )
}

/**
 * A field for a password, with the eye.
 *
 * The toggle is not a convenience. A driver typing a password one-handed in a
 * dark cab gets it wrong, and an app that will not let them look is an app that
 * sends them round the "forgotten password" loop for a transposed character.
 */
@Composable
fun FleetPasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    isError: Boolean = false,
    supportingText: String? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
) {
    var visible by remember { mutableStateOf(false) }

    FleetField(
        value = value,
        onValueChange = onValueChange,
        label = label,
        modifier = modifier,
        enabled = enabled,
        isError = isError,
        supportingText = supportingText,
        keyboardOptions = keyboardOptions,
        visualTransformation = if (visible) {
            VisualTransformation.None
        } else {
            PasswordVisualTransformation()
        },
        trailingIcon = {
            IconButton(onClick = { visible = !visible }) {
                Icon(
                    if (visible) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility,
                    contentDescription = if (visible) "Hide password" else "Show password",
                    tint = Ash,
                    modifier = Modifier.size(20.dp),
                )
            }
        },
    )
}

/**
 * A setting, as a row with a switch.
 *
 * The whole row is the target rather than just the switch, which is a 32dp
 * object and below the floor on its own. The subtitle always says the current
 * state in a word — "On", "Off", "Not set up on this phone" — because a switch
 * position read at a glance in poor light is not reliable on its own.
 */
@Composable
fun FleetToggleRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: ImageVector? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(FleetRadius.tile))
            .pressable(enabled = enabled) { onCheckedChange(!checked) }
            .padding(vertical = FleetSpace.snug)
            .alpha(if (enabled) 1f else 0.5f),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(FleetSpace.snug),
    ) {
        if (icon != null) IconChip(icon = icon, tinted = checked && enabled, size = 40.dp)

        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = Chalk)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Ash)
        }

        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            enabled = enabled,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = Ember,
                checkedBorderColor = Ember,
                uncheckedThumbColor = Ash,
                uncheckedTrackColor = OnyxDeep,
                uncheckedBorderColor = Hairline,
                disabledUncheckedThumbColor = Slate,
                disabledUncheckedTrackColor = OnyxDeep,
            ),
        )
    }
}

/**
 * A busy line: a spinner and a sentence saying what is being waited for.
 *
 * Never a bare spinner. "Loading" is not information; "Sending your request…"
 * tells a driver whether it is safe to put the phone down.
 */
@Composable
fun FleetWorking(
    message: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(FleetSpace.snug),
    ) {
        Box(
            Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(OnyxRaised),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = EmberBright,
            )
        }
        Text(message, style = MaterialTheme.typography.bodyMedium, color = Ash)
    }
}

