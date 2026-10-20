package com.saarthi.owner.ui.account

import android.app.DatePickerDialog
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.network.AccountApi
import com.saarthi.owner.network.PlacesApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.PlaceSearchScreen
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.prettyDate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.Avatar
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.NotesField
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SaarthiSwitch
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.papers.CertificateText
import com.saarthi.owner.ui.papers.PaperText
import com.saarthi.owner.ui.papers.SlipKind
import com.saarthi.owner.ui.papers.SlipStep
import com.saarthi.owner.ui.papers.rememberPickers
import com.saarthi.owner.ui.papers.rememberSlipReader
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import java.time.LocalDate

/** Who a photo belongs to: the person (`USER`) or the business (`ORGANIZATION`). */
internal class PhotoOwners(val userId: String, val organizationId: String?)

/** The media owner a photo field uploads under, as the web's profile page decides it. */
private fun AccountApi.Field.photoOwner(owners: PhotoOwners): Pair<String, String>? =
    if (organizationScoped) owners.organizationId?.let { "ORGANIZATION" to it } else "USER" to owners.userId

/** Whether this person may change [field]: a business's own field needs an owner or admin. */
internal fun AccountApi.Profile.canEdit(field: AccountApi.Field): Boolean = !field.organizationScoped || canEditOrganization

/**
 * One profile section to change, as the web's profile page changes it: each
 * field by its kind, and only what was touched is sent, so saving cannot blank
 * a field that was never opened. Photos are uploaded on their own, at once.
 */
@Composable
internal fun ProfileSectionScreen(
    accountApi: AccountApi,
    places: PlacesApi,
    profile: AccountApi.Profile,
    section: AccountApi.Section,
    owners: PhotoOwners,
    onSaved: () -> Unit,
) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    val draft = remember { mutableStateMapOf<String, JsonElement>() }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }

    fun valueOf(field: AccountApi.Field): JsonElement? = draft[field.key] ?: profile.valueOf(section, field)
    // A section of photos only has nothing left to save once each has uploaded.
    val hasTypedFields = section.fields.any { it.kind != "IMAGE" && profile.canEdit(it) }
    val saveBar: @Composable ColumnScope.() -> Unit = {
        problem?.let { NoticeCard(it, NoticeTone.DANGER) }
        SaarthiButton(
            stringResource(R.string.people_profile_save),
            onClick = {
                busy = true
                problem = null
                scope.launch {
                    try {
                        accountApi.saveSection(section.key, draft.toMap())
                        onSaved()
                        navigator.pop()
                    } catch (failure: Exception) {
                        if (failure is CancellationException) throw failure
                        problem = failure.readable()
                    } finally {
                        busy = false
                    }
                }
            },
            enabled = draft.isNotEmpty() && !busy,
            busy = busy,
            busyText = stringResource(R.string.people_saving),
        )
    }

    DetailScreen(
        eyebrow = stringResource(R.string.people_account_profile),
        title = section.title.ifBlank { stringResource(R.string.people_account_edit) },
        footer = saveBar.takeIf { hasTypedFields },
    ) {
        // A section a paper can fill: the licence card, the business's certificate.
        sectionPaper(section.key)?.let { (kind, parse) ->
            val paper = rememberSlipReader(parse, emptyMap(), onProblem = { problem = it }) { found ->
                problem = null
                found.forEach { (key, value) ->
                    val field = section.fields.firstOrNull { it.key == key }?.takeIf(profile::canEdit) ?: return@forEach
                    // A business keeps the name it chose; the certificate's name only fills a blank one.
                    val chosen = (valueOf(field) as? JsonPrimitive)?.contentOrNull
                    if (key in FILL_IF_BLANK && !chosen.isNullOrBlank()) return@forEach
                    draft[key] = value
                }
            }
            SlipStep(paper, kind, good = { it.isNotEmpty() })
        }
        section.fields.filter { it.kind != "GEO" || profile.canEdit(it) }.forEach { field ->
            val editable = profile.canEdit(field)
            if (field.kind == "IMAGE") {
                // A photo is saved the moment it uploads; the account page reads it again then.
                PhotoField(accountApi, field, profile.valueOf(section, field), field.photoOwner(owners), editable, onChanged = onSaved)
            } else {
                FieldEditor(field, valueOf(field), editable, places) { draft[field.key] = it }
            }
            if (!editable) Hint(stringResource(R.string.people_profile_owner_only))
        }
    }
}

/** Fields a paper only fills when they are empty. */
private val FILL_IF_BLANK = setOf("name")

/**
 * The paper that fills a profile section, and what it fills by field key (the
 * keys of `packages/shared` profiles): a driving licence for "licence", a GST,
 * Udyam or incorporation certificate for "business". Other sections have none.
 */
