package com.saarthi.owner.ui.seller

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.MaterialsApi
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.network.PlacesApi
import com.saarthi.owner.network.RequirementsApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.PlaceField
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.NotesField
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SaarthiField
import com.saarthi.owner.ui.design.SaarthiSwitch
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.papers.FullPhoto
import com.saarthi.owner.ui.papers.ThumbnailGrid
import com.saarthi.owner.ui.papers.rememberPickers
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** The units a listing is sold by, in the words a seller picks from. */
internal val ListingUnits: List<Pair<String, String>>
    get() = listOf(
        "TON" to Words.get(R.string.market_listing_unit_tonnes),
        "BAG" to Words.get(R.string.market_listing_unit_bags),
        "CUBIC_METER" to "m³",
        "PIECE" to Words.get(R.string.market_listing_unit_pieces),
        "KG" to "kg",
        "LITRE" to Words.get(R.string.market_listing_unit_litres),
        "TRIP" to Words.get(R.string.market_listing_unit_trips),
    )

private fun Double.typed(): String = if (this % 1.0 == 0.0) toLong().toString() else toString()

private fun decimal(typed: String, max: Int = 10): String = typed.filter { it.isDigit() || it == '.' }.take(max)

/**
 * One listing, everything about it the seller can change: its photos (the
 * cover first), name, description, unit, price, stock, minimum order and where
 * trucks collect it, whether fleets see it — and taking it off sale for good.
 */
@Composable
internal fun ListingScreen(app: OwnerApp, account: SessionStore.Account, initial: MaterialsApi.Listing, onChanged: (MaterialsApi.Listing?) -> Unit) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var listing by remember { mutableStateOf(initial) }
    var name by remember { mutableStateOf(initial.name) }
    var description by remember { mutableStateOf(initial.description.orEmpty()) }
    var unit by remember { mutableStateOf(initial.unit) }
    var price by remember { mutableStateOf(initial.pricePerUnit.typed()) }
    var stock by remember { mutableStateOf(initial.availableQuantity.typed()) }
    var minimum by remember { mutableStateOf(initial.minimumOrderQty.typed()) }
    var shown by remember { mutableStateOf(initial.shown) }
    var pickup by remember { mutableStateOf<PlacesApi.Place?>(null) }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }
    var removing by remember { mutableStateOf(false) }

    val p = price.toDoubleOrNull()
    val s = stock.toDoubleOrNull()
    val m = minimum.toDoubleOrNull()
    val changes = MaterialsApi.Changes(
        name = name.trim().takeIf { it != listing.name },
        description = description.trim().takeIf { it != listing.description.orEmpty() },
        unit = unit.takeIf { it != listing.unit },
        price = p?.takeIf { it != listing.pricePerUnit },
        stock = s?.takeIf { it != listing.availableQuantity },
        minimumOrder = m?.takeIf { it != listing.minimumOrderQty },
        shown = shown.takeIf { it != listing.shown },
        pickup = pickup,
    )
    val changed = listOf(changes.name, changes.description, changes.unit, changes.price, changes.stock, changes.minimumOrder, changes.shown, changes.pickup).any { it != null }
    val valid = name.trim().length >= 2 && (p ?: 0.0) > 0 && s != null && (m ?: 0.0) >= 0

    DetailScreen(
        eyebrow = stringResource(R.string.market_seller_what_fleets_see),
        title = listing.name,
        footer = {
            SaarthiButton(
                stringResource(R.string.market_listing_save),
                onClick = {
                    busy = true
                    notice = null
                    scope.launch {
                        try {
                            app.materials.edit(listing.id, changes)?.let { saved ->
                                listing = saved
                                pickup = null
                                onChanged(saved)
                            }
                            notice = Words.get(R.string.market_listing_saved) to NoticeTone.SUCCESS
                        } catch (failure: Exception) {
                            if (failure is CancellationException) throw failure
                            notice = failure.readable() to NoticeTone.DANGER
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = changed && valid && !busy,
                busy = busy,
                busyText = stringResource(R.string.market_listing_saving),
            )
        },
    ) {
        ListingPhotos(app, account, listing)

        GroupLabel(stringResource(R.string.market_listing_details))
        SaarthiField(value = name, onValueChange = { name = it.take(120) }, label = stringResource(R.string.market_listing_what_you_sell), leading = Lucide.box)
        NotesField(description, { description = it.take(2000) }, label = stringResource(R.string.market_listing_notes), minHeight = 96.dp, placeholder = stringResource(R.string.market_listing_notes_placeholder))
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ListingUnits.forEach { (value, label) -> ChoiceChip(label, selected = unit == value, onClick = { unit = value }, height = 36.dp) }
        }
        val one = RequirementsApi.unitSingular(unit)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CompactField(price, { price = decimal(it) }, stringResource(R.string.market_listing_price_per, one), Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            CompactField(stock, { stock = decimal(it) }, stringResource(R.string.market_listing_in_stock), Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            CompactField(minimum, { minimum = decimal(it, 8) }, stringResource(R.string.market_listing_min_order), Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
        }
        PlaceField(
            label = stringResource(R.string.market_listing_pickup),
            place = pickup ?: listing.pickupPlace(),
            places = app.places,
            onPick = { pickup = it },
        )
        Row(Modifier.fillMaxWidth().card(radius = 18.dp).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.market_stock_shown), style = SType.bodyStrong, color = c.fg)
                Text(if (shown) stringResource(R.string.market_listing_shown_note) else stringResource(R.string.market_listing_hidden_note), style = SType.caption, color = c.muted)
            }
            SaarthiSwitch(checked = shown, onCheckedChange = { shown = it }, label = stringResource(R.string.market_listing_show_named, listing.name))
        }
        notice?.let { (text, tone) -> NoticeCard(text, tone) }

        LinkButton(
            stringResource(R.string.market_listing_remove_link),
            onClick = { removing = true },
            color = c.danger,
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 8.dp),
        )
    }

    // Beside the page, not in it, so it rises over the whole screen.
    RemoveListingSheet(
        visible = removing,
        name = listing.name,
        onDismiss = { removing = false },
        onRemove = {
            app.materials.remove(listing.id)
            onChanged(null)
            navigator.pop()
        },
    )
}

