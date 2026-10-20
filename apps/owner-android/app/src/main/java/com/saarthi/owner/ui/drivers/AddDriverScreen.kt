package com.saarthi.owner.ui.drivers

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.DriversApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.prettyDate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.InlineSpinner
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.papers.PaperScanner
import com.saarthi.owner.ui.papers.PaperText
import com.saarthi.owner.ui.papers.rememberPickers
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.LocalDate

/** A 10-digit Indian mobile number, with or without +91 — the server's own rule. */
private val MOBILE = Regex("^(\\+91)?[6-9]\\d{9}$")
private val EMAIL = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")

/**
 * Adding a driver, as the web's add-driver form does: their name, mobile and
 * email, and their licence — read off a photo of it, as every paper is.
 * Saarthi makes their account and a one-time link for them to set their own
 * password, which is shared with them from here.
 */
@Composable
fun AddDriverScreen(app: OwnerApp, account: SessionStore.Account, onAdded: () -> Unit) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var first by remember { mutableStateOf("") }
    var last by remember { mutableStateOf("") }
    var mobile by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var licence by remember { mutableStateOf("") }
    var licenceExpiry by remember { mutableStateOf<LocalDate?>(null) }
    var years by remember { mutableStateOf("") }
    var reading by remember { mutableStateOf(false) }
    var readNote by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var added by remember { mutableStateOf<DriversApi.Added?>(null) }

    val pickers = rememberPickers(imagesOnly = false) { picked ->
        val file = picked.getOrElse { readNote = it.message ?: Words.get(R.string.people_photo_unusable); return@rememberPickers }
        reading = true
        readNote = null
        scope.launch {
            val text = runCatching { PaperScanner.text(context, file) }.getOrNull()
            val read = text?.let { PaperText.read(it, PaperText.LICENCE, null) }
            read?.number?.let { licence = it }
            read?.expiresOn?.let { licenceExpiry = it }
            // The holder's name as the licence prints it: the last word is the surname.
            text?.let(PaperText::holderName)?.split(' ')?.let { words ->
                if (first.isBlank() && last.isBlank()) {
                    first = (if (words.size > 1) words.dropLast(1) else words).joinToString(" ")
                    if (words.size > 1) last = words.last()
                }
            }
            readNote = if (read?.number != null) Words.get(R.string.people_driver_licence_read) else Words.get(R.string.people_driver_licence_unread)
            reading = false
        }
    }

    val phone = mobile.filter { it.isDigit() || it == '+' }
    val experience = years.toIntOrNull() ?: 0
    val ready = first.trim().length >= 2 && last.trim().isNotEmpty() && MOBILE.matches(phone) &&
        EMAIL.matches(email.trim()) && licence.trim().length >= 4 && experience in 0..60

    val done = added
    if (done != null) {
        DetailScreen(eyebrow = stringResource(R.string.people_drivers), title = stringResource(R.string.people_driver_added_title)) {
            NoticeCard(stringResource(R.string.people_driver_added_notice, done.driver.fullName), NoticeTone.SUCCESS, icon = Lucide.check)
            Text(
                stringResource(R.string.people_driver_setup_hint),
                style = SType.body,
                color = c.muted,
            )
            if (done.setupUrl.isNotBlank()) {
                SaarthiButton(
                    stringResource(R.string.people_driver_share_setup),
                    onClick = {
                        val share = Intent(Intent.ACTION_SEND)
                            .setType("text/plain")
                            .putExtra(
                                Intent.EXTRA_TEXT,
                                Words.get(R.string.people_driver_setup_message, done.driver.fullName.substringBefore(' '), done.setupUrl),
                            )
                        context.startActivity(Intent.createChooser(share, Words.get(R.string.people_driver_share_setup)))
                    },
                    leading = Lucide.send,
                )
            }
            SaarthiButton(
                stringResource(R.string.people_driver_open_page),
                onClick = { navigator.replace("driver-${done.driver.id}") { DriverScreen(app, account, done.driver, onChanged = onAdded) } },
                tone = ButtonTone.SECONDARY,
            )
        }
        return
    }

    DetailScreen(
        eyebrow = stringResource(R.string.people_drivers),
        title = stringResource(R.string.people_driver_add_title),
        footer = {
            problem?.let { NoticeCard(it, NoticeTone.DANGER) }
            SaarthiButton(
                stringResource(R.string.people_driver_add),
                onClick = {
                    busy = true
                    problem = null
                    scope.launch {
                        try {
                            added = app.drivers.add(
                                DriversApi.NewDriver(first, last, email, phone, licence, licenceExpiry, experience),
                            )
                            onAdded()
                        } catch (failure: Exception) {
                            if (failure is CancellationException) throw failure
                            problem = failure.readable()
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = ready && !busy && !reading,
                busy = busy,
                busyText = stringResource(R.string.people_driver_adding),
            )
        },
    ) {
        Text(stringResource(R.string.people_driver_their_licence), style = SType.fieldLabel, color = c.muted)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SaarthiButton(stringResource(R.string.people_driver_scan_licence), onClick = pickers.takePhoto, enabled = !reading, leading = Lucide.camera, modifier = Modifier.weight(1f))
            SaarthiButton(stringResource(R.string.people_driver_choose_file), onClick = pickers.chooseFile, enabled = !reading, tone = ButtonTone.SECONDARY, modifier = Modifier.weight(1f))
        }
        if (reading) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                InlineSpinner(c.primary)
                Text(stringResource(R.string.people_driver_reading_licence), style = SType.small, color = c.muted)
            }
        }
        readNote?.let { Text(it, style = SType.small, color = c.muted) }
        CompactField(licence, { licence = it.uppercase().take(40) }, stringResource(R.string.people_driver_licence_number))
        licenceExpiry?.let { Text(stringResource(R.string.people_driver_licence_valid_till, prettyDate(it.toString()) ?: it.toString()), style = SType.small, color = c.muted) }

        CompactField(first, { first = it.take(60) }, stringResource(R.string.people_driver_first_name))
        CompactField(last, { last = it.take(60) }, stringResource(R.string.people_driver_last_name))
        CompactField(mobile, { mobile = it.take(14) }, stringResource(R.string.people_driver_mobile), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
        if (mobile.isNotBlank() && !MOBILE.matches(phone)) Text(stringResource(R.string.people_driver_mobile_invalid), style = SType.small, color = c.danger)
        CompactField(email, { email = it.trim().take(120) }, stringResource(R.string.people_driver_email), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        if (email.isNotBlank() && !EMAIL.matches(email.trim())) Text(stringResource(R.string.people_driver_email_invalid), style = SType.small, color = c.danger)
        CompactField(years, { years = it.filter(Char::isDigit).take(2) }, stringResource(R.string.people_driver_years_optional), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
    }
}