private fun sectionPaper(sectionKey: String): Pair<SlipKind, (String) -> Map<String, JsonElement>>? = when (sectionKey) {
    "licence" -> SlipKind.LICENCE_CARD to { text ->
        val read = PaperText.read(text, PaperText.LICENCE, plate = null)
        buildMap {
            read.number?.let { put("licenseNumber", JsonPrimitive(it)) }
            PaperText.licenceClasses(text)?.let { put("licenseClass", JsonPrimitive(it)) }
            read.expiresOn?.let { put("licenseExpiryDate", JsonPrimitive(it.toString())) }
        }
    }
    "business" -> SlipKind.CERTIFICATE to { text ->
        val read = CertificateText.read(text)
        buildMap {
            read.gstin?.let { put("taxNumber", JsonPrimitive(it)) }
            read.registrationNumber?.let { put("registrationNumber", JsonPrimitive(it)) }
            read.foundedYear?.let { put("foundedYear", JsonPrimitive(it)) }
            read.name?.let { put("name", JsonPrimitive(it)) }
        }
    }
    else -> null
}

/** One field, by its kind. */
@Composable
private fun FieldEditor(field: AccountApi.Field, value: JsonElement?, editable: Boolean, places: PlacesApi, onChange: (JsonElement) -> Unit) {
    val c = Saarthi.colors
    val label = if (field.required) field.label else stringResource(R.string.people_profile_optional, field.label)
    val text = (value as? JsonPrimitive)?.contentOrNull.orEmpty()
    when (field.kind) {
        "TEXTAREA" -> NotesField(text, { if (editable) onChange(JsonPrimitive(it.take(field.maxLength ?: 2000))) }, label = label, minHeight = 96.dp)
        "SELECT" -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(label, style = SType.fieldLabel, color = c.muted)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                field.options.forEach { option ->
                    ChoiceChip(option.label, selected = text == option.value, onClick = { if (editable) onChange(JsonPrimitive(option.value)) })
                }
            }
        }
        "BOOLEAN" -> Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = SType.rowTitle, color = c.fg, modifier = Modifier.weight(1f))
            SaarthiSwitch(
                checked = (value as? JsonPrimitive)?.booleanOrNull == true,
                enabled = editable,
                label = field.label,
                onCheckedChange = { onChange(JsonPrimitive(it)) },
            )
        }
        "DATE" -> DateField(label, text, editable) { onChange(JsonPrimitive(it.toString())) }
        "TAGS", "MULTI_SELECT" -> CompactField(
            (value as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }?.joinToString(", ") ?: text,
            { typed -> if (editable) onChange(JsonArray(typed.split(',').map { JsonPrimitive(it.trimStart()) })) },
            stringResource(R.string.people_profile_comma_hint, label),
            placeholder = field.placeholder,
        )
        "GEO" -> GeoField(label, value, places) { onChange(it) }
        else -> CompactField(
            text,
            { typed ->
                if (!editable) return@CompactField
                val kept = field.maxLength?.let { typed.take(it) } ?: typed
                onChange(if (field.kind == "NUMBER") kept.toDoubleOrNull()?.let(::JsonPrimitive) ?: JsonNull else JsonPrimitive(kept))
            },
            label,
            placeholder = field.placeholder,
            keyboardOptions = KeyboardOptions(
                keyboardType = when (field.kind) {
                    "EMAIL" -> KeyboardType.Email
                    "PHONE" -> KeyboardType.Phone
                    "NUMBER" -> KeyboardType.Decimal
                    "URL" -> KeyboardType.Uri
                    else -> KeyboardType.Text
                },
            ),
        )
    }
    field.help?.takeIf { it.isNotBlank() && field.kind != "IMAGE" }?.let { Text(it, style = SType.caption, color = c.subtle) }
}

@Composable
private fun DateField(label: String, iso: String, editable: Boolean, onPick: (LocalDate) -> Unit) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val current = runCatching { LocalDate.parse(iso.take(10)) }.getOrNull()
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 14.dp, color = c.elevated, ring = c.input, elevated = false)
            .pressable(enabled = editable, scale = 0.99f, label = label) {
                val shown = current ?: LocalDate.now()
                DatePickerDialog(context, { _, y, m, d -> onPick(LocalDate.of(y, m + 1, d)) }, shown.year, shown.monthValue - 1, shown.dayOfMonth).show()
            }
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        LineIcon(Lucide.calendar, size = 18.dp, color = c.primary)
        Text(label, style = SType.small, color = c.muted, modifier = Modifier.weight(1f))
        Text(prettyDate(iso) ?: stringResource(R.string.people_choose), style = SType.smallStrong, color = if (current == null) c.subtle else c.fg)
    }
}