/** A listing's pickup as a place, when the server holds one. */
private fun MaterialsApi.Listing.pickupPlace(): PlacesApi.Place? {
    val address = pickupAddress?.ifBlank { null } ?: return null
    val lat = pickupLatitude ?: return null
    val lng = pickupLongitude ?: return null
    return PlacesApi.Place(name = address.substringBefore(',').trim(), address = address, city = null, latitude = lat, longitude = lng)
}

/**
 * The listing's photos, two to a row, the cover first; a tap shows one full
 * size with the way to make it the cover or take it off. The first photo added
 * becomes the cover, so a listing never shows fleets an empty frame.
 */
@Composable
private fun ListingPhotos(app: OwnerApp, account: SessionStore.Account, listing: MaterialsApi.Listing) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    var reload by remember { mutableIntStateOf(0) }
    var photos by remember { mutableStateOf<List<MaterialsApi.Photo>?>(null) }
    var shownId by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }
    val canAdd = account.can(MaterialsApi.CAN_UPLOAD_PHOTOS) && account.hasFeature(MaterialsApi.PHOTOS_FEATURE)
    val canRemove = account.can(MaterialsApi.CAN_DELETE_PHOTOS)

    LaunchedEffect(listing.id, reload) {
        photos = try {
            app.materials.photos(listing.id)
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            notice = failure.readable() to NoticeTone.DANGER
            photos ?: emptyList()
        }
    }
    fun act(done: String, work: suspend () -> Unit) {
        busy = true
        notice = null
        scope.launch {
            try {
                work()
                notice = done to NoticeTone.SUCCESS
                reload++
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                notice = failure.readable() to NoticeTone.DANGER
            } finally {
                busy = false
            }
        }
    }
    val pickers = rememberPickers(imagesOnly = true) { picked ->
        val file: OwnerApi.Upload = picked.getOrElse { notice = (it.message ?: Words.get(R.string.market_listing_photo_unusable)) to NoticeTone.DANGER; return@rememberPickers }
        act(Words.get(R.string.market_listing_photo_added)) { app.materials.addPhoto(listing.id, file, cover = photos.isNullOrEmpty()) }
    }

    GroupLabel(stringResource(R.string.market_listing_photos))
    val list = photos
    if (list == null) {
        Hint(stringResource(R.string.market_listing_photos_loading))
        return
    }
    // The papers' viewer draws any media photo; the caption names the listing.
    val coverCaption = stringResource(R.string.market_listing_photo_cover, listing.name)
    val asPhotos = list.map { PapersApi.Photo(id = it.id, caption = if (it.isPrimary) coverCaption else listing.name, hasThumbnail = it.thumbnailUrl != null) }
    val load: suspend (String, Boolean) -> ByteArray? = { id, thumbnail -> app.materials.photo(id, thumbnail) }
    val open = asPhotos.firstOrNull { it.id == shownId }
    if (open != null) {
        val isCover = list.firstOrNull { it.id == open.id }?.isPrimary == true
        FullPhoto(open, load, canRemove = canRemove && !busy, onClose = { shownId = null }, onRemove = {
            shownId = null
            act(Words.get(R.string.market_listing_photo_removed)) { app.materials.removePhoto(open.id) }
        })
        if (!isCover && canAdd) {
            SaarthiButton(stringResource(R.string.market_listing_make_cover), onClick = {
                shownId = null
                act(Words.get(R.string.market_listing_cover_changed)) { app.materials.makeCover(open.id) }
            }, tone = ButtonTone.SECONDARY, height = 46.dp, enabled = !busy)
        }
    } else {
        if (list.isEmpty()) Hint(if (canAdd) stringResource(R.string.market_listing_no_photos_yet) else stringResource(R.string.market_listing_no_photos))
        ThumbnailGrid(asPhotos, load) { shownId = it.id }
        when {
            !canAdd -> Unit
            list.size >= MaterialsApi.MAX_PHOTOS -> Hint(stringResource(R.string.market_listing_photos_max, MaterialsApi.MAX_PHOTOS))
            else -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SaarthiButton(stringResource(R.string.market_listing_take_photo), onClick = pickers.takePhoto, busy = busy, busyText = stringResource(R.string.market_listing_saving), leading = Lucide.camera, modifier = Modifier.weight(1f))
                SaarthiButton(stringResource(R.string.market_listing_gallery), onClick = pickers.chooseFile, enabled = !busy, tone = ButtonTone.SECONDARY, leading = Lucide.image, modifier = Modifier.weight(0.7f))
            }
        }
    }
    notice?.let { (text, tone) -> NoticeCard(text, tone) }
    if (list.isNotEmpty()) Text(stringResource(R.string.market_listing_cover_note), style = SType.caption, color = c.subtle)
}

/** Asking before a listing is taken off sale for good. */
@Composable
private fun RemoveListingSheet(visible: Boolean, name: String, onDismiss: () -> Unit, onRemove: suspend () -> Unit) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var problem by remember(visible) { mutableStateOf<String?>(null) }
    BottomSheet(visible = visible, onDismiss = { if (!busy) onDismiss() }) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(stringResource(R.string.market_listing_remove_title, name), style = SType.sheetTitle, color = c.fg)
            Text(
                stringResource(R.string.market_listing_remove_body),
                style = SType.body,
                color = c.muted,
            )
            problem?.let { NoticeCard(it, NoticeTone.DANGER) }
            SaarthiButton(
                stringResource(R.string.market_listing_remove_button),
                onClick = {
                    busy = true
                    problem = null
                    scope.launch {
                        try {
                            onRemove()
                        } catch (failure: Exception) {
                            if (failure is CancellationException) throw failure
                            problem = failure.readable()
                        } finally {
                            busy = false
                        }
                    }
                },
                tone = ButtonTone.DANGER_OUTLINE,
                busy = busy,
                busyText = stringResource(R.string.market_listing_removing),
            )
        }
    }
}
