package com.saarthi.driver.ui.ride.share

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import com.saarthi.core.SaarthiApp
import com.saarthi.core.util.DebugLog
import com.saarthi.driver.R
import com.saarthi.driver.data.FamilyContact
import com.saarthi.driver.data.IndianMobile
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.MobilePrefix
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SaarthiField
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * One family member, by mobile number or email address in the same field:
 * digits read as a number behind "+91", and a letter or an @ turns it into
 * an address, the "+91" going. The rule shows under it only once the contact
 * is wrong — a list of five fields each repeating it would bury the form.
 *
 * [checked] marks the contact wrong even before it is complete, once the
 * rider has tried to go on with it half typed.
 */
@Composable
internal fun FamilyContactField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    checked: Boolean = false,
    onRemove: (() -> Unit)? = null,
    focus: FocusRequester? = null,
    onDone: () -> Unit = {},
) {
    val c = Saarthi.colors
    val email = FamilyContact.isEmail(value)
    // A number is judged once its ten digits are in; an address only once the rider tries to go on.
    val complete = checked || (!email && value.length == IndianMobile.LENGTH)
    val wrong = value.isNotEmpty() && complete && !FamilyContact.isValid(FamilyContact.normalised(value))
    val remove: (@Composable () -> Unit)? = onRemove?.let { action ->
        {
            CircleButton(
                path = Lucide.close,
                description = stringResource(R.string.share_contact_remove),
                onClick = action,
                background = Color.Transparent,
                ink = c.muted,
                elevated = false,
            )
        }
    }
    SaarthiField(
        value = value,
        onValueChange = { onValueChange(FamilyContact.typed(it)) },
        label = stringResource(R.string.share_contact_label),
        supporting = if (wrong) stringResource(R.string.share_contact_rule) else null,
        error = wrong,
        focus = focus,
        textStyle = SType.field.copy(letterSpacing = 0.04.em),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        prefix = if (email) null else ({ MobilePrefix() }),
        trailing = remove,
        modifier = modifier,
    )
}

/** The contacts typed on this phone, read back — "+91 98765 43210, asha@example.com". */
@Composable
internal fun NamedContacts(named: List<String>, modifier: Modifier = Modifier, color: Color = Saarthi.colors.muted) {
    if (named.isEmpty()) return
    Text(
        stringResource(R.string.sharing_named, named.joinToString(", ", transform = FamilyContact::shown)),
        style = SType.small,
        color = color,
        modifier = modifier,
    )
}

/** "10:42 pm", in the phone's zone and the app's language; null for nothing usable. */
internal fun clockTime(iso: String?, locale: Locale): String? {
    val instant = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return null
    return DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale)
        .withZone(ZoneId.systemDefault()).format(instant)
}

/**
 * Open the phone's share sheet with the live link, so the rider picks
 * WhatsApp, SMS or anything else. Humsafar itself is left off the list — it
 * takes shared text as a destination, and would only hand the link back.
 */
internal fun sendShareLink(context: Context, message: String, chooserTitle: String) {
    val send = Intent(Intent.ACTION_SEND)
        .setType("text/plain")
        .putExtra(Intent.EXTRA_TEXT, message)
    val chooser = Intent.createChooser(send, chooserTitle).putExtra(
        Intent.EXTRA_EXCLUDE_COMPONENTS,
        arrayOf(ComponentName(context, SaarthiApp.from(context).mainActivity)),
    )
    runCatching { context.startActivity(chooser) }
        .onFailure { DebugLog.warn("ShareLink", "No app could take the link: ${it.message}") }
}