/** A point on the map, chosen by searching a place or standing at it. */
@Composable
private fun GeoField(label: String, value: JsonElement?, places: PlacesApi, onPick: (JsonElement) -> Unit) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val point = value as? JsonObject
    val latitude = (point?.get("latitude") as? JsonPrimitive)?.doubleOrNull
    val longitude = (point?.get("longitude") as? JsonPrimitive)?.doubleOrNull
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 14.dp, color = c.elevated, ring = c.input, elevated = false)
            .pressable(scale = 0.99f, label = label) {
                navigator.push("profile-geo-$label") {
                    PlaceSearchScreen(title = label, places = places) { chosen ->
                        onPick(buildJsonObject {
                            put("latitude", chosen.latitude)
                            put("longitude", chosen.longitude)
                        })
                        navigator.pop()
                    }
                }
            }
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        LineIcon(Lucide.mapPin, size = 18.dp, color = c.primary)
        Text(label, style = SType.small, color = c.muted, modifier = Modifier.weight(1f))
        Text(
            if (latitude != null && longitude != null) "%.4f, %.4f".format(latitude, longitude) else stringResource(R.string.people_choose),
            style = SType.smallStrong,
            color = if (latitude == null) c.subtle else c.fg,
        )
    }
}

/**
 * A profile photo or business logo: what is on file, and a new one from the
 * camera or the gallery, uploaded at once as the web's uploader does.
 */
@Composable
private fun PhotoField(
    accountApi: AccountApi,
    field: AccountApi.Field,
    value: JsonElement?,
    owner: Pair<String, String>?,
    editable: Boolean,
    onChanged: () -> Unit,
) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    var mediaId by remember { mutableStateOf((value as? JsonPrimitive)?.contentOrNull) }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }
    val purpose = field.mediaPurpose
    val pickers = rememberPickers(imagesOnly = true) { picked ->
        val file = picked.getOrElse { notice = (it.message ?: Words.get(R.string.people_photo_unusable)) to NoticeTone.DANGER; return@rememberPickers }
        if (owner == null || purpose == null) return@rememberPickers
        busy = true
        notice = null
        scope.launch {
            try {
                accountApi.uploadImage(owner.first, owner.second, purpose, file)?.let { mediaId = it }
                onChanged()
                notice = Words.get(R.string.people_profile_photo_updated, field.label) to NoticeTone.SUCCESS
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                notice = failure.readable() to NoticeTone.DANGER
            } finally {
                busy = false
            }
        }
    }

    Column(Modifier.fillMaxWidth().card(radius = 20.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            RemotePhoto(accountApi, mediaId, field.label, 64.dp, emptyIcon = Lucide.image)
            Column(Modifier.weight(1f)) {
                Text(field.label, style = SType.bodyStrong, color = c.fg)
                field.help?.let { Text(it, style = SType.caption, color = c.muted) }
            }
        }
        if (editable && owner != null && purpose != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SaarthiButton(
                    stringResource(R.string.people_profile_take_photo),
                    onClick = pickers.takePhoto,
                    busy = busy,
                    busyText = stringResource(R.string.people_profile_uploading),
                    leading = Lucide.camera,
                    modifier = Modifier.weight(1f),
                )
                SaarthiButton(stringResource(R.string.people_profile_gallery), onClick = pickers.chooseFile, enabled = !busy, tone = ButtonTone.SECONDARY, leading = Lucide.image, modifier = Modifier.weight(1f))
            }
        }
        notice?.let { (text, tone) -> NoticeCard(text, tone) }
    }
}

/**
 * A photo from the media library in a circle. While loading or when there is
 * none: [emptyIcon] for a picture slot (a cover, a logo), else the name's initials.
 */
@Composable
internal fun RemotePhoto(accountApi: AccountApi, mediaId: String?, name: String, size: Dp, emptyIcon: String? = null) {
    val c = Saarthi.colors
    val bitmap by produceState<ImageBitmap?>(null, mediaId) {
        value = mediaId?.let { id ->
            withContext(Dispatchers.IO) {
                runCatching { accountApi.image(id)?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }.getOrNull()
            }
        }
    }
    val shown = bitmap
    if (shown != null) {
        Box(Modifier.size(size).clip(CircleShape).background(c.sunken)) {
            Image(shown, contentDescription = name, contentScale = ContentScale.Crop, modifier = Modifier.size(size))
        }
    } else if (emptyIcon != null) {
        IconWell(emptyIcon, well = c.primarySoft, ink = c.primary, size = size, radius = size / 2, iconSize = size * 0.4f)
    } else {
        Avatar(name, size = size, background = c.primarySoft, ink = c.primary)
    }
}
